import type { ToolDefinition, ToolCall, ToolResult } from '../types';
import { createLogger } from '../utils';
import { truncateOutput, cleanupOldTruncationFiles } from '../utils/truncation';
import { ToolParameterHelper } from '../utils/tool-params';

const logger = createLogger(true); // 启用debug模式用于工具引擎

// 截断配置
const TRUNCATE_ENABLED = true; // 是否启用智能截断
const TRUNCATE_MAX_LINES = 2000; // 最大行数
const TRUNCATE_MAX_BYTES = 50 * 1024; // 最大字节数 (50KB)

// 默认工具超时时间（毫秒）
const DEFAULT_TOOL_TIMEOUT = 30000; // 30秒
const MAX_TOOL_TIMEOUT = 120000; // 2分钟

// 解析结果缓存
const PARSE_CACHE = new Map<string, { calls: ToolCall[]; timestamp: number }>();
const PARSE_CACHE_TTL = 5 * 60 * 1000; // 5分钟过期时间
const PARSE_CACHE_MAX_SIZE = 100;

// 解析统计
const PARSE_STATS = {
  totalCalls: 0,
  cacheHits: 0,
  cacheMisses: 0,
  successCount: 0,
  errorCount: 0,
  formatCounts: {} as Record<string, number>,
};

let parseCallCounter = 0;
const STATS_RESET_INTERVAL = 1000;

// 小写工具名映射缓存（用于快速大小写匹配）
let lowercaseToolMap: Map<string, string> = new Map();

// 参数名映射表
const PARAM_MAPPINGS: Record<string, string> = {
  filepath: 'filePath',
  file_path: 'filePath',
  oldstring: 'oldString',
  old_string: 'oldString',
  oldtext: 'oldString',
  newstring: 'newString',
  new_string: 'newString',
  newtext: 'newString',
};

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
    // 更新小写工具名映射
    lowercaseToolMap.set(tool.name.toLowerCase(), tool.name);
    // 工具变更时清空缓存
    this.clearParseCache();
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
    // 使用小写映射快速查找工具
    let tool = this.tools.get(call.tool);
    let actualToolName = call.tool;

    // 如果没找到，使用小写映射查找
    if (!tool) {
      const lowerToolName = call.tool.toLowerCase();
      const cachedName = lowercaseToolMap.get(lowerToolName);
      if (cachedName) {
        tool = this.tools.get(cachedName);
        actualToolName = cachedName;
      }
      // 如果映射中也没有，尝试遍历查找（兼容性）
      if (!tool) {
        for (const [registeredName, toolDef] of this.tools.entries()) {
          if (registeredName.toLowerCase() === lowerToolName) {
            tool = toolDef;
            actualToolName = registeredName;
            lowercaseToolMap.set(lowerToolName, registeredName); // 更新映射缓存
            break;
          }
        }
      }
      // 记录工具名修复
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
      const adaptedParams = ToolParameterHelper.adaptParameters(call.tool, call.parameters);

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
   * 1. JSON格式: {"tool": "Read", "parameters": {"filePath": "..."}}
   * 2. 代码块格式
   */
  parseToolCallsFromResponse(response: string): ToolCall[] {
    // 超时保护
    const parseStartTime = Date.now();
    const PARSE_TIMEOUT = 5000;

    // 更新统计
    parseCallCounter++;
    if (parseCallCounter >= STATS_RESET_INTERVAL) {
      parseCallCounter = 0;
      PARSE_STATS.totalCalls = 0;
      PARSE_STATS.cacheHits = 0;
      PARSE_STATS.cacheMisses = 0;
      PARSE_STATS.successCount = 0;
      PARSE_STATS.errorCount = 0;
      PARSE_STATS.formatCounts = {};
    }
    PARSE_STATS.totalCalls++;

    if (Date.now() - parseStartTime > PARSE_TIMEOUT) {
      PARSE_STATS.errorCount++;
      return [];
    }

    // 清理响应
    const cleanedResponse = response.replace(
      /^[\u0000-\u001F\u007F-\u009F\u200B-\u200F\uFEFF]+/,
      ''
    );

    // 检查缓存
    const cacheKey = cleanedResponse.slice(0, 200).replace(/\s+/g, ' ').trim();
    const now = Date.now();
    const cached = PARSE_CACHE.get(cacheKey);
    if (cached && now - cached.timestamp < PARSE_CACHE_TTL) {
      PARSE_STATS.cacheHits++;
      return [...cached.calls];
    }
    PARSE_STATS.cacheMisses++;
    if (cached) PARSE_CACHE.delete(cacheKey);

    const calls: ToolCall[] = [];
    const seen = new Set<string>();
    const knownTools = new Set(this.tools.keys());

    const addCall = (
      tool: string,
      params: Record<string, unknown>,
      id?: string,
      format: string = 'unknown'
    ) => {
      const signature = `${tool}:${JSON.stringify(params)}`;
      if (!seen.has(signature) && knownTools.has(tool.toLowerCase())) {
        seen.add(signature);
        calls.push({
          tool: tool.toLowerCase(),
          parameters: params,
          id: id || this.generateToolCallId(),
        });
        PARSE_STATS.formatCounts[format] = (PARSE_STATS.formatCounts[format] || 0) + 1;
      }
    };

    const fixParamNames = (params: Record<string, unknown>): Record<string, unknown> => {
      const fixed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(params)) {
        const lowerKey = key.toLowerCase();
        const mappedKey = PARAM_MAPPINGS[lowerKey] || key;
        fixed[mappedKey] = value;
      }
      return fixed;
    };

    // 策略1: 解析代码块中的 JSON
    const codeBlockRegex = /```(?:json|tool)?\s*\n?([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockRegex.exec(cleanedResponse)) !== null && calls.length < 50) {
      if (Date.now() - parseStartTime > PARSE_TIMEOUT) break;
      try {
        const content = match[1].trim();
        const parsed = JSON.parse(content);

        if (parsed.tool && parsed.parameters) {
          addCall(parsed.tool, fixParamNames(parsed.parameters), parsed.id, 'codeblock');
        } else if (Array.isArray(parsed)) {
          parsed.forEach((item: any) => {
            if (item.tool && item.parameters) {
              addCall(item.tool, fixParamNames(item.parameters), item.id, 'codeblock');
            }
          });
        }
      } catch {
        /* 忽略解析失败 */
      }
    }

    // 策略2: 解析 <toolcall> 标签
    const toolcallRegex = /<toolcall[^>]*>([\s\S]*?)(?:<\/toolcall>|$)/gi;
    while ((match = toolcallRegex.exec(cleanedResponse)) !== null && calls.length < 50) {
      if (Date.now() - parseStartTime > PARSE_TIMEOUT) break;
      try {
        let content = match[1].trim();

        // 处理格式: <toolcall>toolname>{"..."} 或 <toolcall>toolname>\n{...}
        const malformedToolMatch = content.match(/^(\w+)\s*>\s*\{([\s\S]*)\}\s*$/);
        if (malformedToolMatch) {
          const toolName = malformedToolMatch[1].toLowerCase();
          if (knownTools.has(toolName)) {
            try {
              const paramsContent = malformedToolMatch[2].replace(/\}\s*$/, '').trim();
              const parsed = JSON.parse(`{${paramsContent}}`);
              const params = parsed.parameters || parsed;
              if (Object.keys(params).length > 0) {
                addCall(
                  toolName,
                  fixParamNames(params as Record<string, unknown>),
                  undefined,
                  'toolcall-malformed'
                );
              }
            } catch {
              /* 忽略 */
            }
          }
          continue;
        }

        // 格式: <toolcall>toolname{...}</toolcall>
        const styleMatch = content.match(/^(\w+)\s*\{([\s\S]*?)\}$/);
        if (styleMatch) {
          const toolName = styleMatch[1].toLowerCase();
          if (knownTools.has(toolName)) {
            const paramsStr = styleMatch[2];
            let params: Record<string, unknown> = {};
            try {
              params = this.parseParameters(paramsStr);
            } catch {
              /* 忽略 */
            }
            if (Object.keys(params).length > 0) {
              addCall(toolName, params, undefined, 'toolcall-style');
            }
          }
          continue;
        }

        // 格式: <toolcall>{"tool":"name","parameters":{...}}</toolcall>
        try {
          const parsed = JSON.parse(content);
          if (parsed.tool && parsed.parameters) {
            addCall(parsed.tool, fixParamNames(parsed.parameters), parsed.id, 'toolcall-json');
          }
        } catch {
          // 尝试解析多个独立 JSON 对象（如 multiedit 分开传入 edits 和 filePath）
          try {
            // 使用更智能的方式提取 JSON 对象：匹配 { 开头到对应的 } 结尾
            const jsonObjects: string[] = [];
            let i = 0;
            const str = content;
            while (i < str.length) {
              if (str[i] === '{') {
                let depth = 0;
                let j = i;
                for (; j < str.length; j++) {
                  if (str[j] === '{') depth++;
                  else if (str[j] === '}') {
                    depth--;
                    if (depth === 0) {
                      jsonObjects.push(str.substring(i, j + 1));
                      break;
                    }
                  }
                }
                i = j + 1;
              } else {
                i++;
              }
            }

            if (jsonObjects.length > 0) {
              const mergedParams: Record<string, unknown> = {};
              for (const jsonStr of jsonObjects) {
                try {
                  const obj = JSON.parse(jsonStr);
                  Object.assign(mergedParams, obj);
                } catch {
                  /* 忽略 */
                }
              }

              // 尝试从内容中提取工具名
              const toolNameMatch = content.match(/^(\w+)/);
              if (toolNameMatch && knownTools.has(toolNameMatch[1].toLowerCase())) {
                const toolName = toolNameMatch[1].toLowerCase();
                if (Object.keys(mergedParams).length > 0) {
                  addCall(toolName, fixParamNames(mergedParams), undefined, 'toolcall-multi-json');
                }
              }
            }
          } catch {
            /* 忽略 */
          }
        }
      } catch {
        /* 忽略 */
      }
    }

    // 策略3: 解析 ToolName{...} 格式
    const curlyRegex = /\b([A-Z][a-zA-Z0-9]*)\s*\{([\s\S]*?)\}/g;
    while ((match = curlyRegex.exec(cleanedResponse)) !== null && calls.length < 50) {
      if (Date.now() - parseStartTime > PARSE_TIMEOUT) break;
      const toolName = match[1].toLowerCase();
      if (!knownTools.has(toolName)) continue;

      const paramsStr = match[2];
      if (paramsStr.includes('(') || paramsStr.includes(')')) continue;

      try {
        const params = this.parseParameters(paramsStr);
        if (Object.keys(params).length > 0) {
          addCall(toolName, params, undefined, 'curly-style');
        }
      } catch {
        /* 忽略 */
      }
    }

    // 策略4: 解析 JSON 对象
    const jsonRegex = /\{\s*"tool"\s*:\s*"(\w+)"\s*,\s*"parameters"\s*:\s*\{[\s\S]*?\}\s*\}/g;
    while ((match = jsonRegex.exec(cleanedResponse)) !== null && calls.length < 50) {
      if (Date.now() - parseStartTime > PARSE_TIMEOUT) break;
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.tool && parsed.parameters) {
          addCall(parsed.tool, fixParamNames(parsed.parameters), parsed.id, 'json-obj');
        }
      } catch {
        /* 忽略 */
      }
    }

    // 保存缓存
    if (calls.length > 0) {
      if (PARSE_CACHE.size >= PARSE_CACHE_MAX_SIZE) {
        Array.from(PARSE_CACHE.keys())
          .slice(0, 20)
          .forEach((k) => PARSE_CACHE.delete(k));
      }
      PARSE_CACHE.set(cacheKey, { calls: [...calls], timestamp: Date.now() });
    }

    PARSE_STATS.successCount++;
    return calls;
  }

  /**
   * 检查是否有工具调用
   */
  hasToolCalls(response: string): boolean {
    return this.parseToolCallsFromResponse(response).length > 0;
  }

  /**
   * 检测响应中是否存在错误格式的工具调用
   * 用于识别 AI 返回的不符合要求的格式，以便进行纠正
   */
  detectMalformedToolCalls(
    response: string,
    _parsedCalls?: ToolCall[] // 保留参数以兼容调用，但当前版本不使用
  ): {
    hasMalformed: boolean;
    detectedFormats: string[];
    examples: string[];
  } {
    const formats: string[] = [];
    const examples: string[] = [];

    // 1. 检测 XML 标签格式（如 <Read>, <function_calls>）
    const xmlTagRegex = /<\/?[A-Z][a-zA-Z0-9]*[^>]*>|<function_calls[^>]*>/g;
    const xmlMatches = response.match(xmlTagRegex);
    if (xmlMatches && xmlMatches.length > 0) {
      formats.push('XML tags (e.g., <ToolName>)');
      examples.push(...xmlMatches.slice(0, 2).map((m) => m.slice(0, 30)));
    }

    // 2. 检测函数调用格式（如 Read{...} 或 Read(...)）
    const functionCallRegex = /\b([A-Z][a-zA-Z0-9]*)\s*(\{|\()/g;
    const funcMatches = response.match(functionCallRegex);
    if (funcMatches && funcMatches.length > 0) {
      // 排除已知工具名称的小写形式
      const knownTools = new Set(this.tools.keys());
      const invalidCalls = funcMatches.filter((match) => {
        const toolName = match.match(/\b([A-Z][a-zA-Z0-9]*)/)?.[1];
        return toolName && !knownTools.has(toolName.toLowerCase());
      });
      if (invalidCalls.length > 0) {
        formats.push('Function notation (e.g., ToolName{...})');
        examples.push(...invalidCalls.slice(0, 2).map((m) => m.slice(0, 30)));
      }
    }

    // 3. 检测大写工具名称在 JSON 中
    const uppercaseToolRegex = /\{\s*"tool"\s*:\s*"[A-Z]/g;
    if (uppercaseToolRegex.test(response)) {
      formats.push('Uppercase tool names in JSON (use lowercase)');
      const match = response.match(uppercaseToolRegex);
      if (match) examples.push(match[0].slice(0, 30));
    }

    // 4. 检测混合格式（如 ToolName {"tool": ...}）
    const mixedFormatRegex = /\b([A-Z][a-zA-Z0-9]*)\s*\{[^}]*"tool"\s*:/g;
    if (mixedFormatRegex.test(response)) {
      formats.push('Mixed format (e.g., ToolName {tool: ...})');
      const match = response.match(mixedFormatRegex);
      if (match) examples.push(match[0].slice(0, 30));
    }

    return {
      hasMalformed: formats.length > 0,
      detectedFormats: formats,
      examples: [...new Set(examples)], // 去重
    };
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
    lowercaseToolMap.clear();
    this.clearParseCache();
    logger.debug('All tools cleared');
  }

  /**
   * 获取工具数量
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * 生成工具调用ID
   */
  private generateToolCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 解析参数字符串
   */
  private parseParameters(paramsStr: string): Record<string, unknown> {
    let parameters: Record<string, unknown> = {};
    const startTime = Date.now();

    // 清理参数字符串：移除首尾空白和换行
    const cleanedParams = paramsStr.trim();

    try {
      const parsed = JSON.parse(`{${cleanedParams}}`);
      if (parsed.parameters) {
        parameters = parsed.parameters as Record<string, unknown>;
      } else if (Object.keys(parsed).length > 0) {
        parameters = parsed;
      }
    } catch {
      // 超时保护：解析时间超过 10ms 则跳过
      if (Date.now() - startTime > 10) {
        return {};
      }

      const keyValuePairs = paramsStr.match(/(\w+)\s*[:=]\s*"([^"]*)"/g) || [];
      for (const pair of keyValuePairs) {
        const [key, ...valueParts] = pair.split(/[:=]\s*"/);
        if (key && valueParts.length > 0) {
          const value = valueParts.join(':').replace(/"$/, '');
          parameters[key.trim()] = value.trim();
        }
      }

      // 再次检查超时
      if (Date.now() - startTime > 10) {
        return {};
      }

      if (Object.keys(parameters).length === 0 && paramsStr.includes(':')) {
        try {
          const parsed = JSON.parse(`{${paramsStr}}`);
          Object.assign(parameters, parsed);
        } catch {
          // 忽略
        }
      }
    }

    // 超时保护
    if (Date.now() - startTime > 10) {
      return {};
    }

    // 参数名标准化
    const normalizedParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parameters)) {
      const normalizedKey = key.toLowerCase();
      const mappedKey = PARAM_MAPPINGS[normalizedKey] || key;
      normalizedParams[mappedKey] = value;
    }

    return normalizedParams;
  }

  /**
   * 获取解析统计
   */
  getParseStats(): {
    totalCalls: number;
    cacheHits: number;
    cacheMisses: number;
    cacheSize: number;
    cacheHitRate: string;
    formatCounts: Record<string, number>;
    successCount: number;
    errorCount: number;
  } {
    const total = PARSE_STATS.cacheHits + PARSE_STATS.cacheMisses;
    const hitRate = total > 0 ? ((PARSE_STATS.cacheHits / total) * 100).toFixed(1) : '0.0';

    return {
      totalCalls: PARSE_STATS.totalCalls,
      cacheHits: PARSE_STATS.cacheHits,
      cacheMisses: PARSE_STATS.cacheMisses,
      cacheSize: PARSE_CACHE.size,
      cacheHitRate: `${hitRate}%`,
      formatCounts: { ...PARSE_STATS.formatCounts },
      successCount: PARSE_STATS.successCount,
      errorCount: PARSE_STATS.errorCount,
    };
  }

  /**
   * 清空解析缓存
   */
  clearParseCache(): void {
    PARSE_CACHE.clear();
    logger.debug('Parse cache cleared');
  }

  /**
   * 重置解析统计
   */
  resetParseStats(): void {
    PARSE_STATS.totalCalls = 0;
    PARSE_STATS.cacheHits = 0;
    PARSE_STATS.cacheMisses = 0;
    PARSE_STATS.successCount = 0;
    PARSE_STATS.errorCount = 0;
    PARSE_STATS.formatCounts = {};
    parseCallCounter = 0;
    logger.debug('Parse stats reset');
  }
}

/**
 * 创建工具引擎实例
 */
export function createToolEngine(): ToolEngine {
  return new ToolEngine();
}
