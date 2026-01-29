import type { ToolDefinition, ToolCall, ToolResult } from '../types';
import { createLogger } from '../utils';

const logger = createLogger(true); // 启用debug模式用于工具引擎

// 默认工具超时时间（毫秒）
const DEFAULT_TOOL_TIMEOUT = 30000; // 30秒
const MAX_TOOL_TIMEOUT = 120000; // 2分钟

/**
 * 工具执行引擎
 */
export class ToolEngine {
  private tools: Map<string, ToolDefinition> = new Map();
  private defaultToolTimeout: number = DEFAULT_TOOL_TIMEOUT;

  /**
   * 设置默认工具超时
   */
  setDefaultToolTimeout(timeout: number): void {
    this.defaultToolTimeout = Math.min(timeout, MAX_TOOL_TIMEOUT);
  }

  /**
   * 注册工具
   */
  registerTool(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 批量注册工具
   */
  registerTools(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * 获取工具定义
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具定义
   */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 按类别获取工具
   */
  getToolsByCategory(category: ToolDefinition['category']): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((t) => t.category === category);
  }

  /**
   * 生成工具描述（用于系统提示词）
   */
  generateToolsDescription(): string {
    const lines: string[] = [];

    for (const tool of this.tools.values()) {
      lines.push(`## ${tool.name}`);
      lines.push(`Description: ${tool.description}`);
      lines.push('Parameters:');

      for (const [paramName, param] of Object.entries(tool.parameters)) {
        const required = param.required ? ' (required)' : ' (optional)';
        lines.push(`  - ${paramName}: ${param.type}${required} - ${param.description}`);
        if (param.default !== undefined) {
          lines.push(`    Default: ${JSON.stringify(param.default)}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 执行工具调用
   */
  async executeToolCall(
    call: ToolCall,
    abortSignal?: AbortSignal,
    timeout?: number
  ): Promise<ToolResult> {
    const tool = this.tools.get(call.tool);

    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${call.tool}`,
      };
    }

    // 检查全局 abort 信号
    if (abortSignal?.aborted) {
      return {
        success: false,
        error: '工具执行已被用户中断',
      };
    }

    try {
      logger.info(`Executing tool: ${call.tool}`);

      // 验证必需参数
      for (const [paramName, param] of Object.entries(tool.parameters)) {
        if (param.required && call.parameters[paramName] === undefined) {
          return {
            success: false,
            error: `Missing required parameter: ${paramName}`,
          };
        }
      }

      // 创建工具级别的 AbortController（用于超时）
      const toolTimeoutController = new AbortController();
      const toolTimeout = Math.min(
        timeout ?? this.defaultToolTimeout,
        MAX_TOOL_TIMEOUT
      );
      const timeoutId = setTimeout(() => {
        toolTimeoutController.abort();
      }, toolTimeout);

      let combinedSignal: AbortSignal | undefined;
      if (abortSignal) {
        // 组合全局 abort 信号和工具超时信号
        // 注意：AbortSignal.any 是实验性 API，需要做兼容处理
        try {
          combinedSignal = (AbortSignal as any).any([
            toolTimeoutController.signal,
            abortSignal,
          ]);
        } catch (e) {
          // 如果 AbortSignal.any 不可用，使用全局 abort 信号
          combinedSignal = abortSignal;
          // logger.warning('AbortSignal.any not available, using global abort signal only');
        }
      } else {
        combinedSignal = toolTimeoutController.signal;
      }

      try {
        // 执行工具，传入组合 abort 信号
        const execParams = {
          ...call.parameters,
          __abortSignal__: combinedSignal,
          __timeout__: toolTimeout,
        };

        const result = await tool.handler(execParams);
        logger.info(`Tool ${call.tool} completed: ${result.success ? 'success' : 'failed'}`);

        clearTimeout(timeoutId);

        // 检查执行后是否被中断
        if (combinedSignal?.aborted && !result.success) {
          // 判断是超时还是用户中断
          if (toolTimeoutController.signal.aborted) {
            return {
              success: false,
              error: '工具执行超时',
            };
          } else if (abortSignal?.aborted) {
            return {
              success: false,
              error: '工具执行已被用户中断',
            };
          }
        }

        return result;
      } catch (error: any) {
        clearTimeout(timeoutId);

        // 检查中断原因
        if (combinedSignal?.aborted) {
          if (toolTimeoutController.signal.aborted) {
            return {
              success: false,
              error: '工具执行超时',
            };
          } else if (abortSignal?.aborted) {
            return {
              success: false,
              error: '工具执行已被用户中断',
            };
          }
        }

        // 其他错误
        throw error;
      }
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Tool ${call.tool} error: ${errorMsg}`);

      // 检查是否是中断错误
      if (abortSignal?.aborted || errorMsg.includes('中断') || errorMsg.includes('abort')) {
        return {
          success: false,
          error: '工具执行已被用户中断',
        };
      }

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * 批量执行工具调用
   */
  async executeToolCalls(
    calls: ToolCall[],
    abortSignal?: AbortSignal,
    timeout?: number
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of calls) {
      // 检查是否已中断
      if (abortSignal?.aborted) {
        results.push({
          success: false,
          error: '工具执行已被用户中断',
        });
        break;
      }

      const result = await this.executeToolCall(call, abortSignal, timeout);
      results.push(result);

      // 如果工具执行失败且不是因为中断，停止后续工具
      if (!result.success && !result.error?.includes('中断') && !result.error?.includes('超时')) {
        break;
      }
    }

    return results;
  }

  /**
   * 解析AI响应中的工具调用
   * 支持多种格式：
   * 1. JSON格式: {"tool": "Read", "parameters": {"file_path": "..."}}
   * 2. 代码块格式
   */
  parseToolCallsFromResponse(response: string): ToolCall[] {
    const calls: ToolCall[] = [];

    // 首先尝试解析代码块中的工具调用（优先级更高）
    const codeBlockRegex = /```(?:json|tool)?\s*\n?([\s\S]*?)```/g;
    let match = codeBlockRegex.exec(response);
    while (match !== null) {
      try {
        const content = match[1].trim();
        const parsed = JSON.parse(content);
        if (parsed.tool && parsed.parameters) {
          calls.push({
            tool: parsed.tool,
            parameters: parsed.parameters,
            id: parsed.id,
          });
        }
      } catch {
        // 忽略解析失败的JSON
      }
      match = codeBlockRegex.exec(response);
    }

    // 尝试解析纯JSON格式的工具调用（不在代码块中）
    const jsonRegex = /\{\s*"tool"\s*:\s*"(\w+)"\s*,\s*"parameters"\s*:\s*\{[\s\S]*?\}\s*\}/g;
    match = jsonRegex.exec(response);
    while (match !== null) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.tool && parsed.parameters) {
          // 检查是否已经在代码块中解析过
          const alreadyParsed = calls.some(
            c => c.tool === parsed.tool && JSON.stringify(c.parameters) === JSON.stringify(parsed.parameters)
          );
          if (!alreadyParsed) {
            calls.push({
              tool: parsed.tool,
              parameters: parsed.parameters,
              id: parsed.id,
            });
          }
        }
      } catch {
        // 忽略解析失败的JSON
      }
      match = jsonRegex.exec(response);
    }

    return calls;
  }

  /**
   * 检查是否有工具调用
   */
  hasToolCalls(response: string): boolean {
    return this.parseToolCallsFromResponse(response).length > 0;
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
    logger.debug('All tools cleared');
  }

  /**
   * 获取工具数量
   */
  size(): number {
    return this.tools.size;
  }
}

/**
 * 创建工具引擎实例
 */
export function createToolEngine(): ToolEngine {
  return new ToolEngine();
}
