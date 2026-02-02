/**
 * 上下文压缩器
 * 参考 OpenCode 实现，提供智能的上下文压缩和修剪功能
 */

import type { Message, EnhancedMessage, MessagePart } from '../types';
import { PartType, messageToText } from '../types/message';
import { TokenEstimator } from './token-estimator';
import * as fs from 'fs-extra';
import * as path from 'path';

export type LLMChatFunction = (
  messages: Message[],
  options?: { temperature?: number; maxTokens?: number; abortSignal?: AbortSignal }
) => Promise<string>;

export interface LLMCompactionConfig {
  llmChat: LLMChatFunction;
  promptPath?: string;
  maxOutputTokens?: number;
  temperature?: number;
}

/**
 * 压缩配置
 */
export interface CompactionConfig {
  enabled: boolean; // 是否启用自动压缩
  maxTokens: number; // 最大 token 数量
  reserveTokens: number; // 保留的 token 数量（给输出等）
  pruneMinimum: number; // 最少修剪多少 tokens 才触发
  pruneProtect: number; // 保护最近多少 tokens 的工具调用
  protectedTools: string[]; // 受保护的工具列表（不修剪）
}

/**
 * 压缩结果
 */
export interface CompactionResult {
  compressed: boolean; // 是否发生了压缩
  messages: (Message | EnhancedMessage)[]; // 压缩后的消息
  originalTokens: number; // 原始 token 数
  compressedTokens: number; // 压缩后 token 数
  savedTokens: number; // 节省的 token 数
  prunedParts: number; // 修剪的部件数量
}

/**
 * 上下文压缩器
 */
export class ContextCompactor {
  private config: CompactionConfig;

  constructor(config: Partial<CompactionConfig> = {}) {
    this.config = {
      enabled: true,
      maxTokens: 8000, // 默认 8k 上下文
      reserveTokens: 2000, // 保留 2k 给输出
      pruneMinimum: 2000, // 至少节省 2k tokens 才修剪
      pruneProtect: 4000, // 保护最近 4k tokens
      protectedTools: [], // 默认无受保护工具
      ...config,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CompactionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): CompactionConfig {
    return { ...this.config };
  }

  /**
   * 检查是否需要压缩
   */
  needsCompaction(messages: (Message | EnhancedMessage)[]): boolean {
    if (!this.config.enabled) return false;

    const tokens = this.estimateMessages(messages);
    const usable = this.config.maxTokens - this.config.reserveTokens;

    return tokens > usable;
  }

  /**
   * 估算消息列表的 token 数量
   * 使用缓存优化性能
   */
  estimateMessages(messages: (Message | EnhancedMessage)[]): number {
    let total = 0;

    for (const msg of messages) {
      if (this.isEnhancedMessage(msg)) {
        // 增强消息：计算所有部件
        for (const part of msg.parts) {
          if (part.ignored) continue; // 跳过被忽略的部件

          // 使用缓存避免重复计算
          if ((part as any).__cachedTokens !== undefined) {
            total += (part as any).__cachedTokens;
          } else {
            const tokens = TokenEstimator.estimate(part.content || '');
            (part as any).__cachedTokens = tokens;
            total += tokens;
          }
        }
      } else {
        // 普通消息
        if ((msg as any).__cachedTokens !== undefined) {
          total += (msg as any).__cachedTokens;
        } else {
          const tokens = TokenEstimator.estimateMessage(msg);
          (msg as any).__cachedTokens = tokens;
          total += tokens;
        }
      }
    }

    return total;
  }

  /**
   * 估算单条消息的 token 数量（优化版本）
   */
  private estimateSingleMessage(msg: Message | EnhancedMessage): number {
    if (this.isEnhancedMessage(msg)) {
      let total = 0;
      for (const part of msg.parts) {
        if (part.ignored) continue;
        if ((part as any).__cachedTokens !== undefined) {
          total += (part as any).__cachedTokens;
        } else {
          const tokens = TokenEstimator.estimate(part.content || '');
          (part as any).__cachedTokens = tokens;
          total += tokens;
        }
      }
      return total;
    } else {
      if ((msg as any).__cachedTokens !== undefined) {
        return (msg as any).__cachedTokens;
      }
      const tokens = TokenEstimator.estimateMessage(msg);
      (msg as any).__cachedTokens = tokens;
      return tokens;
    }
  }

  /**
   * 清除消息的 token 缓存
   * 当消息内容被修改时调用
   */
  static clearTokenCache(messages: (Message | EnhancedMessage)[]): void {
    for (const msg of messages) {
      delete (msg as any).__cachedTokens;
      if ('parts' in msg) {
        for (const part of msg.parts) {
          delete (part as any).__cachedTokens;
        }
      }
    }
  }

  /**
   * 压缩消息列表
   */
  async compact(messages: (Message | EnhancedMessage)[]): Promise<CompactionResult> {
    const originalTokens = this.estimateMessages(messages);

    // 如果不需要压缩，直接返回
    if (!this.needsCompaction(messages)) {
      return {
        compressed: false,
        messages,
        originalTokens,
        compressedTokens: originalTokens,
        savedTokens: 0,
        prunedParts: 0,
      };
    }

    // 创建消息副本
    const compressed = [...messages];
    let prunedParts = 0;

    // 第一步：智能修剪工具输出
    const pruneResult = this.pruneToolOutputs(compressed);
    prunedParts += pruneResult.prunedParts;

    // 第二步：如果还是太大，移除旧消息
    let afterPruneTokens = this.estimateMessages(compressed);
    if (afterPruneTokens > this.config.maxTokens - this.config.reserveTokens) {
      this.removeOldMessages(compressed);
    }

    const compressedTokens = this.estimateMessages(compressed);
    const savedTokens = originalTokens - compressedTokens;

    return {
      compressed: true,
      messages: compressed,
      originalTokens,
      compressedTokens,
      savedTokens,
      prunedParts,
    };
  }

  /**
   * 使用 LLM 进行智能压缩（集成 compaction.txt 提示词）
   * 参考 OpenCode 的 compaction.ts 实现
   */
  async llmCompact(
    messages: (Message | EnhancedMessage)[],
    config: LLMCompactionConfig
  ): Promise<CompactionResult> {
    const originalTokens = this.estimateMessages(messages);

    // 🔑 修复：先分离出系统消息，确保不丢失
    const originalSystemMessages = messages.filter((m) => m.role === 'system');
    const hasSystemMessages = originalSystemMessages.length > 0;

    try {
      const promptPath =
        config.promptPath || path.join(process.cwd(), 'src/tools/prompts/compaction.txt');
      const systemPrompt = await fs.readFile(promptPath, 'utf-8');

      const messagesText = messages
        .map((m) => {
          const role = m.role;
          const content = 'parts' in m ? messageToText(m) : m.content;
          return `[${role}]: ${content}`;
        })
        .join('\n\n---\n\n');

      const userContent = `当前对话共有 ${messages.length} 条消息，约 ${originalTokens} tokens。

请压缩以下对话历史，保留关键上下文：

${messagesText}`;

      const llmResponse = await config.llmChat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        {
          temperature: config.temperature ?? 0.3,
          maxTokens: config.maxOutputTokens ?? 4000,
        }
      );

      const compressedMessages = this.parseLLMResponse(llmResponse);
      if (!compressedMessages || compressedMessages.length === 0) {
        throw new Error('LLM 压缩返回空结果');
      }

      // 🔑 修复：确保系统消息被保留
      let finalMessages = compressedMessages;
      if (hasSystemMessages) {
        const compressedSystemMessages = compressedMessages.filter((m) => m.role === 'system');
        if (compressedSystemMessages.length === 0) {
          finalMessages = [...originalSystemMessages, ...compressedMessages];
        }
      }

      const compressedTokens = this.estimateMessages(finalMessages);
      const savedTokens = originalTokens - compressedTokens;

      return {
        compressed: true,
        messages: finalMessages,
        originalTokens,
        compressedTokens,
        savedTokens,
        prunedParts: 0,
      };
    } catch (error) {
      console.error(`LLM 压缩失败: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * 解析 LLM 压缩响应
   */
  private parseLLMResponse(response: string): (Message | EnhancedMessage)[] {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('无法解析 LLM 响应');
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        throw new Error('LLM 响应格式错误');
      }
      return parsed as (Message | EnhancedMessage)[];
    } catch {
      throw new Error('JSON 解析失败');
    }
  }

  /**
   * 智能修剪工具输出
   * 参考 OpenCode 的 prune 函数
   */
  private pruneToolOutputs(messages: (Message | EnhancedMessage)[]): {
    prunedParts: number;
  } {
    let prunedParts = 0;
    let totalProtectedTokens = 0;
    const toPrune: { part: MessagePart; msgIndex: number; partIndex: number }[] = [];
    let turns = 0; // 对话轮数

    // 从后向前遍历（保护最新的内容）
    for (let msgIndex = messages.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = messages[msgIndex];

      // 统计对话轮数
      if (msg.role === 'user') turns++;

      // 保留最近 2 轮对话的完整内容
      if (turns < 2) continue;

      // 如果遇到摘要消息，停止修剪
      if (this.isEnhancedMessage(msg) && (msg as any).summary) {
        break;
      }

      // 处理增强消息的部件
      if (this.isEnhancedMessage(msg)) {
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex];

          // 只修剪工具结果
          if (part.type === PartType.TOOL_RESULT) {
            const metadata = part.metadata as any;

            // 检查是否是受保护的工具
            if (metadata?.tool && this.config.protectedTools.includes(metadata.tool)) {
              continue;
            }

            // 检查是否已经被修剪过
            if (metadata?.compacted) {
              break;
            }

            // 估算这个结果的 token 数量（使用缓存）
            let partTokens = (part as any).__cachedTokens;
            if (partTokens === undefined) {
              partTokens = TokenEstimator.estimate(part.content || '');
              (part as any).__cachedTokens = partTokens;
            }

            // 如果已经保护了足够的 tokens，加入修剪列表
            if (totalProtectedTokens > this.config.pruneProtect) {
              toPrune.push({ part, msgIndex, partIndex });
              prunedParts += partTokens;
            } else {
              totalProtectedTokens += partTokens;
            }
          }
        }
      }
    }

    // 只有当修剪量超过最小阈值时才执行修剪
    if (prunedParts > this.config.pruneMinimum) {
      for (const { part } of toPrune) {
        // 截断内容
        const originalContent = part.content || '';
        const truncated = this.truncateContent(originalContent, 500); // 保留前 500 字符
        part.content = truncated + '\n... (内容已压缩，节省 tokens)';
        (part.metadata as any).compacted = true;
        (part.metadata as any).originalLength = originalContent.length;
        // 清除缓存以便下次重新计算
        delete (part as any).__cachedTokens;
      }
    }

    return { prunedParts: toPrune.length };
  }

  /**
   * 移除旧消息
   */
  private removeOldMessages(messages: (Message | EnhancedMessage)[]): void {
    // 首先分离出 system 消息和其他消息
    const systemMessages = messages.filter((m) => m.role === 'system');
    const otherMessages = messages.filter((m) => m.role !== 'system');

    const targetTokens = this.config.maxTokens - this.config.reserveTokens;
    let currentTokens = 0;
    let keepFromIndex = otherMessages.length;

    // 从后向前保留消息，直到达到目标 token 数量
    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msg = otherMessages[i];
      const msgTokens = this.estimateSingleMessage(msg);

      if (currentTokens + msgTokens <= targetTokens) {
        keepFromIndex = i;
        currentTokens += msgTokens;
      } else {
        break;
      }
    }

    // 清空原数组
    messages.length = 0;

    // 首先添加 system 消息（确保在开头）
    messages.push(...systemMessages);

    // 然后添加保留的非 system 消息
    messages.push(...otherMessages.slice(keepFromIndex));
  }

  /**
   * 截断内容到指定字符数
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength);
  }

  /**
   * 检查是否是增强消息
   */
  private isEnhancedMessage(msg: Message | EnhancedMessage): msg is EnhancedMessage {
    return 'parts' in msg;
  }
}

/**
 * 创建上下文压缩器
 */
export function createContextCompactor(config?: Partial<CompactionConfig>): ContextCompactor {
  return new ContextCompactor(config);
}
