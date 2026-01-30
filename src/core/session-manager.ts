/**
 * 会话管理器
 * 参考 OpenCode 的会话管理实现，支持多个独立会话
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import { createLogger } from '../utils';

const logger = createLogger(true);

/**
 * 会话信息
 */
export interface Session {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
  historyFile: string;
  contextFile: string;
  agentType: string;
}

/**
 * 会话配置
 */
export interface SessionConfig {
  sessionsDir: string;
  currentSessionFile: string;
}

/**
 * 会话管理器
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private currentSessionId: string | null = null;
  private config: SessionConfig;

  constructor(config: SessionConfig) {
    this.config = config;
  }

  /**
   * 初始化会话管理器
   */
  async initialize(): Promise<void> {
    // 确保目录存在
    await fs.ensureDir(this.config.sessionsDir);

    // 加载所有会话
    await this.loadSessions();

    // 加载当前会话
    await this.loadCurrentSession();

    logger.debug(`SessionManager 初始化完成: ${this.sessions.size} 个会话, 当前: ${this.currentSessionId || '无'}`);
  }

  /**
   * 创建新会话
   */
  async createSession(name: string, agentType: string = 'default'): Promise<Session> {
    const sessionId = this.generateId();

    const sessionFile = path.join(this.config.sessionsDir, `${sessionId}.json`);
    const contextFile = path.join(this.config.sessionsDir, `${sessionId}-context.json`);

    const session: Session = {
      id: sessionId,
      name: name || `会话 ${sessionId.substring(0, 8)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActiveAt: Date.now(),
      historyFile: sessionFile,
      contextFile: contextFile,
      agentType: agentType,
    };

    // 保存会话信息
    await this.saveSession(session);

    // 添加到会话列表
    this.sessions.set(sessionId, session);

    // 设置为当前会话
    await this.setCurrentSession(sessionId);

    logger.info(`创建新会话: ${session.name} (${sessionId})`);
    return session;
  }

  /**
   * 切换会话
   */
  async switchSession(sessionId: string): Promise<Session> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    // 更新会话的最后活跃时间
    session.lastActiveAt = Date.now();
    await this.saveSession(session);

    // 设置为当前会话
    await this.setCurrentSession(sessionId);

    logger.info(`切换到会话: ${session.name} (${sessionId})`);
    return session;
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    // 删除会话文件
    if (await fs.pathExists(session.historyFile)) {
      await fs.remove(session.historyFile);
    }
    if (await fs.pathExists(session.contextFile)) {
      await fs.remove(session.contextFile);
    }

    // 从列表中移除
    this.sessions.delete(sessionId);

    // 如果删除的是当前会话，切换到其他会话
    if (this.currentSessionId === sessionId) {
      if (this.sessions.size > 0) {
        const nextSession = Array.from(this.sessions.values())[0];
        await this.setCurrentSession(nextSession.id);
      } else {
        this.currentSessionId = null;
        await fs.remove(this.config.currentSessionFile);
      }
    }

    logger.info(`删除会话: ${session.name} (${sessionId})`);
  }

  /**
   * 获取当前会话
   */
  getCurrentSession(): Session | null {
    if (!this.currentSessionId) {
      return null;
    }
    return this.sessions.get(this.currentSessionId) || null;
  }

  /**
   * 获取所有会话
   */
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  /**
   * 更新会话活跃时间
   */
  async updateSessionActivity(): Promise<void> {
    const session = this.getCurrentSession();
    if (session) {
      session.lastActiveAt = Date.now();
      session.updatedAt = Date.now();
      await this.saveSession(session);
    }
  }

  /**
   * 保存会话信息
   */
  private async saveSession(session: Session): Promise<void> {
    const sessionFile = path.join(this.config.sessionsDir, `${session.id}.json`);
    await fs.writeJSON(sessionFile, session, { spaces: 2 });
  }

  /**
   * 加载所有会话
   */
  private async loadSessions(): Promise<void> {
    try {
      const files = await fs.readdir(this.config.sessionsDir);
      const sessionFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('-context.json'));

      for (const file of sessionFiles) {
        try {
          const sessionFile = path.join(this.config.sessionsDir, file);
          const sessionData = await fs.readJSON(sessionFile);
          this.sessions.set(sessionData.id, sessionData);
        } catch (error) {
          logger.error(`加载会话失败: ${file} - ${(error as Error).message}`);
        }
      }

      logger.debug(`加载了 ${this.sessions.size} 个会话`);
    } catch (error) {
      // 目录可能不存在，忽略错误
      logger.debug(`加载会话列表失败: ${(error as Error).message}`);
    }
  }

  /**
   * 加载当前会话
   */
  private async loadCurrentSession(): Promise<void> {
    try {
      if (await fs.pathExists(this.config.currentSessionFile)) {
        const currentSessionId = await fs.readFile(this.config.currentSessionFile, 'utf-8');
        this.currentSessionId = currentSessionId.trim();
        logger.debug(`当前会话: ${this.currentSessionId}`);
      }
    } catch (error) {
      logger.debug(`加载当前会话失败: ${(error as Error).message}`);
    }
  }

  /**
   * 设置当前会话
   */
  private async setCurrentSession(sessionId: string): Promise<void> {
    this.currentSessionId = sessionId;
    await fs.ensureDir(path.dirname(this.config.currentSessionFile));
    await fs.writeFile(this.config.currentSessionFile, sessionId, 'utf-8');
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * 清理不活跃的会话
   */
  async cleanupInactiveSessions(maxAge = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, session] of this.sessions) {
      const age = now - session.lastActiveAt;
      if (age > maxAge && id !== this.currentSessionId) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      await this.deleteSession(id);
    }

    return toDelete.length;
  }
}

/**
 * 创建会话管理器实例
 */
export function createSessionManager(config?: SessionConfig): SessionManager {
  const defaultConfig: SessionConfig = {
    sessionsDir: path.join(process.cwd(), '.agent-sessions'),
    currentSessionFile: path.join(process.cwd(), '.agent-current-session'),
  };

  return new SessionManager(config || defaultConfig);
}
