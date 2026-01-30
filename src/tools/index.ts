/**
 * GG CODE - 工具系统
 * 所有工具的统一导出和注册
 */

import * as z from 'zod';
import { ReadTool } from './read';
import { WriteTool } from './write';
import { EditTool } from './edit';
import { GlobTool } from './glob';
import { GrepTool } from './grep';
import { BashTool } from './bash';
import { MakeDirectoryTool } from './make-directory';
import { TaskTool } from './task';
import type { ToolDefinition } from '../types';

/**
 * 所有工具定义
 */
export const tools = {
  read: ReadTool,
  write: WriteTool,
  edit: EditTool,
  glob: GlobTool,
  grep: GrepTool,
  bash: BashTool,
  'make-directory': MakeDirectoryTool,
  task: TaskTool,
};

/**
 * 转换工具为 ToolDefinition 格式（兼容性）
 */
async function toolToDefinition(tool: any): Promise<ToolDefinition> {
  const info = await tool.init();

  // 解析 Zod schema 获取参数信息
  const parameters: Record<string, any> = {};
  const schema = info.parameters as any;

  if (schema && schema.shape) {
    for (const [key, value] of Object.entries(schema.shape)) {
      const unwrapped = value instanceof z.ZodOptional ? value._def : value;
      const typeName = getZodTypeName(unwrapped);
      const description = (unwrapped as any).description || '';

      parameters[key] = {
        type: typeName,
        description,
        required: !(value instanceof z.ZodOptional),
      };
    }
  }

  // 创建 ToolDefinition 兼容格式
  return {
    name: formatToolName(tool.id),
    description: info.description,
    category: getCategory(tool.id),
    permission: getPermission(tool.id),
    parameters,
    handler: async (args: Record<string, unknown>) => {
      try {
        const adaptedArgs = adaptParameters(args);
        const ctx: any = {
          sessionID: 'default',
          messageID: 'msg',
          agent: 'default',
          metadata: () => {},
        };
        const result = await info.execute(adaptedArgs, ctx);
        return {
          success: true,
          output: result.output,
          metadata: result.metadata,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    },
  };
}

/**
 * 导出所有工具（V2 框架）
 */
export * from './read';
export * from './write';
export * from './edit';
export * from './glob';
export * from './grep';
export * from './bash';
export * from './make-directory';
export * from './tool';

/**
 * 获取所有工具信息
 */
export async function getAllToolInfos() {
  const infos = [];

  for (const tool of Object.values(tools)) {
    const info = await tool.init();
    infos.push({
      id: tool.id,
      description: info.description,
      parameters: info.parameters,
      execute: info.execute,
    });
  }

  return infos;
}

/**
 * 生成工具描述（用于系统提示词）
 */
export async function generateToolsDescription(): Promise<string> {
  const infos = await getAllToolInfos();
  const lines: string[] = [];

  for (const info of infos) {
    lines.push(`### ${info.id}`);
    lines.push(`**描述**: ${info.description}`);
    lines.push('**参数**:');

    // Zod schema 转换为可读格式
    const schema = info.parameters as any;
    const keys = schema ? Object.keys(schema.shape || {}) : [];

    if (keys.length === 0) {
      lines.push('  (无参数)');
    } else {
      keys.forEach((key: string) => {
        // 获取字段的描述和是否必需
        const fieldSchema = schema.shape[key];
        const isOptional = fieldSchema?.isOptional?.();
        const description = (fieldSchema as any).description || '';

        // 推断类型
        let typeName = 'unknown';
        if (fieldSchema instanceof z.ZodString) typeName = 'string';
        else if (fieldSchema instanceof z.ZodNumber) typeName = 'number';
        else if (fieldSchema instanceof z.ZodBoolean) typeName = 'boolean';
        else if (fieldSchema instanceof z.ZodOptional) typeName = 'any'; // 简化处理

        const optional = isOptional ? ' **[可选]**' : ' **[必需]**';
        lines.push(`  - \`${key}\` (${typeName})${optional}: ${description}`);
      });
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 默认导出所有工具
 */
export default tools;

/**
 * 获取工具的兼容格式定义
 */
export async function getBuiltinTools(): Promise<ToolDefinition[]> {
  const definitions: ToolDefinition[] = [];

  for (const tool of Object.values(tools)) {
    const def = await toolToDefinition(tool);
    definitions.push(def);
  }

  return definitions;
}

function formatToolName(toolId: string): string {
  return toolId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function adaptParameters(args: Record<string, unknown>): Record<string, unknown> {
  const adapted = { ...args };
  if ('file_path' in adapted) {
    (adapted as any).filePath = adapted['file_path'];
    delete adapted['file_path'];
  }
  if ('old_string' in adapted) {
    (adapted as any).oldString = adapted['old_string'];
    delete adapted['old_string'];
  }
  if ('new_string' in adapted) {
    (adapted as any).newString = adapted['new_string'];
    delete adapted['new_string'];
  }
  if ('replace_all' in adapted) {
    (adapted as any).replaceAll = adapted['replace_all'];
    delete adapted['replace_all'];
  }
  return adapted;
}

function getZodTypeName(schema: any): string {
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  if (schema instanceof z.ZodOptional) return getZodTypeName(schema.unwrap());
  return 'string';
}

function getCategory(toolId: string): ToolDefinition['category'] {
  const categories: Record<string, ToolDefinition['category']> = {
    read: 'file',
    write: 'file',
    edit: 'file',
    'make-directory': 'file',
    glob: 'search',
    grep: 'search',
    bash: 'command',
  };
  return categories[toolId] || 'system';
}

function getPermission(toolId: string): ToolDefinition['permission'] {
  const permissions: Record<string, ToolDefinition['permission']> = {
    read: 'safe',
    glob: 'safe',
    grep: 'safe',
    write: 'local-modify',
    edit: 'local-modify',
    'make-directory': 'local-modify',
    bash: 'dangerous',
  };
  return permissions[toolId] || 'safe';
}
