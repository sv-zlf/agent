import type { Message, EnhancedMessage, MessagePart, ToolCall, ToolResult } from '../types';
import { createMessage, messageToText, filterMessageParts, PartType } from '../types/message';
import { ContextCompactor, createContextCompactor, LLMChatFunction } from './context-compactor';
import { SemanticCompactor, createSemanticCompactor } from './semantic-compactor';
import { TokenEstimator } from './token-estimator';
import * as fs from 'fs-extra';
import * as path from 'path';
import { getHistoryBasePath } from '../utils';

/**
 * 对话上下文管理器
 * 支持旧的 Message 格式和新的 EnhancedMessage 格式
 */
export class ContextManager {
  private messages: (Message | EnhancedMessage)[] = [];
  private maxHistory: number;
  private maxTokens: number;
  private historyFile: string;
  private useEnhancedMessages: boolean = false;
  private compactor: ContextCompactor;
  private semanticCompactor: SemanticCompactor;
  private autoCompress: boolean = false;
  private useSemanticCompression: boolean = false;
  private systemPromptSet: boolean = false;
  private llmChat: LLMChatFunction | null = null;

  constructor(maxHistory: number = 10, maxTokens: number = 8000, historyFile?: string) {
    this.maxHistory = maxHistory;
    this.maxTokens = maxTokens;
    this.historyFile = historyFile || path.join(getHistoryBasePath(), 'agent-history.json');
    this.compactor = createContextCompactor({
      enabled: false,
      maxTokens: maxTokens,
      reserveTokens: Math.max(1000, maxTokens * 0.2),
    });
    this.semanticCompactor = createSemanticCompactor({
      enabled: true,
      maxTokens: maxTokens,
      reserveTokens: Math.max(1000, maxTokens * 0.2),
      minImportanceScore: 0.3,
      maxSimilarityThreshold: 0.85,
      enableSemanticDeduplication: true,
      enableSmartSummarization: true,
      summarizeOlderThan: 3,
      summaryMaxTokens: 500,
    });
  }

  /**
   * 添加消息到上下文（旧格式，向后兼容）
   */
  addMessage(role: 'user' | 'assistant', content: string): void {
    this.messages.push({ role, content });

    // 限制历史消息数量
    if (this.messages.length > this.maxHistory * 2) {
      // 保留最近的maxHistory轮对话
      this.messages = this.messages.slice(-this.maxHistory * 2);
    }

    // 自动压缩（如果启用）
    if (this.autoCompress) {
      if (this.useSemanticCompression) {
        const result = this.semanticCompactor.quickCompact(this.messages);
        if (result.compressed) {
          this.messages = result.messages;
          console.log(
            `上下文已压缩: 节省 ${result.savedTokens} tokens, 移除 ${result.removedCount} 条消息`
          );
        }
      } else if (this.compactor.needsCompaction(this.messages)) {
        this.compact().catch(() => {});
      }
    }
  }

  /**
   * 启用增强消息模式
   */
  enableEnhancedMessages(): void {
    this.useEnhancedMessages = true;
  }

  /**
   * 添加增强消息到上下文
   */
  addEnhancedMessage(message: EnhancedMessage): void {
    this.messages.push(message);

    // 限制历史消息数量
    if (this.messages.length > this.maxHistory * 2) {
      this.messages = this.messages.slice(-this.maxHistory * 2);
    }
  }

  /**
   * 添加消息部分（自动创建增强消息）
   */
  addMessagePart(
    role: 'user' | 'assistant' | 'system',
    part: MessagePart | MessagePart[],
    agent?: string
  ): void {
    const parts = Array.isArray(part) ? part : [part];
    const message = createMessage(role, parts, agent);
    this.addEnhancedMessage(message);
  }

  /**
   * 添加工具调用记录（作为增强消息）
   */
  addToolCalls(calls: ToolCall[]): void {
    if (!this.useEnhancedMessages || calls.length === 0) {
      return;
    }

    const parts = calls.map((call) => ({
      type: PartType.TOOL_CALL,
      id: call.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content: JSON.stringify({ tool: call.tool, parameters: call.parameters }),
      metadata: { tool: call.tool, parameters: call.parameters },
    }));

    const message = createMessage('assistant', parts, 'default');
    this.addEnhancedMessage(message);
  }

  /**
   * 添加工具执行结果（作为增强消息）
   */
  addToolResults(calls: ToolCall[], results: ToolResult[]): void {
    if (!this.useEnhancedMessages) {
      // 如果没有启用增强模式，使用旧方法
      const text = this.formatToolResultsForAI(calls, results);
      this.addMessage('user', text);
      return;
    }

    const parts = results.map((result, index) => {
      const call = calls[index];
      return {
        type: PartType.TOOL_RESULT,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        content: result.output || result.error || '',
        metadata: {
          toolCallId: call?.id || '',
          tool: call?.tool || 'unknown',
          success: result.success,
          error: result.error,
          duration: result.metadata?.duration,
          truncated: result.output && result.output.length > 2000,
        },
      };
    });

    const message = createMessage('user', parts);
    this.addEnhancedMessage(message);
  }

  /**
   * 获取上下文消息（转换为旧格式以兼容 API）
   */
  getContext(maxTokens?: number): Message[] {
    const limit = maxTokens ?? this.maxTokens;
    let result: Message[] = [];
    let currentTokens = 0;

    // 首先确保system消息在结果中（如果存在）
    const systemMessages = this.messages.filter((m) => m.role === 'system');

    // 调试日志
    if (this.systemPromptSet) {
      console.log(`[getContext] 🔍 systemPromptSet=true, this.messages.length=${this.messages.length}`);
      console.log(`[getContext] 🔍 过滤出的 systemMessages.length=${systemMessages.length}`);
      console.log(`[getContext] 🔍 所有消息角色: ${this.messages.map((m, i) => `${i}:${m.role}`).join(', ')}`);

      if (systemMessages.length === 0) {
        console.warn('[getContext] ⚠️  systemPromptSet=true 但没有找到 system 消息！');
        console.warn(`[getContext] ⚠️  this.messages 的类型: ${Array.isArray(this.messages) ? 'Array' : typeof this.messages}`);
        if (this.messages.length > 0) {
          console.warn(`[getContext] ⚠️  第一条消息:`, JSON.stringify(this.messages[0]).substring(0, 200));
        }
      }
    }

    if (systemMessages.length > 0) {
      console.log(`[getContext] 🔍 开始转换 ${systemMessages.length} 条系统消息`);
      const systemMsgs = systemMessages
        .map((msg) => {
          const converted = this.convertToLegacyMessage(msg);
          console.log(`[getContext] 🔍 转换后: role=${converted.role}, content长度=${converted.content?.length || 0}`);
          return converted;
        })
        .filter((msg) => {
          const hasContent = msg.content && msg.content.trim().length > 0;
          if (!hasContent) {
            console.warn('[getContext] ⚠️  系统消息被过滤（内容为空）');
          }
          return hasContent;
        });

      if (systemMsgs.length === 0) {
        console.warn('[getContext] ⚠️  找到了 system 消息但转换后为空！');
      }

      result.push(...systemMsgs);
      currentTokens = systemMsgs.reduce((sum, msg) => sum + this.estimateMessageTokens(msg), 0);
    }

    // 从最新的消息开始倒序添加（排除system消息）
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];

      // 跳过system消息（已经添加过了）
      if (msg.role === 'system') {
        continue;
      }

      const tokens = this.estimateMessageTokens(msg);

      if (currentTokens + tokens > limit) {
        break;
      }

      const legacyMsg = this.convertToLegacyMessage(msg);

      // 过滤掉空消息
      if (legacyMsg.content && legacyMsg.content.trim().length > 0) {
        result.unshift(legacyMsg);
        currentTokens += tokens;
      }
    }

    return result;
  }

  /**
   * 获取原始消息（可能是增强格式）
   */
  getRawMessages(): (Message | EnhancedMessage)[] {
    return [...this.messages];
  }

  /**
   * 启用自动压缩
   */
  enableAutoCompress(): void {
    this.autoCompress = true;
    this.compactor.updateConfig({ enabled: true });
  }

  /**
   * 禁用自动压缩
   */
  disableAutoCompress(): void {
    this.autoCompress = false;
    this.compactor.updateConfig({ enabled: false });
  }

  /**
   * 启用语义压缩（基于重要性评分和语义相似度）
   */
  enableSemanticCompression(): void {
    this.useSemanticCompression = true;
    this.autoCompress = true;
  }

  /**
   * 禁用语义压缩
   */
  disableSemanticCompression(): void {
    this.useSemanticCompression = false;
  }

  /**
   * 评估消息重要性
   */
  assessMessageImportance(msgIndex: number): { score: number; factors: any } {
    const msg = this.messages[msgIndex];
    if (!msg) return { score: 0, factors: {} };
    return this.semanticCompactor.assessImportance(msg, msgIndex, this.messages.length);
  }

  /**
   * 检测重复消息
   */
  detectDuplicateMessages(): number[] {
    return this.semanticCompactor.detectDuplicates(this.messages);
  }

  /**
   * 手动压缩上下文
   */
  async compact(): Promise<{
    compressed: boolean;
    messages: (Message | EnhancedMessage)[];
    originalTokens: number;
    compressedTokens: number;
    savedTokens: number;
    prunedParts: number;
    removedCount?: number;
    summarizedCount?: number;
    deduplicatedCount?: number;
  }> {
    if (this.useSemanticCompression) {
      const result = await this.semanticCompactor.compact(this.messages);
      if (result.compressed) {
        this.messages = result.messages;
      }
      return {
        ...result,
        prunedParts: result.removedCount + result.summarizedCount,
      };
    }

    const result = await this.compactor.compact(this.messages);
    if (result.compressed) {
      this.messages = result.messages;
    }
    return result;
  }

  /**
   * 快速压缩（不调用 LLM，适合实时使用）
   */
  quickCompact(): {
    compressed: boolean;
    messages: (Message | EnhancedMessage)[];
    originalTokens: number;
    compressedTokens: number;
    savedTokens: number;
    removedCount: number;
    deduplicatedCount: number;
  } {
    const result = this.semanticCompactor.quickCompact(this.messages);
    if (result.compressed) {
      this.messages = result.messages;
    }
    return result;
  }

  /**
   * 设置 LLM 聊天函数（用于 LLM 压缩）
   */
  setLLMChat(llmChat: LLMChatFunction): void {
    this.llmChat = llmChat;
  }

  /**
   * 检查是否支持 LLM 压缩
   */
  supportsLLMCompact(): boolean {
    return this.llmChat !== null;
  }

  /**
   * 使用 LLM 进行智能压缩（集成 compaction.txt）
   */
  async llmCompact(): Promise<{
    compressed: boolean;
    messages: (Message | EnhancedMessage)[];
    originalTokens: number;
    compressedTokens: number;
    savedTokens: number;
    prunedParts: number;
  }> {
    if (!this.supportsLLMCompact()) {
      throw new Error('未配置 LLM 聊天函数，无法进行 LLM 压缩');
    }

    const result = await this.compactor.llmCompact(this.messages, {
      llmChat: this.llmChat!,
    });

    if (result.compressed) {
      this.messages = result.messages;
    }
    return result;
  }

  /**
   * 检查是否需要压缩
   */
  shouldCompress(): boolean {
    return this.compactor.needsCompaction(this.messages);
  }

  /**
   * 获取压缩器（用于自定义配置）
   */
  getCompactor(): ContextCompactor {
    return this.compactor;
  }

  /**
   * 估算当前上下文的 token 数量
   */
  estimateTokens(): number {
    return this.compactor.estimateMessages(this.messages);
  }

  /**
   * 将消息转换为旧格式（Message）
   */
  private convertToLegacyMessage(msg: Message | EnhancedMessage): Message {
    // 检查是否是增强消息
    if ('parts' in msg) {
      // 对于系统消息，不要使用 messageToText，因为它会过滤掉 SYSTEM 部件
      if (msg.role === 'system') {
        // 系统消息：合并所有非忽略的文本部件
        const textParts = (msg as EnhancedMessage).parts
          .filter((part) => !part.ignored)
          .filter((part) => part.type === PartType.TEXT || part.type === PartType.REASONING)
          .map((part) => part.content)
          .join('\n');
        return {
          role: 'system',
          content: textParts || '',
        };
      }
      return {
        role: msg.role,
        content: messageToText(msg as EnhancedMessage),
      };
    }
    return msg;
  }

  /**
   * 估算消息的 token 数量
   */
  private estimateMessageTokens(msg: Message | EnhancedMessage): number {
    if ('parts' in msg) {
      const parts = filterMessageParts(msg as EnhancedMessage);
      return parts.reduce((sum, part) => sum + TokenEstimator.estimate(part.content), 0);
    } else {
      return TokenEstimator.estimate(msg.content);
    }
  }

  /**
   * 添加文件内容到上下文
   */
  async addFileContext(filePath: string, maxLines: number = 100): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      let fileContext = '';
      if (lines.length <= maxLines) {
        fileContext = content;
      } else {
        // 文件太大，只取前后部分
        const half = Math.floor(maxLines / 2);
        fileContext = [
          ...lines.slice(0, half),
          `... (省略 ${lines.length - maxLines} 行) ...`,
          ...lines.slice(-half),
        ].join('\n');
      }

      this.addMessage('user', `以下是文件 ${filePath} 的内容:\n\`\`\`\n${fileContext}\n\`\`\``);
    } catch (error) {
      throw new Error(`读取文件失败: ${(error as Error).message}`);
    }
  }

  /**
   * 清空上下文
   */
  clearContext(): void {
    this.messages = [];
    this.systemPromptSet = false;
  }

  /**
   * 检查系统提示词是否已设置
   */
  isSystemPromptSet(): boolean {
    return this.systemPromptSet;
  }

  /**
   * 获取历史消息（转换为旧格式）
   */
  getHistory(): Message[] {
    return this.messages.map((msg) => this.convertToLegacyMessage(msg));
  }

  /**
   * 设置系统提示词
   */
  setSystemPrompt(prompt: string): void {
    // 确保 messages 是数组
    if (!Array.isArray(this.messages)) {
      this.messages = [];
    }

    // 移除旧的系统提示词
    this.messages = this.messages.filter((m) => m.role !== 'system');

    // 添加新的系统提示词到开头
    this.messages.unshift({ role: 'system', content: prompt });
    this.systemPromptSet = true;

    // 调试日志
    const systemMsgs = this.messages.filter((m) => m.role === 'system');
    console.log(
      `[setSystemPrompt] 已设置系统提示词 (${prompt.length} 字符), 当前系统消息数: ${systemMsgs.length}`
    );
  }

  /**
   * 保存历史到文件（转换为旧格式保存）
   */
  async saveHistory(): Promise<void> {
    try {
      const legacyMessages = this.messages.map((msg) => this.convertToLegacyMessage(msg));
      await fs.ensureDir(path.dirname(this.historyFile));
      await fs.writeFile(this.historyFile, JSON.stringify(legacyMessages, null, 2), 'utf-8');
    } catch (error) {
      console.warn(`保存历史记录失败: ${(error as Error).message}`);
    }
  }

  /**
   * 获取当前消息数量
   */
  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * 从文件加载历史
   */
  async loadHistory(): Promise<void> {
    try {
      if (await fs.pathExists(this.historyFile)) {
        const content = await fs.readFile(this.historyFile, 'utf-8');
        const loaded = JSON.parse(content) as Message[];

        // 🔑 修复：加载前先保存当前的系统消息
        const existingSystemMessages = this.messages.filter((m) => m.role === 'system');

        // 加载的历史是旧格式，直接使用
        this.messages = loaded;

        // 检查加载的历史中是否有系统消息
        const loadedSystemMessages = loaded.filter((m) => m.role === 'system');

        if (loadedSystemMessages.length > 0) {
          // 历史中有系统消息，使用历史中的
          this.systemPromptSet = true;
          console.log(
            `[loadHistory] 已加载 ${loaded.length} 条消息，其中 ${loadedSystemMessages.length} 条系统消息`
          );
        } else if (existingSystemMessages.length > 0) {
          // 历史中没有系统消息，但内存中有，恢复它们
          this.messages.unshift(...existingSystemMessages);
          this.systemPromptSet = true;
          console.log(
            `[loadHistory] 已加载 ${loaded.length} 条消息，历史中没有系统消息，已恢复 ${existingSystemMessages.length} 条系统消息`
          );
        } else {
          // 历史和内存中都没有系统消息
          this.systemPromptSet = false;
          console.log(`[loadHistory] 已加载 ${loaded.length} 条消息，但没有系统消息`);
        }
      }
    } catch (error) {
      // 静默处理历史记录加载失败
      console.warn(`[loadHistory] 加载失败: ${(error as Error).message}`);
    }
  }

  /**
   * 更新历史文件路径（用于切换会话）
   */
  updateHistoryFile(newHistoryFile: string): void {
    this.historyFile = newHistoryFile;
  }

  /**
   * 清空历史文件
   */
  async clearHistoryFile(): Promise<void> {
    try {
      await fs.remove(this.historyFile);
    } catch (error) {
      console.warn(`清空历史记录失败: ${(error as Error).message}`);
    }
  }

  /**
   * 格式化工具执行结果给AI（旧格式兼容）
   */
  private formatToolResultsForAI(calls: ToolCall[], results: ToolResult[]): string {
    const lines: string[] = ['工具执行结果：\n'];

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const result = results[i];

      lines.push(`**${call.tool}**`);
      if (result.success) {
        let output = result.output || '';
        if (output.length > 2000) {
          output = output.substring(0, 2000) + '\n... (内容过长，已截断)';
        }
        lines.push(`✓ 成功`);
        if (output) {
          lines.push(`\n${output}`);
        }
      } else {
        lines.push(`✗ 失败: ${result.error}`);
      }
      lines.push(''); // 空行分隔
    }

    return lines.join('\n');
  }
}

/**
 * 创建上下文管理器实例
 */
export function createContextManager(
  maxHistory?: number,
  maxTokens?: number,
  historyFile?: string
): ContextManager {
  return new ContextManager(maxHistory, maxTokens, historyFile);
}
