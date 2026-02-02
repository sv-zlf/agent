/**
 * 会话管理器
 * 参考 OpenCode 的会话管理实现，支持多个独立会话
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import type { SessionManagementConfig } from '../types';
import { createLogger, getSessionsDir, getCurrentSessionFile } from '../utils';
import { SessionError, ErrorCode } from '../errors';

const logger = createLogger(false);

/**
 * 会话信息
 */
export interface Session {
  id: string;
  title: string; // 会话标题（初始为 "New Session"，AI 生成后更新）
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
  historyFile: string;
  contextFile: string;
  agentType: string;
  parentID?: string; // 父会话ID（用于 fork）
  messageCount?: number; // 消息数量
  stats?: SessionStats; // 会话统计信息
  summary?: SessionSummary; // 会话摘要信息
}

/**
 * 会话统计信息
 */
export interface SessionStats {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  tokensUsed: number;
  modifiedFiles: string[]; // 修改过的文件列表
  summariesGenerated?: number; // 生成的摘要数量
  lastSummaryAt?: number; // 最后一次摘要生成时间
}

/**
 * 会话摘要信息（基于代码变化统计）
 */
export interface SessionSummary {
  title?: string; // 会话标题（AI生成）
  additions: number; // 新增行数
  deletions: number; // 删除行数
  files: number; // 修改的文件数
  modifiedFiles: string[]; // 修改的文件列表
  generatedAt: number; // 最后更新时间
}

/**
 * 会话配置
 */
export interface SessionConfig {
  sessionsDir: string;
  currentSessionFile: string;
  sessionLimits?: SessionManagementConfig;
}

/**
 * 会话管理器
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private currentSessionId: string | null = null;
  private config: SessionConfig;
  private lastCleanupTime: number = 0;

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

    // 执行清理检查（如果启用）
    await this.performAutoCleanup();

    logger.debug(
      `SessionManager 初始化完成: ${this.sessions.size} 个会话, 当前: ${this.currentSessionId || '无'}`
    );
  }

  /**
   * 创建新会话
   */
  async createSession(
    title: string = 'New Session',
    agentType: string = 'build',
    parentID?: string
  ): Promise<Session> {
    // 检查会话数量限制
    await this.enforceSessionLimits();

    // 验证agentType
    const validAgentTypes = ['build', 'explore', 'plan'];
    if (!validAgentTypes.includes(agentType)) {
      console.log(`⚠️ 无效的agent类型: ${agentType}，使用默认值`);
      agentType = 'build';
    }
    const sessionId = this.generateId();

    const sessionFile = path.join(this.config.sessionsDir, `${sessionId}.json`);
    const historyFile = path.join(this.config.sessionsDir, `${sessionId}-history.json`);

    const session: Session = {
      id: sessionId,
      title: title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActiveAt: Date.now(),
      historyFile: historyFile,
      contextFile: sessionFile,
      agentType: agentType,
      parentID,
      messageCount: 0,
      stats: {
        totalMessages: 0,
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        tokensUsed: 0,
        modifiedFiles: [],
      },
    };

    // 保存会话信息
    await this.saveSession(session);

    // 添加到会话列表
    this.sessions.set(sessionId, session);

    // 设置为当前会话
    await this.setCurrentSession(sessionId);

    logger.debug(`创建会话: ${session.title}`);
    return session;
  }

  /**
   * 切换会话
   */
  async switchSession(sessionId: string): Promise<Session> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionError(`会话不存在: ${sessionId}`, ErrorCode.SESSION_NOT_FOUND, {
        sessionId,
      });
    }

    // 更新会话的最后活跃时间
    session.lastActiveAt = Date.now();
    await this.saveSession(session);

    // 设置为当前会话
    await this.setCurrentSession(sessionId);

    return session;
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionError(`会话不存在: ${sessionId}`, ErrorCode.SESSION_NOT_FOUND, {
        sessionId,
      });
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

    logger.debug(`删除会话: ${sessionId}`);
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
   * 更新会话活跃时间和消息数量
   */
  async updateSessionActivity(messageCount?: number): Promise<void> {
    const session = this.getCurrentSession();
    if (session) {
      session.lastActiveAt = Date.now();
      session.updatedAt = Date.now();

      // 更新消息数量
      if (messageCount !== undefined) {
        session.messageCount = messageCount;

        // 同步更新 stats
        if (session.stats) {
          session.stats.totalMessages = messageCount;
        }
      }

      await this.saveSession(session);
    }
  }

  /**
   * 更新会话统计信息
   */
  async updateSessionStats(updates: {
    userMessages?: number;
    assistantMessages?: number;
    toolCalls?: number;
    tokensUsed?: number;
  }): Promise<void> {
    const session = this.getCurrentSession();
    if (session && session.stats) {
      if (updates.userMessages !== undefined) {
        session.stats.userMessages = updates.userMessages;
      }
      if (updates.assistantMessages !== undefined) {
        session.stats.assistantMessages = updates.assistantMessages;
      }
      if (updates.toolCalls !== undefined) {
        session.stats.toolCalls = updates.toolCalls;
      }
      if (updates.tokensUsed !== undefined) {
        session.stats.tokensUsed = updates.tokensUsed;
      }

      // 同时更新 totalMessages
      session.stats.totalMessages =
        (session.stats.userMessages || 0) + (session.stats.assistantMessages || 0);
      session.messageCount = session.stats.totalMessages;

      session.updatedAt = Date.now();
      await this.saveSession(session);
    }
  }

  /**
   * 设置当前会话的 agent 类型
   */
  async setAgent(agentType: string): Promise<void> {
    const session = this.getCurrentSession();
    if (session) {
      session.agentType = agentType;
      await this.saveSession(session);
    }
  }

  /**
   * 获取当前会话的 agent 类型
   */
  getAgent(): string {
    return this.getCurrentSession()?.agentType || 'build';
  }

  /**
   * 设置会话标题（从第一条用户消息生成）
   */
  async setTitle(sessionId: string, title: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.title = title;

      // 同时更新摘要中的标题
      if (!session.summary) {
        session.summary = {
          additions: 0,
          deletions: 0,
          files: 0,
          modifiedFiles: [],
          generatedAt: Date.now(),
        };
      }
      session.summary.title = title;

      session.updatedAt = Date.now();
      await this.saveSession(session);
    }
  }

  /**
   * 设置当前会话的标题
   */
  async setCurrentSessionTitle(title: string): Promise<void> {
    const session = this.getCurrentSession();
    if (session) {
      session.title = title;

      // 同时更新摘要中的标题
      if (!session.summary) {
        session.summary = {
          additions: 0,
          deletions: 0,
          files: 0,
          modifiedFiles: [],
          generatedAt: Date.now(),
        };
      }
      session.summary.title = title;

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
      const sessionFiles = files.filter((f) => f.endsWith('.json') && !f.endsWith('-history.json'));

      for (const file of sessionFiles) {
        try {
          const sessionFile = path.join(this.config.sessionsDir, file);
          const sessionData = await fs.readJSON(sessionFile);
          // 验证会话数据是否有效（检查是否是 Session 对象而不是消息数组）
          if (
            sessionData &&
            sessionData.id &&
            sessionData.title &&
            sessionData.agentType !== undefined
          ) {
            this.sessions.set(sessionData.id, sessionData);
          } else {
            logger.warning(`无效的会话数据: ${file}`);
          }
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
        const sessionId = currentSessionId.trim();
        // 验证会话是否存在
        if (sessionId && this.sessions.has(sessionId)) {
          this.currentSessionId = sessionId;
          logger.debug(`当前会话: ${this.currentSessionId}`);
        } else {
          logger.debug(`当前会话文件存在但会话不存在: ${sessionId}`);
          this.currentSessionId = null;
        }
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
   * 强制执行会话数量限制
   */
  private async enforceSessionLimits(): Promise<void> {
    if (!this.config.sessionLimits) {
      return;
    }

    const { max_sessions, preserve_recent_sessions } = this.config.sessionLimits;

    if (this.sessions.size >= max_sessions) {
      logger.debug(`会话数量达到限制 (${this.sessions.size}/${max_sessions})，执行清理`);

      // 获取所有会话，按最后活跃时间排序
      const allSessions = Array.from(this.sessions.values()).sort(
        (a, b) => b.lastActiveAt - a.lastActiveAt
      );

      // 保留最近的前N个会话和当前会话
      const toKeep = new Set<string>();

      // 添加当前会话
      if (this.currentSessionId) {
        toKeep.add(this.currentSessionId);
      }

      // 添加最近的前N个会话
      const recentSessions = allSessions
        .filter((s) => !toKeep.has(s.id))
        .slice(0, preserve_recent_sessions);
      recentSessions.forEach((s) => toKeep.add(s.id));

      // 找出需要删除的会话
      const toDelete = allSessions.filter((s) => !toKeep.has(s.id)).map((s) => s.id);

      // 删除超出限制的会话
      for (const sessionId of toDelete) {
        await this.deleteSession(sessionId);
      }
    }
  }

  /**
   * 清理不活跃的会话
   */
  async cleanupInactiveSessions(maxAge?: number): Promise<number> {
    if (!this.config.sessionLimits) {
      return 0;
    }

    const now = Date.now();
    const maxInactiveAge =
      maxAge || this.config.sessionLimits.max_inactive_days * 24 * 60 * 60 * 1000;
    const { preserve_recent_sessions } = this.config.sessionLimits;

    const toDelete: string[] = [];

    // 获取所有会话，按最后活跃时间排序
    const allSessions = Array.from(this.sessions.entries()).sort(
      ([, a], [, b]) => b.lastActiveAt - a.lastActiveAt
    );

    // 保留当前会话和最近的前N个会话
    const toKeep = new Set<string>();

    // 添加当前会话
    if (this.currentSessionId) {
      toKeep.add(this.currentSessionId);
    }

    // 添加最近的前N个会话（不受时间限制）
    const recentSessions = allSessions
      .filter(([id]) => !toKeep.has(id))
      .slice(0, preserve_recent_sessions);
    recentSessions.forEach(([id]) => toKeep.add(id));

    // 检查其余会话的活跃时间
    for (const [id, session] of allSessions) {
      if (!toKeep.has(id)) {
        const age = now - session.lastActiveAt;
        if (age > maxInactiveAge) {
          toDelete.push(id);
        }
      }
    }

    for (const id of toDelete) {
      await this.deleteSession(id);
    }

    return toDelete.length;
  }

  /**
   * 更新会话摘要（基于代码变化）
   */
  async updateSessionSummary(
    sessionId: string,
    changes: {
      additions?: number;
      deletions?: number;
      modifiedFiles?: string[];
    }
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.debug(`尝试更新不存在会话的摘要: ${sessionId}`);
      return;
    }

    // 初始化摘要
    if (!session.summary) {
      session.summary = {
        additions: 0,
        deletions: 0,
        files: 0,
        modifiedFiles: [],
        generatedAt: Date.now(),
      };
    }

    // 更新统计信息
    if (changes.additions !== undefined) {
      session.summary.additions += changes.additions;
    }
    if (changes.deletions !== undefined) {
      session.summary.deletions += changes.deletions;
    }
    if (changes.modifiedFiles) {
      // 合并修改的文件列表（去重）
      const newFiles = changes.modifiedFiles.filter(
        (f) => !session.summary!.modifiedFiles.includes(f)
      );
      session.summary.modifiedFiles.push(...newFiles);
      session.summary.files = session.summary.modifiedFiles.length;
    }

    // 更新时间
    session.summary.generatedAt = Date.now();

    // 同时更新 stats.modifiedFiles
    if (session.stats && changes.modifiedFiles) {
      changes.modifiedFiles.forEach((file) => {
        if (!session.stats!.modifiedFiles.includes(file)) {
          session.stats!.modifiedFiles.push(file);
        }
      });
    }

    // 更新会话的修改时间
    session.updatedAt = Date.now();

    // 保存会话信息
    await this.saveSession(session);

    logger.debug(
      `已更新会话统计: ${session.title} (+${changes.additions || 0}, -${changes.deletions || 0}, ${session.summary.files} files)`
    );
  }

  /**
   * 设置会话标题（同时更新 session.title 和 session.summary.title）
   */
  async setSessionTitle(sessionId: string, title: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.debug(`尝试更新不存在会话的标题: ${sessionId}`);
      return;
    }

    // 更新会话标题（用于会话列表显示）
    session.title = title;

    // 初始化摘要（如果不存在）
    if (!session.summary) {
      session.summary = {
        additions: 0,
        deletions: 0,
        files: 0,
        modifiedFiles: [],
        generatedAt: Date.now(),
      };
    }

    // 更新摘要中的标题
    session.summary.title = title;
    session.updatedAt = Date.now();

    // 保存会话信息
    await this.saveSession(session);

    logger.debug(`已更新会话标题: ${session.title} - ${title}`);
  }

  /**
   * 获取会话摘要
   */
  getSessionSummary(sessionId?: string): SessionSummary | null {
    const session = sessionId ? this.sessions.get(sessionId) : this.getCurrentSession();

    return session?.summary || null;
  }

  /**
   * Fork 会话 - 从当前会话创建分支
   * @param messageIndex - 可选，从指定消息索引处 fork（不包括该消息之后的消息）
   */
  async forkSession(messageIndex?: number): Promise<Session> {
    const currentSession = this.getCurrentSession();
    if (!currentSession) {
      throw new SessionError('没有当前会话', ErrorCode.SESSION_NOT_FOUND);
    }

    // 生成 fork 后的标题
    const forkedTitle = this.getForkedTitle(currentSession.title);

    // 创建新会话
    const newSession = await this.createSession(
      forkedTitle,
      currentSession.agentType,
      currentSession.id
    );

    // 复制历史消息（如果指定了 messageIndex，只复制到该索引）
    if (await fs.pathExists(currentSession.historyFile)) {
      try {
        const history = await fs.readJSON(currentSession.historyFile);
        const messagesToCopy =
          messageIndex !== undefined
            ? history.messages?.slice(0, messageIndex) || []
            : history.messages || [];

        // 保存到新会话
        await fs.writeJSON(
          newSession.historyFile,
          {
            ...history,
            messages: messagesToCopy,
          },
          { spaces: 2 }
        );

        // 更新消息计数
        newSession.messageCount = messagesToCopy.length;
        newSession.stats = currentSession.stats ? { ...currentSession.stats } : undefined;
        await this.saveSession(newSession);

        logger.debug(`Fork 会话: ${currentSession.title} -> ${newSession.title}`);
      } catch (error) {
        logger.error(`Fork 会话失败: ${(error as Error).message}`);
      }
    }

    return newSession;
  }

  /**
   * 重命名会话
   */
  async renameSession(sessionId: string, newName: string): Promise<Session> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionError(`会话不存在: ${sessionId}`, ErrorCode.SESSION_NOT_FOUND, {
        sessionId,
      });
    }

    session.title = newName;
    session.updatedAt = Date.now();
    await this.saveSession(session);

    logger.debug(`重命名会话: ${sessionId} -> ${newName}`);
    return session;
  }

  /**
   * 导出会话为 JSON
   */
  async exportSession(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionError(`会话不存在: ${sessionId}`, ErrorCode.SESSION_NOT_FOUND, {
        sessionId,
      });
    }

    const exportData = {
      info: {
        id: session.id,
        title: session.title,
        agentType: session.agentType,
        parentID: session.parentID,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        lastActiveAt: session.lastActiveAt,
        stats: session.stats,
      },
      messages: [],
    };

    // 读取消息历史
    if (await fs.pathExists(session.historyFile)) {
      try {
        const history = await fs.readJSON(session.historyFile);
        (exportData.messages as any) = history.messages || [];
      } catch (error) {
        logger.error(`读取历史失败: ${(error as Error).message}`);
      }
    }

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * 导入会话
   */
  async importSession(jsonData: string): Promise<Session> {
    const data = JSON.parse(jsonData);

    // 创建新会话
    const sessionId = this.generateId();
    const sessionFile = path.join(this.config.sessionsDir, `${sessionId}.json`);
    const contextFile = path.join(this.config.sessionsDir, `${sessionId}-context.json`);

    const session: Session = {
      id: sessionId,
      title: data.info?.title || `导入会话 ${new Date().toLocaleString('zh-CN')}`,
      createdAt: data.info?.createdAt || Date.now(),
      updatedAt: Date.now(),
      lastActiveAt: Date.now(),
      historyFile: sessionFile,
      contextFile: contextFile,
      agentType: data.info?.agentType || 'build',
      parentID: data.info?.parentID,
      messageCount: data.messages?.length || 0,
      stats: data.info?.stats,
    };

    // 保存消息历史
    if (data.messages && Array.isArray(data.messages)) {
      await fs.writeJSON(
        sessionFile,
        {
          version: 1,
          messages: data.messages,
          lastUpdated: Date.now(),
        },
        { spaces: 2 }
      );
    }

    // 保存会话信息
    await this.saveSession(session);
    this.sessions.set(sessionId, session);

    logger.debug(`导入会话: ${session.title}`);
    return session;
  }

  /**
   * 获取会话的子会话列表
   */
  getChildSessions(sessionId: string): Session[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.parentID === sessionId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 执行自动清理检查
   */
  private async performAutoCleanup(): Promise<void> {
    if (!this.config.sessionLimits?.auto_cleanup) {
      return;
    }

    const now = Date.now();
    const { cleanup_interval_hours } = this.config.sessionLimits;
    const cleanupInterval = cleanup_interval_hours * 60 * 60 * 1000;

    // 检查是否需要进行清理
    if (now - this.lastCleanupTime >= cleanupInterval) {
      await this.cleanupInactiveSessions();
      this.lastCleanupTime = now;
    }
  }

  /**
   * 手动触发会话清理
   */
  async manualCleanup(): Promise<{ sessionsCleaned: number; message: string }> {
    const cleanedCount = await this.cleanupInactiveSessions();
    this.lastCleanupTime = Date.now();

    return {
      sessionsCleaned: cleanedCount,
      message: cleanedCount > 0 ? `清理了 ${cleanedCount} 个过期会话` : '没有需要清理的会话',
    };
  }

  /**
   * 获取会话统计信息
   */
  getSessionStats(): {
    total: number;
    current: string | null;
    oldestSession: Date | null;
    oldestSessionDays: number | null;
    averageAge: number;
  } {
    const sessions = Array.from(this.sessions.values());
    const now = Date.now();

    if (sessions.length === 0) {
      return {
        total: 0,
        current: null,
        oldestSession: null,
        oldestSessionDays: null,
        averageAge: 0,
      };
    }

    const ages = sessions.map((s) => now - s.createdAt);
    const totalAge = ages.reduce((sum, age) => sum + age, 0);
    const averageAge = totalAge / ages.length;

    const oldestSession = sessions.reduce((oldest, current) =>
      current.createdAt < oldest.createdAt ? current : oldest
    );

    return {
      total: sessions.length,
      current: this.currentSessionId,
      oldestSession: new Date(oldestSession.createdAt),
      oldestSessionDays: Math.floor((now - oldestSession.createdAt) / (24 * 60 * 60 * 1000)),
      averageAge: Math.floor(averageAge / (24 * 60 * 60 * 1000)),
    };
  }

  /**
   * 生成 fork 后的标题
   */
  private getForkedTitle(title: string): string {
    const match = title.match(/^(.+) \(fork #(\d+)\)$/);
    if (match) {
      const base = match[1];
      const num = parseInt(match[2], 10);
      return `${base} (fork #${num + 1})`;
    }
    return `${title} (fork #1)`;
  }
}

/**
 * 创建会话管理器实例
 */
export function createSessionManager(config?: SessionConfig): SessionManager {
  const defaultConfig: SessionConfig = {
    sessionsDir: getSessionsDir(),
    currentSessionFile: getCurrentSessionFile(),
  };

  return new SessionManager(config || defaultConfig);
}
