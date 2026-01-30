/**
 * GG CODE - 新工具定义系统
 * 参考 OpenCode 设计，使用 Zod schema 和声明式定义
 */

import * as z from 'zod';
import type { ToolResult } from '../types';
import { truncateOutput } from '../utils/truncation';

/**
 * 工具元数据
 */
export interface ToolMetadata {
  [key: string]: any;
}

/**
 * 工具初始化上下文
 */
export interface ToolInitContext {
  sessionID?: string;
  agent?: string;
  [key: string]: any;
}

/**
 * 工具执行上下文
 */
export interface ToolExecutionContext<M extends ToolMetadata = ToolMetadata> {
  sessionID: string;
  messageID: string;
  agent: string;
  abort?: AbortSignal;
  callID?: string;
  extra?: { [key: string]: any };
  metadata(input: { title?: string; metadata?: M }): void;
}

/**
 * 工具执行结果
 */
export interface ToolExecuteResult<M extends ToolMetadata = ToolMetadata> {
  title: string;
  output: string;
  metadata: M;
  attachments?: string[];
}

/**
 * 工具信息接口
 */
export interface ToolInfo<
  Parameters extends z.ZodType = z.ZodType,
  M extends ToolMetadata = ToolMetadata
> {
  id: string;
  init: (ctx?: ToolInitContext) => Promise<{
    description: string;
    parameters: Parameters;
    execute(
      args: z.infer<Parameters>,
      ctx: ToolExecutionContext<M>
    ): Promise<ToolExecuteResult<M>>;
    formatValidationError?(error: z.ZodError): string;
  }>;
}

/**
 * 工具定义函数
 * 使用 Zod schema 定义工具，自动处理参数验证和输出截断
 */
export function defineTool<
  Parameters extends z.ZodType,
  M extends ToolMetadata = ToolMetadata
>(
  id: string,
  init: ToolInfo<Parameters, M>['init'] | Awaited<ReturnType<ToolInfo<Parameters, M>['init']>>
): ToolInfo<Parameters, M> {
  return {
    id,
    init: async (initCtx) => {
      const toolInfo = init instanceof Function ? await init(initCtx) : init;
      const originalExecute = toolInfo.execute;

      // 包装 execute 函数，添加自动参数验证和输出截断
      toolInfo.execute = async (args, ctx) => {
        // 1. 参数验证
        try {
          toolInfo.parameters.parse(args);
        } catch (error) {
          if (error instanceof z.ZodError) {
            const errorMsg = toolInfo.formatValidationError
              ? toolInfo.formatValidationError(error)
              : `参数验证失败:\n${(error as any).errors.map((e: any) => `- ${e.path.join('.')}: ${e.message}`).join('\n')}`;
            throw new Error(errorMsg);
          }
          throw error;
        }

        // 2. 执行工具
        const result = await originalExecute(args, ctx);

        // 3. 跳过自行处理截断的工具
        if (result.metadata.truncated !== undefined) {
          return result;
        }

        // 4. 自动应用输出截断
        const truncated = await truncateOutput(result.output, {});
        return {
          ...result,
          output: truncated.content,
          metadata: {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { truncationFile: truncated.outputPath }),
          } as M,
        };
      };

      return toolInfo;
    },
  };
}

/**
 * 从 ToolInfo 创建旧的 ToolDefinition（兼容性）
 */
export function toolInfoToDefinition(info: ToolInfo<any, any>) {
  return {
    name: info.id,
    description: '', // 将在 init 后填充
    category: 'file' as const,
    permission: 'safe' as const,
    parameters: {},
    handler: async (args: Record<string, unknown>) => {
      // 这是一个临时实现，实际使用需要完全重写
      return { success: true, output: '' };
    },
  };
}
