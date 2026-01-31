/**
 * 功能性 Agents 系统
 * 用于处理对话压缩、摘要生成、标题生成等内部功能
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { IAPIAdapter } from '../api';
import type { Message } from '../types';
import { executeAPIRequest, API_PRIORITY } from './api-concurrency';

/**
 * 功能性 Agent 类型
 */
export enum FunctionalAgentType {
  COMPACTION = 'compaction', // 对话压缩
  SUMMARY = 'summary', // 对话摘要
  TITLE = 'title', // 标题生成
}

/**
 * 功能性 Agent 配置
 */
export interface FunctionalAgentConfig {
  type: FunctionalAgentType;
  promptPath: string;
  maxTokens?: number;
}

/**
 * 功能性 Agent 执行结果
 */
export interface FunctionalAgentResult {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * 功能性 Agent 管理器
 */
export class FunctionalAgentManager {
  private promptsDir: string;
  private apiAdapter: IAPIAdapter;

  constructor(apiAdapter: IAPIAdapter, promptsDir?: string) {
    this.apiAdapter = apiAdapter;
    // 默认使用 src/tools/prompts 目录
    this.promptsDir = promptsDir || path.join(process.cwd(), 'src/tools/prompts');
  }

  /**
   * 加载功能性 Agent 的 prompt
   */
  async loadPrompt(type: FunctionalAgentType): Promise<string> {
    const promptPath = path.join(this.promptsDir, `${type}.txt`);

    try {
      const content = await fs.readFile(promptPath, 'utf-8');
      return content;
    } catch (error) {
      throw new Error(`Failed to load prompt for ${type}: ${(error as Error).message}`);
    }
  }

  /**
   * 执行功能性 Agent
   */
  private async executeAgent(
    type: FunctionalAgentType,
    messages: Message[],
    options?: { maxTokens?: number; priority?: number }
  ): Promise<FunctionalAgentResult> {
    try {
      // 加载 prompt
      const systemPrompt = await this.loadPrompt(type);

      // 构建消息列表（系统提示词 + 对话历史）
      const apiMessages: Message[] = [{ role: 'system', content: systemPrompt }, ...messages];

      // 所有请求都通过并发控制，确保同一时间只有一个 API 请求
      const priority = options?.priority ?? API_PRIORITY.LOW;
      const response = await executeAPIRequest(async () => {
        return this.apiAdapter.chat(apiMessages);
      }, priority);

      return {
        success: true,
        output: response,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }
  /**
   * 压缩对话
   */
  async compact(messages: Message[]): Promise<FunctionalAgentResult> {
    // 过滤掉系统消息，只保留用户和助手的对话
    const conversation = messages.filter((m) => m.role === 'user' || m.role === 'assistant');

    try {
      // 使用超时机制，避免长时间阻塞
      const response = await Promise.race([
        this.executeAgent(FunctionalAgentType.COMPACTION, conversation, {
          maxTokens: 2000,
          priority: API_PRIORITY.LOW,
        }),
        new Promise<FunctionalAgentResult>((_, reject) =>
          setTimeout(() => reject(new Error('对话压缩超时')), 30000)
        ),
      ]);

      return response;
    } catch (error) {
      // 超时或失败时返回简单压缩
      return {
        success: true,
        output: '对话上下文已压缩',
      };
    }
  }

  /**
   * 生成摘要
   */
  async summarize(messages: Message[]): Promise<FunctionalAgentResult> {
    // 只取最近的对话来生成摘要，避免 tokens 过多
    const conversation = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-10); // 只保留最近10条消息

    try {
      // 使用超时机制，避免长时间阻塞
      const response = await Promise.race([
        this.executeAgent(FunctionalAgentType.SUMMARY, conversation, {
          maxTokens: 1000, // 增加到 1000，确保有足够空间生成摘要
          priority: API_PRIORITY.LOW,
        }),
        new Promise<FunctionalAgentResult>((_, reject) =>
          setTimeout(() => reject(new Error('摘要生成超时')), 30000)
        ),
      ]);

      return response;
    } catch (error) {
      // 超时或失败时返回简单摘要
      return {
        success: true,
        output: '对话摘要\n\n对话刚开始，暂无详细摘要。',
      };
    }
  }

  /**
   * 生成标题
   */
  async generateTitle(messages: Message[]): Promise<FunctionalAgentResult> {
    // 只取第一条用户消息来生成标题，更准确反映用户意图
    const firstUserMessage = messages.find((m) => m.role === 'user');
    const context = firstUserMessage ? [firstUserMessage] : messages.slice(0, 2);

    return this.executeAgent(FunctionalAgentType.TITLE, context, {
      maxTokens: 100,
      priority: API_PRIORITY.LOW,
    });
  }

  /**
   * 获取最大步数警告提示
   */
  async getMaxStepsWarning(): Promise<string> {
    try {
      await this.loadPrompt(FunctionalAgentType.TITLE); // 使用 title 位置，实际是 max-steps
      const maxStepsPath = path.join(this.promptsDir, 'max-steps.txt');
      const maxStepsContent = await fs.readFile(maxStepsPath, 'utf-8');
      return maxStepsContent;
    } catch (error) {
      // 如果文件不存在，返回默认警告
      return '⚠️ 已达到此任务允许的最大步数。工具已禁用，请提供纯文本响应总结已完成的工作。';
    }
  }
}

/**
 * 创建功能性 Agent 管理器
 */
export function createFunctionalAgentManager(
  apiAdapter: IAPIAdapter,
  promptsDir?: string
): FunctionalAgentManager {
  return new FunctionalAgentManager(apiAdapter, promptsDir);
}
