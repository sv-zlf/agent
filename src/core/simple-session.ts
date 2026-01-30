/**
 * 简化的会话管理 - 单一会话模式
 * 替代复杂的多会话系统
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

export interface SimpleSession {
  id: string;
  title: string;
  agent: string;
  createdAt: Date;
  historyPath: string;
}

/**
 * 简化的会话管理器 - 单一会话模式
 */
export class SimpleSessionManager {
  private currentSession: SimpleSession | null = null;

  /**
   * 初始化会话管理器
   */
  async initialize(): Promise<void> {
    // 创建默认会话
    const historyDir = path.join(os.homedir(), '.ggcode');
    await fs.mkdir(historyDir, { recursive: true });

    const sessionId = 'default';
    const historyPath = path.join(historyDir, 'session-history.json');

    this.currentSession = {
      id: sessionId,
      title: 'Default Session',
      agent: 'default',
      createdAt: new Date(),
      historyPath,
    };
  }

  /**
   * 获取当前会话
   */
  getCurrentSession(): SimpleSession {
    if (!this.currentSession) {
      throw new Error('Session not initialized');
    }
    return this.currentSession;
  }

  /**
   * 设置 agent 类型
   */
  setAgent(agent: string): void {
    if (this.currentSession) {
      this.currentSession.agent = agent;
    }
  }

  /**
   * 获取当前 agent 类型
   */
  getAgent(): string {
    return this.currentSession?.agent || 'default';
  }

  /**
   * 保存会话历史
   */
  async saveHistory(messages: any[]): Promise<void> {
    if (!this.currentSession) return;

    try {
      await fs.writeFile(
        this.currentSession.historyPath,
        JSON.stringify(messages, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('Failed to save session history:', error);
    }
  }

  /**
   * 加载会话历史
   */
  async loadHistory(): Promise<any[]> {
    if (!this.currentSession) return [];

    try {
      const content = await fs.readFile(this.currentSession.historyPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      // 文件不存在是正常情况，返回空历史
      return [];
    }
  }
}

/**
 * 创建简化的会话管理器
 */
export function createSimpleSessionManager(): SimpleSessionManager {
  return new SimpleSessionManager();
}
