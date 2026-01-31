import type { ToolDefinition, ToolCall, ToolResult } from '../types';
import { createLogger } from '../utils';
import { truncateOutput, cleanupOldTruncationFiles } from '../utils/truncation';

const logger = createLogger(true); // 启用debug模式用于工具引擎

// 截断配置
const TRUNCATE_ENABLED = true; // 是否启用智能截断
const TRUNCATE_MAX_LINES = 2000; // 最大行数
const TRUNCATE_MAX_BYTES = 50 * 1024; // 最大字节数 (50KB)

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
   * 初始化工具引擎（执行清理等初始化操作）
   */
  async initialize(): Promise<void> {
    // 清理过期的截断文件
    try {
      await cleanupOldTruncationFiles();
    } catch (error) {
      logger.debug(`Failed to cleanup old truncation files: ${error}`);
    }
  }

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
   * 返回简洁的工具列表，详细信息由模板文件提供
   */
  generateToolsDescription(): string {
    const lines: string[] = [];

    for (const tool of this.tools.values()) {
      // 只生成工具名称和简要描述
      lines.push(`- **${tool.name}**: ${tool.description}`);
    }

    return lines.join('\n');
  }

  /**
   * 生成详细的工具参数描述
   * 用于调试或扩展提示词
   */
  generateDetailedToolsDescription(): string {
    const lines: string[] = [];

    for (const tool of this.tools.values()) {
      lines.push(`### ${tool.name}`);
      lines.push(`**描述**: ${tool.description}`);
      lines.push(`**权限**: ${tool.permission}`);
      lines.push('**参数**:');

      if (Object.keys(tool.parameters).length === 0) {
        lines.push('  (无参数)');
      } else {
        for (const [paramName, param] of Object.entries(tool.parameters)) {
          const required = param.required ? ' **[必需]**' : ' **[可选]**';
          lines.push(`  - \`${paramName}\` (${param.type})${required}: ${param.description}`);
          if (param.default !== undefined) {
            lines.push(`    - 默认值: \`${JSON.stringify(param.default)}\``);
          }
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
    // Try to get tool by exact name first
    let tool = this.tools.get(call.tool);
    let actualToolName = call.tool;

    // If not found, try case-insensitive matching (repair tool name)
    if (!tool) {
      const lowerToolName = call.tool.toLowerCase();
      for (const [registeredName, toolDef] of this.tools.entries()) {
        if (registeredName.toLowerCase() === lowerToolName) {
          tool = toolDef;
          actualToolName = registeredName;
          break;
        }
      }
      // If tool was found via case-insensitive match, log it
      if (tool) {
        logger.debug(`Repaired tool name from "${call.tool}" to "${actualToolName}"`);
      }
    }

    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${call.tool}. Available tools: ${Array.from(this.tools.keys()).join(', ')}`,
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
      // logger.info(`Executing tool: ${call.tool}`); // 已移除：由上层显示状态

      // 适配参数名（支持 snake_case → camelCase 和大小写不敏感匹配）
      const adaptedParams = this.adaptToolParameters(call.tool, call.parameters);

      // 验证必需参数（大小写不敏感检查）
      for (const [paramName, param] of Object.entries(tool.parameters)) {
        if (param.required) {
          // 检查精确匹配
          if (adaptedParams[paramName] !== undefined) {
            continue;
          }
          // 检查大小写不敏感匹配
          const lowerParamName = paramName.toLowerCase();
          const foundKey = Object.keys(adaptedParams).find(
            (k) => k.toLowerCase() === lowerParamName
          );
          if (foundKey) {
            // 找到了，重命名键为正确的格式
            adaptedParams[paramName] = adaptedParams[foundKey];
            delete adaptedParams[foundKey];
            continue;
          }
          // 没找到，返回错误
          return {
            success: false,
            error: `Missing required parameter: ${paramName}. Available parameters in tool definition: ${Object.keys(tool.parameters).join(', ')}. Received: ${Object.keys(adaptedParams).join(', ')}`,
          };
        }
      }

      // 创建工具级别的 AbortController（用于超时）
      const toolTimeoutController = new AbortController();
      const toolTimeout = Math.min(timeout ?? this.defaultToolTimeout, MAX_TOOL_TIMEOUT);
      const timeoutId = setTimeout(() => {
        toolTimeoutController.abort();
      }, toolTimeout);

      let combinedSignal: AbortSignal | undefined;
      if (abortSignal) {
        // 组合全局 abort 信号和工具超时信号
        // 注意：AbortSignal.any 是实验性 API，需要做兼容处理
        try {
          combinedSignal = (AbortSignal as any).any([toolTimeoutController.signal, abortSignal]);
        } catch (e) {
          // 如果 AbortSignal.any 不可用，使用全局 abort 信号
          combinedSignal = abortSignal;
          // logger.warning('AbortSignal.any not available, using global abort signal only');
        }
      } else {
        combinedSignal = toolTimeoutController.signal;
      }

      try {
        // 记录开始时间
        const startTime = Date.now();

        // 执行工具，传入组合 abort 信号
        const execParams = {
          ...adaptedParams, // 使用适配后的参数
          __abortSignal__: combinedSignal,
          __timeout__: toolTimeout,
        };

        const result = await tool.handler(execParams);
        const endTime = Date.now();
        const duration = endTime - startTime;

        // logger.info(`Tool ${call.tool} completed: ${result.success ? 'success' : 'failed'} (${duration}ms)`); // 已移除：由上层显示状态

        clearTimeout(timeoutId);

        // 检查执行后是否被中断
        if (combinedSignal?.aborted && !result.success) {
          // 判断是超时还是用户中断
          if (toolTimeoutController.signal.aborted) {
            return {
              success: false,
              error: '工具执行超时',
              metadata: {
                startTime,
                endTime,
                duration,
                signal: 'ABORTED',
              },
            };
          } else if (abortSignal?.aborted) {
            return {
              success: false,
              error: '工具执行已被用户中断',
              metadata: {
                startTime,
                endTime,
                duration,
                signal: 'SIGINT',
              },
            };
          }
        }

        // 应用智能截断（如果启用）
        let finalOutput = result.output;
        let truncationInfo: any = undefined;

        if (TRUNCATE_ENABLED && finalOutput && result.success) {
          try {
            const truncateResult = await truncateOutput(finalOutput, {
              maxLines: TRUNCATE_MAX_LINES,
              maxBytes: TRUNCATE_MAX_BYTES,
              direction: 'head', // 默认保留头部
            });

            if (truncateResult.truncated) {
              finalOutput = truncateResult.content;
              truncationInfo = {
                truncated: true,
                truncationFile: truncateResult.outputPath,
                truncationStats: truncateResult.stats,
              };
              logger.debug(`Tool output truncated: ${truncateResult.outputPath}`);
            } else {
              truncationInfo = { truncated: false };
            }
          } catch (error) {
            // 截断失败时保留原输出
            logger.warning(`Failed to truncate tool output: ${error}`);
            truncationInfo = { truncated: false, truncateError: String(error) };
          }
        }

        // 增强返回结果的元数据
        return {
          ...result,
          output: finalOutput,
          metadata: {
            ...(result.metadata || {}),
            startTime,
            endTime,
            duration,
            ...truncationInfo,
          },
        };
      } catch (error: any) {
        const endTime = Date.now();
        clearTimeout(timeoutId);

        // 检查中断原因
        if (combinedSignal?.aborted) {
          if (toolTimeoutController.signal.aborted) {
            return {
              success: false,
              error: '工具执行超时',
              metadata: {
                startTime: endTime - toolTimeout,
                endTime,
                duration: toolTimeout,
                signal: 'TIMEOUT',
              },
            };
          } else if (abortSignal?.aborted) {
            return {
              success: false,
              error: '工具执行已被用户中断',
              metadata: {
                startTime: endTime - 5000,
                endTime,
                duration: 5000,
                signal: 'SIGINT',
              },
            };
          }
        }

        // 其他错误
        return {
          success: false,
          error: error.message || String(error),
          metadata: {
            endTime,
          },
        };
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
    const seen = new Set<string>(); // Deduplicate calls

    // Helper to add call if not duplicate
    const addCall = (call: ToolCall) => {
      const signature = `${call.tool}:${JSON.stringify(call.parameters)}`;
      if (!seen.has(signature)) {
        seen.add(signature);
        calls.push(call);
      }
    };

    // 首先尝试解析代码块中的工具调用（优先级更高）
    const codeBlockRegex = /```(?:json|tool)?\s*\n?([\s\S]*?)```/g;
    let match = codeBlockRegex.exec(response);
    while (match !== null) {
      try {
        const content = match[1].trim();
        const parsed = JSON.parse(content);
        if (parsed.tool && parsed.parameters) {
          addCall({
            tool: parsed.tool,
            parameters: parsed.parameters,
            id: parsed.id || this.generateToolCallId(),
          });
        }
      } catch {
        // 忽略解析失败的JSON
      }
      match = codeBlockRegex.exec(response);
    }

    // 尝试解析函数调用格式: ToolName{...parameters...}
    const functionCallRegex = /(\w+)\{([\s\S]*?)\}/g;
    match = functionCallRegex.exec(response);
    while (match !== null) {
      try {
        const toolName = match[1];
        const paramsStr = match[2];

        // 尝试解析参数
        let parameters: any;
        try {
          // 直接尝试解析参数字符串为JSON（适用于 {"pattern": "..."} 格式）
          parameters = JSON.parse(`{${paramsStr}}`);
        } catch {
          try {
            // 如果失败，尝试将整个参数字符串作为JSON解析（适用于 "pattern": "..." 格式）
            parameters = JSON.parse(paramsStr);
          } catch {
            // 最后尝试简化格式：将 key=value 格式转换为JSON
            parameters = {};
            const paramPairs = paramsStr.match(/(\w+)\s*=\s*"([^"]*)"/g) || [];
            paramPairs.forEach((pair) => {
              const [key, value] = pair.split('=');
              parameters[key.trim()] = value.trim().replace(/"/g, '');
            });
          }
        }

        addCall({
          tool: toolName,
          parameters,
          id: this.generateToolCallId(),
        });
      } catch {
        // 忽略解析失败的函数调用
      }
      match = functionCallRegex.exec(response);
    }

    // 尝试解析纯JSON格式的工具调用（不在代码块中）
    const jsonRegex = /\{\s*"tool"\s*:\s*"(\w+)"\s*,\s*"parameters"\s*:\s*\{[\s\S]*?\}\s*\}/g;
    match = jsonRegex.exec(response);
    while (match !== null) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.tool && parsed.parameters) {
          addCall({
            tool: parsed.tool,
            parameters: parsed.parameters,
            id: parsed.id || this.generateToolCallId(),
          });
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

  /**
   * 适配工具参数（支持 snake_case → camelCase 和大小写不敏感匹配）
   */
  private adaptToolParameters(
    toolName: string,
    params: Record<string, unknown>
  ): Record<string, unknown> {
    const adapted = { ...params };

    // 定义参数映射（snake_case → camelCase）
    const paramMappings: Record<string, Record<string, string>> = {
      Read: {
        file_path: 'filePath',
      },
      Write: {
        file_path: 'filePath',
        content: 'content',
      },
      Edit: {
        file_path: 'filePath',
        old_string: 'oldString',
        new_string: 'newString',
        replace_all: 'replaceAll',
      },
      MultiEdit: {
        file_path: 'filePath',
        old_string: 'oldString',
        new_string: 'newString',
        replace_all: 'replaceAll',
      },
      Grep: {
        pattern: 'pattern',
      },
      Glob: {
        pattern: 'pattern',
      },
    };

    // 应用映射（支持大小写不敏感）
    const mappings = paramMappings[toolName];
    if (mappings) {
      for (const [snakeKey, camelKey] of Object.entries(mappings)) {
        // 跳过无意义的映射（源和目标相同）
        if (snakeKey === camelKey) {
          continue;
        }

        // 首先检查精确匹配
        if (snakeKey in adapted && adapted[snakeKey] !== undefined) {
          adapted[camelKey] = adapted[snakeKey];
          delete adapted[snakeKey];
          continue;
        }
        // 检查大小写不敏感匹配
        const lowerSnakeKey = snakeKey.toLowerCase();
        const matchedKey = Object.keys(adapted).find(
          (k) => k.toLowerCase() === lowerSnakeKey && adapted[k] !== undefined
        );
        if (matchedKey) {
          adapted[camelKey] = adapted[matchedKey];
          delete adapted[matchedKey];
        }
      }
    }

    return adapted;
  }

  /**
   * 生成工具调用ID
   */
  private generateToolCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * 创建工具引擎实例
 */
export function createToolEngine(): ToolEngine {
  return new ToolEngine();
}
