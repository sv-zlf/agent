/**
 * 功能性 Agents 系统
 * 用于处理对话压缩、摘要生成、标题生成等内部功能
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { IAPIAdapter } from '../api';
import type { Message } from '../types';
import { executeAPIRequest, API_PRIORITY } from './api-concurrency';
import { hasPackedPrompts, getProjectPrompt } from '../utils/packed-prompts';

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
    this.promptsDir = promptsDir || path.join(process.cwd(), 'src/tools/prompts');
  }

  /**
   * 加载功能性 Agent 的 prompt
   * 优先使用打包的 prompts，如果不存在则从文件系统读取
   */
  async loadPrompt(type: FunctionalAgentType): Promise<string> {
    // 1. 优先使用打包的 prompts
    if (hasPackedPrompts()) {
      const packedPrompt = getProjectPrompt(type);
      if (packedPrompt) {
        return packedPrompt;
      }
    }

    // 2. 回退到文件系统读取（开发环境）
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
   * 优化：提取关键对话内容，排除工具执行细节
   */
  async summarize(messages: Message[]): Promise<FunctionalAgentResult> {
    // 构建精简的对话上下文，排除工具执行结果
    const cleanedMessages: Message[] = [];

    for (const msg of messages) {
      // 跳过系统消息（标题生成的系统消息已经包含在 prompt 中）
      if (msg.role === 'system') {
        continue;
      }

      // 过滤掉工具执行结果消息
      const content = msg.content;
      const isToolResult =
        content.includes('工具执行结果') ||
        content.includes('Tool execution result') ||
        (content.includes('**') && content.includes('✓')) ||
        (content.startsWith('\n') && content.includes('工具'));

      if (isToolResult) {
        continue;
      }

      // 对于用户消息，只保留前 200 字符
      if (msg.role === 'user') {
        cleanedMessages.push({
          role: 'user',
          content: content.substring(0, 200),
        });
      }
      // 对于助手消息，只保留前 300 字符
      else if (msg.role === 'assistant') {
        cleanedMessages.push({
          role: 'assistant',
          content: content.substring(0, 300),
        });
      }

      // 只取最近 5 条消息（去除工具结果后的）
      if (cleanedMessages.length >= 5) {
        break;
      }
    }

    // 如果没有有效消息，返回默认摘要
    if (cleanedMessages.length === 0) {
      return {
        success: true,
        output: '新会话\n\n对话刚开始，暂无详细摘要。',
      };
    }

    return this.executeAgent(FunctionalAgentType.SUMMARY, cleanedMessages, {
      maxTokens: 150, // 进一步减少 maxTokens
      priority: API_PRIORITY.LOW, // 摘要生成使用低优先级
    });
  }

  /**
   * 生成标题
   * 优化：只基于用户原始输入，排除工具执行结果
   */
  async generateTitle(userInput: string): Promise<FunctionalAgentResult> {
    // 直接使用用户输入，不需要完整消息历史
    // 这样避免携带工具执行结果等无关信息
    const context: Message[] = [
      {
        role: 'user',
        content: userInput.substring(0, 200), // 进一步缩短输入，加快响应
      },
    ];

    return this.executeAgent(FunctionalAgentType.TITLE, context, {
      maxTokens: 30, // 标题只需要很少的 tokens，30 足够生成简短标题
      priority: API_PRIORITY.NORMAL, // 使用普通优先级，避免等待太久
    });
  }

  /**
   * 生成标题（从完整消息历史）- 兼容旧版本
   */
  async generateTitleFromHistory(messages: Message[]): Promise<FunctionalAgentResult> {
    // 只取第一条用户消息来生成标题
    const firstUserMessage = messages.find((m) => m.role === 'user');
    if (!firstUserMessage) {
      return {
        success: false,
        error: '没有找到用户消息',
      };
    }

    // 排除工具执行结果消息（通常包含 "工具执行结果" 等关键词）
    const content = firstUserMessage.content;
    const isToolResult =
      content.includes('工具执行结果') || content.includes('Tool execution result');

    if (isToolResult) {
      // 如果第一条用户消息是工具结果，查找下一条
      const userMessages = messages.filter((m) => m.role === 'user');
      for (const msg of userMessages) {
        if (
          !msg.content.includes('工具执行结果') &&
          !msg.content.includes('Tool execution result')
        ) {
          return this.generateTitle(msg.content);
        }
      }
    }

    return this.generateTitle(content);
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
