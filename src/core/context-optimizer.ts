/**
 * 上下文压缩器 - 参考 opencode 的智能 token 管理
 */

import type { Message, EnhancedMessage } from '../types';
import { messageToText, filterMessageParts, PartType } from '../types/message';

/**
 * 压缩策略
 */
export enum CompressionStrategy {
  CONSERVATIVE = 'conservative', // 保守：只删除旧消息
  BALANCED = 'balanced',         // 平衡：删除旧消息和摘要
  AGGRESSIVE = 'aggressive',     // 激进：大量摘要和删除
}

/**
 * 压缩配置
 */
export interface CompressionConfig {
  maxTokens: number;                // 最大 token 数量
  strategy: CompressionStrategy;    // 压缩策略
  reserveRecentMessages: number;    // 保留最近的消息数量
  summarizeThreshold: number;       // 触发摘要的阈值（token 数）
  compressionLevel: number;         // 压缩级别 (0-1, 越大越激进)
}

/**
 * 压缩结果
 */
export interface CompressionResult {
  compressed: boolean;
  originalSize: number;
  compressedSize: number;
  savedTokens: number;
  appliedStages: string[];
}

/**
 * 压缩阶段
 */
type CompressionStage = (
  messages: (Message | EnhancedMessage)[],
  config: CompressionConfig
) => Promise<(Message | EnhancedMessage)[]>;

/**
 * 上下文压缩器
 */
export class ContextOptimizer {
  private config: CompressionConfig;

  constructor(config?: Partial<CompressionConfig>) {
    this.config = {
      maxTokens: 120000,
      strategy: CompressionStrategy.BALANCED,
      reserveRecentMessages: 6,
      summarizeThreshold: 0.8,
      compressionLevel: 0.5,
      ...config,
    };
  }

  /**
   * 设置配置
   */
  setConfig(config: Partial<CompressionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): CompressionConfig {
    return { ...this.config };
  }

  /**
   * 检查是否需要压缩
   */
  shouldCompress(messages: (Message | EnhancedMessage)[]): boolean {
    const tokens = this.estimateTokens(messages);
    const threshold = this.config.maxTokens * this.config.summarizeThreshold;
    return tokens > threshold;
  }

  /**
   * 压缩上下文
   */
  async compress(
    messages: (Message | EnhancedMessage)[]
  ): Promise<{ messages: (Message | EnhancedMessage)[]; result: CompressionResult }> {
    const originalSize = this.estimateTokens(messages);
    const appliedStages: string[] = [];

    let compressed = messages;
    let currentTokens = originalSize;

    // 压缩阶段（按顺序执行）
    const stages: Array<{ name: string; stage: CompressionStage }> = [
      { name: 'removeOldMessages', stage: this.removeOldMessages },
      { name: 'mergeSystemMessages', stage: this.mergeSystemMessages },
      { name: 'summarizeConversations', stage: this.summarizeConversations },
      { name: 'removeRedundantFiles', stage: this.removeRedundantFiles },
    ];

    for (const { name, stage } of stages) {
      // 检查是否还需要继续压缩
      if (!this.shouldCompress(compressed)) {
        break;
      }

      const previousSize = currentTokens;
      compressed = await stage(compressed, this.config);
      currentTokens = this.estimateTokens(compressed);

      if (currentTokens < previousSize) {
        appliedStages.push(name);
      }
    }

    const compressedSize = currentTokens;
    const savedTokens = originalSize - compressedSize;

    return {
      messages: compressed,
      result: {
        compressed: savedTokens > 0,
        originalSize,
        compressedSize,
        savedTokens,
        appliedStages,
      },
    };
  }

  /**
   * 阶段 1: 删除旧消息
   */
  private async removeOldMessages(
    messages: (Message | EnhancedMessage)[],
    config: CompressionConfig
  ): Promise<(Message | EnhancedMessage)[]> {
    // 保留系统消息
    const systemMessages = messages.filter(m => m.role === 'system');

    // 保留最近的消息
    const recentMessages = messages
      .filter(m => m.role !== 'system')
      .slice(-config.reserveRecentMessages);

    return [...systemMessages, ...recentMessages];
  }

  /**
   * 阶段 2: 合并系统消息
   */
  private async mergeSystemMessages(
    messages: (Message | EnhancedMessage)[],
    _config: CompressionConfig
  ): Promise<(Message | EnhancedMessage)[]> {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    // 如果有多个系统消息，合并为一个
    if (systemMessages.length <= 1) {
      return messages;
    }

    const mergedContent = systemMessages
      .map(m => ('content' in m ? m.content : messageToText(m as EnhancedMessage)))
      .join('\n\n---\n\n');

    const merged: Message = {
      role: 'system',
      content: mergedContent,
    };

    return [merged, ...otherMessages];
  }

  /**
   * 阶段 3: 摘要对话
   */
  private async summarizeConversations(
    messages: (Message | EnhancedMessage)[],
    config: CompressionConfig
  ): Promise<(Message | EnhancedMessage)[]> {
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // 如果消息数量不多，不需要摘要
    if (conversationMessages.length <= config.reserveRecentMessages) {
      return messages;
    }

    // 分离需要摘要的旧消息和保留的新消息
    const oldMessages = conversationMessages.slice(0, -config.reserveRecentMessages);
    const recentMessages = conversationMessages.slice(-config.reserveRecentMessages);

    // 生成摘要（简化版本）
    const summary = this.generateSimpleSummary(oldMessages);

    const summaryMessage: Message = {
      role: 'system',
      content: `[之前的对话摘要]\n${summary}`,
    };

    return [...systemMessages, summaryMessage, ...recentMessages];
  }

  /**
   * 阶段 4: 删除冗余文件内容
   */
  private async removeRedundantFiles(
    messages: (Message | EnhancedMessage)[],
    _config: CompressionConfig
  ): Promise<(Message | EnhancedMessage)[]> {
    // 简化版本：移除过长的文件内容
    return messages.map(msg => {
      if ('parts' in msg) {
        // 增强消息：过滤掉过长的文件部分
        const filteredParts = msg.parts.filter(part => {
          if (part.type === PartType.FILE && part.content.length > 5000) {
            return false; // 移除过长的文件内容
          }
          return true;
        });

        return {
          ...msg,
          parts: filteredParts,
        };
      } else if (msg.content && msg.content.length > 10000) {
        // 简单消息：截断内容
        return {
          ...msg,
          content: msg.content.substring(0, 5000) +
            '\n\n... (内容已压缩，省略 ' +
            (msg.content.length - 5000) +
            ' 字符) ...',
        };
      }

      return msg;
    });
  }

  /**
   * 生成简单摘要
   */
  private generateSimpleSummary(messages: (Message | EnhancedMessage)[]): string {
    const items: string[] = [];

    for (const msg of messages) {
      const role = msg.role;
      const content = ('content' in msg ? msg.content : messageToText(msg as EnhancedMessage));

      // 截断内容
      const truncated = content.length > 200 ? content.substring(0, 200) + '...' : content;

      items.push(`[${role}] ${truncated}`);
    }

    return `共 ${messages.length} 条消息:\n` + items.map((item, i) => `${i + 1}. ${item}`).join('\n');
  }

  /**
   * 估算 token 数量
   */
  private estimateTokens(messages: (Message | EnhancedMessage)[]): number {
    let total = 0;

    for (const msg of messages) {
      if ('parts' in msg) {
        // 增强消息
        const parts = filterMessageParts(msg as EnhancedMessage);
        total += parts.reduce((sum, part) => sum + this.estimateTextTokens(part.content), 0);
      } else {
        // 简单消息
        total += this.estimateTextTokens(msg.content);
      }

      // 为消息元数据添加额外 token
      total += 10; // role, timestamp 等元数据
    }

    return total;
  }

  /**
   * 估算文本 token 数量（粗略估算）
   */
  private estimateTextTokens(text: string): number {
    // 中文约 1 字符 = 1 token，英文约 4 字符 = 1 token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishChars = text.length - chineseChars;
    const englishWords = englishChars / 4;

    return Math.ceil(chineseChars + englishWords);
  }
}

/**
 * 预定义的压缩配置
 */
export const CompressionPresets = {
  /**
   * 保守模式 - 尽可能保留信息
   */
  conservative: {
    maxTokens: 120000,
    strategy: CompressionStrategy.CONSERVATIVE,
    reserveRecentMessages: 10,
    summarizeThreshold: 0.9,
    compressionLevel: 0.3,
  },

  /**
   * 平衡模式 - 信息和压缩的平衡
   */
  balanced: {
    maxTokens: 120000,
    strategy: CompressionStrategy.BALANCED,
    reserveRecentMessages: 6,
    summarizeThreshold: 0.8,
    compressionLevel: 0.5,
  },

  /**
   * 激进模式 - 最大程度压缩
   */
  aggressive: {
    maxTokens: 120000,
    strategy: CompressionStrategy.AGGRESSIVE,
    reserveRecentMessages: 3,
    summarizeThreshold: 0.7,
    compressionLevel: 0.8,
  },
};
