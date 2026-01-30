import type { Message, EnhancedMessage, MessagePart, ToolCall, ToolResult } from '../types';
import { createMessage, messageToText, filterMessageParts, PartType } from '../types/message';
import { ContextCompactor, createContextCompactor } from './context-compactor';
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
  private useEnhancedMessages: boolean = false; // 是否使用增强消息格式
  private compactor: ContextCompactor; // 上下文压缩器
  private autoCompress: boolean = false; // 是否自动压缩
  private sessionId: string | null = null; // 会话ID，用于隔离不同会话的历史
  private baseHistoryFile: string; // 基础历史文件路径（不包含会话ID）
  private systemPromptSet: boolean = false; // 是否已设置系统提示词

  constructor(
    maxHistory: number = 10,
    maxTokens: number = 8000,
    historyFile?: string
  ) {
    this.maxHistory = maxHistory;
    this.maxTokens = maxTokens;
    // 使用系统根目录，除非指定了自定义路径
    this.baseHistoryFile = historyFile || path.join(getHistoryBasePath(), 'agent-history.json');
    this.historyFile = this.baseHistoryFile;
    this.compactor = createContextCompactor({
      enabled: false, // 默认禁用自动压缩
      maxTokens: maxTokens,
      reserveTokens: Math.max(1000, maxTokens * 0.2), // 保留 20% 给输出
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
    if (this.autoCompress && this.compactor.needsCompaction(this.messages)) {
      // 异步压缩，不阻塞
      this.compact().then((result) => {
        if (result.compressed) {
          console.log(`上下文已压缩: 节省 ${result.savedTokens} tokens`);
        }
      }).catch(() => {
        // 忽略压缩错误
      });
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

    const parts = calls.map(call => ({
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
    const systemMessages = this.messages.filter(m => m.role === 'system');

    if (systemMessages.length > 0) {
      result.push(...systemMessages.map(msg => this.convertToLegacyMessage(msg)));
      currentTokens = systemMessages.reduce((sum, msg) => sum + this.estimateMessageTokens(msg), 0);
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

      result.unshift(this.convertToLegacyMessage(msg));
      currentTokens += tokens;
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
   * 手动压缩上下文
   */
  async compact(): Promise<{
    compressed: boolean;
    messages: (Message | EnhancedMessage)[];
    originalTokens: number;
    compressedTokens: number;
    savedTokens: number;
    prunedParts: number;
  }> {
    const result = await this.compactor.compact(this.messages);
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
      // 增强消息：计算所有非忽略部分的 tokens
      const parts = filterMessageParts(msg as EnhancedMessage);
      return parts.reduce((sum, part) => sum + this.estimateTextTokens(part.content), 0);
    } else {
      // 旧格式消息
      return this.estimateTextTokens(msg.content);
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
   * 设置会话ID（用于隔离不同会话的历史）
   */
  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
    // 更新历史文件路径
    this.historyFile = sessionId
      ? this.baseHistoryFile.replace('.json', `-${sessionId}.json`)
      : this.baseHistoryFile;
  }

  /**
   * 获取当前会话ID
   */
  getSessionId(): string | null {
    return this.sessionId;
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
    return this.messages.map(msg => this.convertToLegacyMessage(msg));
  }

  /**
   * 设置系统提示词
   */
  setSystemPrompt(prompt: string): void {
    // 移除旧的系统提示词
    this.messages = this.messages.filter((m) => m.role !== 'system');

    // 添加新的系统提示词到开头
    this.messages.unshift({ role: 'system', content: prompt });
    this.systemPromptSet = true;
  }

  /**
   * 保存历史到文件（转换为旧格式保存）
   */
  async saveHistory(): Promise<void> {
    try {
      const legacyMessages = this.messages.map(msg => this.convertToLegacyMessage(msg));
      await fs.writeFile(this.historyFile, JSON.stringify(legacyMessages, null, 2), 'utf-8');
    } catch (error) {
      console.warn(`保存历史记录失败: ${(error as Error).message}`);
    }
  }

  /**
   * 从文件加载历史
   */
  async loadHistory(): Promise<void> {
    try {
      if (await fs.pathExists(this.historyFile)) {
        const content = await fs.readFile(this.historyFile, 'utf-8');
        const loaded = JSON.parse(content) as Message[];
        // 加载的历史是旧格式，直接使用
        this.messages = loaded;
      }
    } catch (error) {
      // 静默处理历史记录加载失败
      // 第一次运行时历史文件不存在是正常的
    }
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
   * 估算token数量（粗略估算：中文约1字符=1token，英文约4字符=1token）
   */
  private estimateTextTokens(text: string): number {
    // 简单估算：中文字符计数 + 英文单词数
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishChars = text.length - chineseChars;
    const englishWords = englishChars / 4;

    return Math.ceil(chineseChars + englishWords);
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
