import type { Message } from '../types';
import * as fs from 'fs-extra';

/**
 * 对话上下文管理器
 */
export class ContextManager {
  private messages: Message[] = [];
  private maxHistory: number;
  private maxTokens: number;
  private historyFile: string;

  constructor(
    maxHistory: number = 10,
    maxTokens: number = 8000,
    historyFile: string = './.agent-history.json'
  ) {
    this.maxHistory = maxHistory;
    this.maxTokens = maxTokens;
    this.historyFile = historyFile;
  }

  /**
   * 添加消息到上下文
   */
  addMessage(role: 'user' | 'assistant', content: string): void {
    this.messages.push({ role, content });

    // 限制历史消息数量
    if (this.messages.length > this.maxHistory * 2) {
      // 保留最近的maxHistory轮对话
      this.messages = this.messages.slice(-this.maxHistory * 2);
    }
  }

  /**
   * 获取上下文消息
   */
  getContext(maxTokens?: number): Message[] {
    const limit = maxTokens ?? this.maxTokens;
    let result: Message[] = [];
    let currentTokens = 0;

    // 首先确保system消息在结果中（如果存在）
    const systemMessages = this.messages.filter(m => m.role === 'system');
    if (systemMessages.length > 0) {
      result.push(...systemMessages);
      currentTokens = systemMessages.reduce((sum, msg) => sum + this.estimateTokens(msg.content), 0);
    }

    // 从最新的消息开始倒序添加（排除system消息）
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];

      // 跳过system消息（已经添加过了）
      if (msg.role === 'system') {
        continue;
      }

      const tokens = this.estimateTokens(msg.content);

      if (currentTokens + tokens > limit) {
        break;
      }

      result.unshift(msg);
      currentTokens += tokens;
    }

    return result;
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
  }

  /**
   * 获取历史消息
   */
  getHistory(): Message[] {
    return [...this.messages];
  }

  /**
   * 设置系统提示词
   */
  setSystemPrompt(prompt: string): void {
    // 移除旧的系统提示词
    this.messages = this.messages.filter((m) => m.role !== 'system');

    // 添加新的系统提示词到开头
    this.messages.unshift({ role: 'system', content: prompt });
  }

  /**
   * 保存历史到文件
   */
  async saveHistory(): Promise<void> {
    try {
      await fs.writeFile(this.historyFile, JSON.stringify(this.messages, null, 2), 'utf-8');
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
        this.messages = JSON.parse(content);
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
  private estimateTokens(text: string): number {
    // 简单估算：中文字符计数 + 英文单词数
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishChars = text.length - chineseChars;
    const englishWords = englishChars / 4;

    return Math.ceil(chineseChars + englishWords);
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
