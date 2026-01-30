/**
 * 增强的工具系统
 * 参考 OpenCode 设计，提供更准确的工具调用和验证
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolPermissionLevel } from '../types';
import { createLogger } from '../utils';

const logger = createLogger(true);

/**
 * Zod Schema 类型
 */
export type ToolParameterSchema = z.ZodType<any>;

/**
 * 增强的工具定义选项
 */
export interface EnhancedToolOptions {
  name: string;
  description: string;
  category: 'file' | 'search' | 'command' | 'system';
  permission: ToolPermissionLevel;
  parameters: ToolParameterSchema;
  handler: (args: any, context: ToolExecutionContext) => Promise<ToolResult>;
  validate?: (args: any) => string | null; // 自定义验证函数
  examples?: Array<{ args: any; description: string }>; // 使用示例
}

/**
 * 工具执行上下文
 */
export interface ToolExecutionContext {
  sessionId?: string;
  messageId?: string;
  workingDirectory: string;
  startTime: number;
  metadata: Record<string, any>;
  updateMetadata: (metadata: any) => void;
}

/**
 * 增强的工具定义类
 */
export class EnhancedTool implements ToolDefinition {
  name: string;
  description: string;
  category: 'file' | 'search' | 'command' | 'system';
  permission: ToolPermissionLevel;
  parameters: Record<string, any>;
  schema: ToolParameterSchema;
  private enhancedHandler: (args: any, context: ToolExecutionContext) => Promise<ToolResult>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>; // 兼容旧接口
  validate?: (args: any) => string | null;
  examples?: Array<{ args: any; description: string }>;

  constructor(options: EnhancedToolOptions) {
    this.name = options.name;
    this.description = options.description;
    this.category = options.category;
    this.permission = options.permission;
    this.schema = options.parameters;
    this.enhancedHandler = options.handler;
    this.validate = options.validate;
    this.examples = options.examples;

    // 从 Zod schema 生成参数定义（用于向后兼容）
    this.parameters = this.extractParameterInfo(this.schema);

    // 包装 handler 以兼容 ToolDefinition 接口
    this.handler = this.wrapHandler();
  }

  /**
   * 包装增强的 handler 使其兼容 ToolDefinition 接口
   */
  private wrapHandler(): (args: Record<string, unknown>) => Promise<ToolResult> {
    return async (args: Record<string, unknown>) => {
      // 验证参数
      const validation = this.validateParameters(args);
      if (!validation.success) {
        return {
          success: false,
          error: `参数验证失败: ${validation.error}`,
        };
      }

      // 创建执行上下文
      const context: ToolExecutionContext = {
        sessionId: 'session-' + Date.now(),
        messageId: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        workingDirectory: process.cwd(),
        startTime: Date.now(),
        metadata: {},
        updateMetadata: (metadata: any) => {
          Object.assign(context.metadata, metadata);
        },
      };

      // 调用增强的 handler
      return this.enhancedHandler(validation.data, context);
    };
  }

  /**
   * 从 Zod schema 提取参数信息
   */
  private extractParameterInfo(schema: ToolParameterSchema): Record<string, any> {
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      const params: Record<string, any> = {};

      for (const [key, value] of Object.entries(shape)) {
        const zodType = value as z.ZodTypeAny;
        params[key] = {
          type: this.getZodTypeName(zodType),
          description: zodType.description || '',
          required: !this.isZodOptional(zodType),
          default: this.getZodDefaultValue(zodType),
        };
      }

      return params;
    }

    return {};
  }

  /**
   * 获取 Zod 类型名称
   */
  private getZodTypeName(zodType: z.ZodTypeAny): string {
    if (zodType instanceof z.ZodString) return 'string';
    if (zodType instanceof z.ZodNumber) return 'number';
    if (zodType instanceof z.ZodBoolean) return 'boolean';
    if (zodType instanceof z.ZodArray) return 'array';
    if (zodType instanceof z.ZodObject) return 'object';
    return 'unknown';
  }

  /**
   * 检查 Zod 类型是否可选
   */
  private isZodOptional(zodType: z.ZodTypeAny): boolean {
    return zodType.isOptional();
  }

  /**
   * 获取 Zod 类型的默认值
   */
  private getZodDefaultValue(zodType: z.ZodTypeAny): any {
    // 尝试获取默认值（使用 safeParse）
    try {
      const def = zodType._def as any;
      if (def.defaultValue !== undefined) {
        if (typeof def.defaultValue === 'function') {
          return def.defaultValue();
        }
        return def.defaultValue;
      }
    } catch {
      // 忽略错误
    }
    return undefined;
  }

  /**
   * 验证参数
   */
  validateParameters(args: any): { success: boolean; error?: string; data?: any } {
    try {
      // 使用 Zod 验证
      const data = this.schema.parse(args);

      // 运行自定义验证
      if (this.validate) {
        const customError = this.validate(data);
        if (customError) {
          return { success: false, error: customError };
        }
      }

      return { success: true, data };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formatted = this.formatZodError(error);
        return { success: false, error: formatted };
      }
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 格式化 Zod 验证错误
   */
  private formatZodError(error: z.ZodError): string {
    const issues = error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '参数';
      let message = '';

      switch (issue.code) {
        case 'invalid_type':
          message = `${path} 类型错误，期望 ${(issue as any).expected}，实际 ${(issue as any).received}`;
          break;
        case 'unrecognized_keys':
          message = `${path} 包含未识别的键`;
          break;
        case 'too_small':
          message = `${path} 值太小${(issue as any).inclusive ? '（含）' : '（不含）'}: ${(issue as any).minimum}`;
          break;
        case 'too_big':
          message = `${path} 值太大${(issue as any).inclusive ? '（含）' : '（不含）'}: ${(issue as any).maximum}`;
          break;
        case 'invalid_format':
          message = `${path} 格式无效`;
          break;
        default:
          message = `${path}: ${issue.message}`;
      }

      return message;
    });

    return issues.join('; ');
  }

  /**
   * 执行工具（向后兼容方法）
   */
  async execute(args: any, context?: ToolExecutionContext): Promise<ToolResult> {
    // 验证参数
    const validation = this.validateParameters(args);
    if (!validation.success) {
      return {
        success: false,
        error: `参数验证失败: ${validation.error}`,
      };
    }

    // 创建上下文（如果未提供）
    const execContext = context || {
      sessionId: 'session-' + Date.now(),
      messageId: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      workingDirectory: process.cwd(),
      startTime: Date.now(),
      metadata: {},
      updateMetadata: (metadata: any) => {
        Object.assign(execContext.metadata, metadata);
      },
    };

    // 调用增强的 handler
    return this.enhancedHandler(validation.data, execContext);
  }
}

/**
 * 创建增强工具的辅助函数
 */
export function createTool(options: EnhancedToolOptions): EnhancedTool {
  return new EnhancedTool(options);
}

/**
 * 常用的 Zod schema
 */
export const Schemas = {
  // 文件路径
  filePath: () => z.string().min(1, '文件路径不能为空').describe('文件的绝对路径'),

  // 偏移量
  offset: () => z.number().int().min(0).optional().default(0).describe('开始读取的行号（从0开始）'),

  // 限制
  limit: () => z.number().int().positive().optional().describe('读取的最大行数'),

  // 命令
  command: () => z.string().min(1, '命令不能为空').describe('要执行的 shell 命令'),

  // Glob 模式
  pattern: () => z.string().min(1, '模式不能为空').describe('glob 模式'),

  // 搜索路径
  searchPath: () => z.string().optional().default('.').describe('搜索的根目录'),
};
