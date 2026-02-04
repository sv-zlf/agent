/**
 * GG CODE - 新工具定义系统
 * 参考 OpenCode 设计，使用 Zod schema 和声明式定义
 */

import * as z from 'zod';
import { truncateOutput } from '../utils/truncation';
import { loadToolPrompt } from '../utils/tool-prompt-loader';
import { formatToolValidationError } from '../utils/tool-error-formatter';

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
  M extends ToolMetadata = ToolMetadata,
> {
  id: string;
  init: (ctx?: ToolInitContext) => Promise<{
    description: string;
    parameters: Parameters;
    execute(args: z.infer<Parameters>, ctx: ToolExecutionContext<M>): Promise<ToolExecuteResult<M>>;
    formatValidationError?(error: z.ZodError): string;
  }>;
}

/**
 * 工具定义函数
 * 使用 Zod schema 定义工具，自动处理参数验证和输出截断
 */
export function defineTool<Parameters extends z.ZodType, M extends ToolMetadata = ToolMetadata>(
  id: string,
  init: ToolInfo<Parameters, M>['init'] | Awaited<ReturnType<ToolInfo<Parameters, M>['init']>>
): ToolInfo<Parameters, M> {
  return {
    id,
    init: async (initCtx) => {
      const toolInfo = init instanceof Function ? await init(initCtx) : init;

      // 保存原始简短描述（在 loadToolPrompt 覆盖之前）
      const originalDescription = toolInfo.description;

      // 尝试从外部文件加载详细描述
      const externalPrompt = await loadToolPrompt(id);
      if (externalPrompt) {
        // 使用外部文件的详细描述，但保留原始描述
        (toolInfo as any).shortDescription = originalDescription;
        (toolInfo as any).description = externalPrompt;
      } else {
        (toolInfo as any).shortDescription = originalDescription;
      }

      const originalExecute = toolInfo.execute;

      // 包装 execute 函数，添加自动参数验证和输出截断
      toolInfo.execute = async (args, ctx) => {
        // 1. 参数验证
        try {
          toolInfo.parameters.parse(args);
        } catch (error) {
          if (error instanceof z.ZodError) {
            // 使用改进的错误格式化器
            const errorMsg = toolInfo.formatValidationError
              ? toolInfo.formatValidationError(error)
              : formatToolValidationError(id, error, toolInfo.parameters);
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
        const truncated = await truncateOutput(result.output, {
          silent: true, // 静默模式
        });
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
