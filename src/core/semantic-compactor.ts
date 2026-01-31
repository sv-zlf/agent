/**
 * GG CODE - 语义压缩器
 * 基于语义分析的智能上下文压缩
 */

import type { Message, EnhancedMessage } from '../types';
import { PartType, messageToText } from '../types/message';
import { TokenEstimator } from './token-estimator';

export interface SemanticCompactionConfig {
  enabled: boolean;
  maxTokens: number;
  reserveTokens: number;
  minImportanceScore: number;
  maxSimilarityThreshold: number;
  enableSemanticDeduplication: boolean;
  enableSmartSummarization: boolean;
  summarizeOlderThan: number;
  summaryMaxTokens: number;
}

export interface MessageImportance {
  score: number;
  factors: {
    isRecent: boolean;
    hasToolResult: boolean;
    isUserRequest: boolean;
    isError: boolean;
    hasFileChanges: boolean;
    hasReasoning: boolean;
  };
}

export interface SemanticCompactionResult {
  compressed: boolean;
  messages: (Message | EnhancedMessage)[];
  originalTokens: number;
  compressedTokens: number;
  savedTokens: number;
  removedCount: number;
  summarizedCount: number;
  deduplicatedCount: number;
  changes: {
    removed: { role: string; preview: string }[];
    summarized: { role: string; originalLength: number; summary: string }[];
  };
}

export class SemanticCompactor {
  private config: SemanticCompactionConfig;

  constructor(config: Partial<SemanticCompactionConfig> = {}) {
    this.config = {
      enabled: true,
      maxTokens: 8000,
      reserveTokens: 2000,
      minImportanceScore: 0.3,
      maxSimilarityThreshold: 0.85,
      enableSemanticDeduplication: true,
      enableSmartSummarization: true,
      summarizeOlderThan: 3,
      summaryMaxTokens: 500,
      ...config,
    };
  }

  updateConfig(config: Partial<SemanticCompactionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private estimateMessage(msg: Message | EnhancedMessage): number {
    if ('parts' in msg) {
      return msg.parts.reduce((sum, p) => sum + TokenEstimator.estimate(p.content || ''), 0);
    }
    return TokenEstimator.estimateMessage(msg);
  }

  assessImportance(
    msg: Message | EnhancedMessage,
    msgIndex: number,
    totalMsgs: number
  ): MessageImportance {
    const factors = {
      isRecent: false,
      hasToolResult: false,
      isUserRequest: false,
      isError: false,
      hasFileChanges: false,
      hasReasoning: false,
    };

    let score = 0;

    const recencyRatio = 1 - msgIndex / totalMsgs;
    if (recencyRatio > 0.7) {
      factors.isRecent = true;
      score += 0.25;
    } else if (recencyRatio > 0.4) {
      score += 0.1;
    }

    if ('parts' in msg) {
      for (const part of msg.parts) {
        if (part.type === PartType.TOOL_RESULT) {
          factors.hasToolResult = true;
          const metadata = part.metadata as any;
          if (metadata?.success === false || metadata?.error) {
            factors.isError = true;
            score += 0.2;
          } else {
            score += 0.15;
          }
        }
        if (part.type === PartType.FILE && (part.metadata as any)?.operation !== 'read') {
          factors.hasFileChanges = true;
          score += 0.25;
        }
        if (part.type === PartType.REASONING) {
          factors.hasReasoning = true;
          score += 0.1;
        }
      }
    }

    if (msg.role === 'user') {
      factors.isUserRequest = true;
      const content = 'parts' in msg ? messageToText(msg) : msg.content;
      if (this.isNewTaskRequest(content)) {
        score += 0.2;
      }
    }

    score = Math.min(score, 1);

    return { score, factors };
  }

  private isNewTaskRequest(content: string): boolean {
    const taskKeywords = [
      '帮我',
      '请帮我',
      '创建一个',
      '写一个',
      '实现',
      '开发',
      'build',
      'create',
      'implement',
      'write',
      'make',
    ];
    const lower = content.toLowerCase();
    return taskKeywords.some((kw) => lower.includes(kw));
  }

  calculateSimilarity(msg1: Message | EnhancedMessage, msg2: Message | EnhancedMessage): number {
    const text1 = this.extractKeyContent(msg1);
    const text2 = this.extractKeyContent(msg2);

    const words1 = this.tokenize(text1);
    const words2 = this.tokenize(text2);

    const set1 = new Set(words1);
    const set2 = new Set(words2);

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) return 0;

    const jaccard = intersection.size / union.size;

    const set1Lower = new Set(words1.map((w) => w.toLowerCase()));
    const set2Lower = new Set(words2.map((w) => w.toLowerCase()));
    const intersectionLower = new Set([...set1Lower].filter((x) => set2Lower.has(x)));
    const jaccardLower = intersectionLower.size / new Set([...set1Lower, ...set2Lower]).size;

    return (jaccard + jaccardLower) / 2;
  }

  private extractKeyContent(msg: Message | EnhancedMessage): string {
    if ('parts' in msg) {
      return msg.parts
        .filter((p) => !p.ignored && p.type !== PartType.SYSTEM)
        .map((p) => {
          if (p.type === PartType.TOOL_CALL) {
            const meta = p.metadata as any;
            return `tool:${meta?.tool} ${JSON.stringify(meta?.parameters || {})}`;
          }
          if (p.type === PartType.TOOL_RESULT) {
            const meta = p.metadata as any;
            return `result:${meta?.tool} ${p.content.substring(0, 200)}`;
          }
          return p.content;
        })
        .join(' ');
    }
    return msg.content;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }

  detectDuplicates(messages: (Message | EnhancedMessage)[]): number[] {
    const duplicates: number[] = [];

    for (let i = 1; i < messages.length; i++) {
      for (let j = 0; j < i; j++) {
        const similarity = this.calculateSimilarity(messages[i], messages[j]);
        if (similarity > this.config.maxSimilarityThreshold) {
          const importance = this.assessImportance(messages[i], i, messages.length);
          const olderImportance = this.assessImportance(messages[j], j, messages.length);

          if (importance.score < olderImportance.score) {
            if (!duplicates.includes(i)) {
              duplicates.push(i);
            }
          }
        }
      }
    }

    return duplicates;
  }

  summarizeMessage(msg: Message | EnhancedMessage): string {
    const content = 'parts' in msg ? messageToText(msg) : msg.content;
    const tokens = TokenEstimator.estimate(content);

    if (tokens <= this.config.summaryMaxTokens / 2) {
      return content;
    }

    const lines = content.split('\n').filter((l) => l.trim());
    const keyPoints: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (this.isImportantLine(trimmed)) {
        keyPoints.push(trimmed);
      }
    }

    if (keyPoints.length === 0) {
      const sentences = content.split(/[.!?]+/).filter((s) => s.trim());
      keyPoints.push(...sentences.slice(0, 3));
    }

    let summary = keyPoints.join('\n');
    const summaryTokens = TokenEstimator.estimate(summary);

    if (summaryTokens > this.config.summaryMaxTokens) {
      const maxChars = (this.config.summaryMaxTokens - 50) * 4;
      summary = summary.substring(0, maxChars) + '...';
    }

    return summary;
  }

  private isImportantLine(line: string): boolean {
    const importantPatterns = [
      /^[\d]+\./,
      /^[*•-]/,
      /^function|^class|^const|^export|^import/,
      /error|warning|exception/i,
      /test|spec|mock/i,
    ];
    return importantPatterns.some((p) => p.test(line));
  }

  async compact(messages: (Message | EnhancedMessage)[]): Promise<SemanticCompactionResult> {
    const originalTokens = messages.reduce((sum, m) => sum + this.estimateMessage(m), 0);
    const targetTokens = this.config.maxTokens - this.config.reserveTokens;

    if (!this.config.enabled || originalTokens <= targetTokens) {
      return {
        compressed: false,
        messages,
        originalTokens,
        compressedTokens: originalTokens,
        savedTokens: 0,
        removedCount: 0,
        summarizedCount: 0,
        deduplicatedCount: 0,
        changes: { removed: [], summarized: [] },
      };
    }

    const result: SemanticCompactionResult = {
      compressed: true,
      messages: [...messages],
      originalTokens,
      compressedTokens: originalTokens,
      savedTokens: 0,
      removedCount: 0,
      summarizedCount: 0,
      deduplicatedCount: 0,
      changes: { removed: [], summarized: [] },
    };

    const toRemove: number[] = [];
    const toSummarize: Map<number, string> = new Map();

    for (let i = 0; i < result.messages.length; i++) {
      const msg = result.messages[i];
      if (msg.role === 'system') continue;

      const importance = this.assessImportance(msg, i, result.messages.length);

      if (importance.score < this.config.minImportanceScore) {
        toRemove.push(i);
        result.changes.removed.push({
          role: msg.role,
          preview: messageToText(msg).substring(0, 50),
        });
        continue;
      }

      if (this.config.enableSemanticDeduplication) {
        const duplicates = this.detectDuplicates(result.messages.slice(0, i + 1));
        for (const dupIndex of duplicates) {
          if (dupIndex < result.messages.length) {
            const dupMsg = result.messages[dupIndex];
            const dupImportance = this.assessImportance(dupMsg, dupIndex, result.messages.length);
            if (dupImportance.score < importance.score) {
              toRemove.push(dupIndex);
              result.deduplicatedCount++;
              result.changes.removed.push({
                role: dupMsg.role,
                preview: messageToText(dupMsg).substring(0, 50),
              });
            }
          }
        }
      }

      const turnsAgo = result.messages.length - i - 1;
      if (this.config.enableSmartSummarization && turnsAgo >= this.config.summarizeOlderThan) {
        const summary = this.summarizeMessage(msg);
        if (summary !== messageToText(msg)) {
          toSummarize.set(i, summary);
          result.summarizedCount++;
          result.changes.summarized.push({
            role: msg.role,
            originalLength: TokenEstimator.estimate(messageToText(msg)),
            summary: summary.substring(0, 100),
          });
        }
      }
    }

    for (const index of toRemove.sort((a, b) => b - a)) {
      result.messages.splice(index, 1);
    }

    for (const [index, summary] of toSummarize) {
      if (index < result.messages.length) {
        const msg = result.messages[index];
        if ('parts' in msg) {
          msg.parts = [
            {
              type: PartType.TEXT,
              id: `summary-${Date.now()}`,
              content: `[摘要] ${summary}`,
              metadata: { summarized: true, originalIndex: index },
            },
          ];
        } else {
          (msg as Message).content = `[摘要] ${summary}`;
        }
      }
    }

    result.compressedTokens = result.messages.reduce((sum, m) => sum + this.estimateMessage(m), 0);
    result.savedTokens = originalTokens - result.compressedTokens;
    result.removedCount = toRemove.length;

    return result;
  }

  quickCompact(messages: (Message | EnhancedMessage)[]): SemanticCompactionResult {
    const result = {
      compressed: false,
      messages: [...messages],
      originalTokens: 0,
      compressedTokens: 0,
      savedTokens: 0,
      removedCount: 0,
      summarizedCount: 0,
      deduplicatedCount: 0,
      changes: {
        removed: [] as { role: string; preview: string }[],
        summarized: [] as { role: string; originalLength: number; summary: string }[],
      },
    };

    result.originalTokens = messages.reduce((sum, m) => sum + this.estimateMessage(m), 0);
    const targetTokens = this.config.maxTokens - this.config.reserveTokens;

    if (result.originalTokens <= targetTokens) {
      result.compressedTokens = result.originalTokens;
      return result;
    }

    const lowImportance: number[] = [];
    const duplicates = this.detectDuplicates(messages);

    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'system') continue;

      const importance = this.assessImportance(messages[i], i, messages.length);
      if (importance.score < 0.2) {
        lowImportance.push(i);
      }
    }

    for (const dupIndex of duplicates) {
      if (!lowImportance.includes(dupIndex)) {
        lowImportance.push(dupIndex);
        result.deduplicatedCount++;
      }
    }

    for (const index of lowImportance.sort((a, b) => b - a)) {
      result.messages.splice(index, 1);
      result.removedCount++;
      result.changes.removed.push({
        role: messages[index].role,
        preview: messageToText(messages[index]).substring(0, 50),
      });
    }

    result.compressedTokens = result.messages.reduce((sum, m) => sum + this.estimateMessage(m), 0);
    result.savedTokens = result.originalTokens - result.compressedTokens;
    result.compressed = result.savedTokens > 0;

    return result;
  }
}

export function createSemanticCompactor(
  config?: Partial<SemanticCompactionConfig>
): SemanticCompactor {
  return new SemanticCompactor(config);
}
