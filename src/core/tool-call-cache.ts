/**
 * GG CODE - 工具调用缓存
 * 为工具执行结果添加智能缓存，提高性能
 */

import * as fs from 'fs/promises';
import { createLogger } from '../utils';
import type { ToolResult } from '../types';

const logger = createLogger(true);

/**
 * 缓存条目
 */
interface CacheEntry {
  result: ToolResult;
  timestamp: number;
  hits: number;
  metadata: {
    filePath?: string;
    fileModifiedTime?: number;
    fileSize?: number;
  };
}

/**
 * 缓存配置
 */
const CACHE_CONFIG = {
  maxEntries: 100, // 最多缓存 100 个结果
  maxAge: 5 * 60 * 1000, // 缓存 5 分钟
  maxFileSize: 1024 * 1024, // 只缓存小于 1MB 的文件结果
};

/**
 * 工具调用缓存器
 */
export class ToolCallCache {
  private cache = new Map<string, CacheEntry>();

  /**
   * 生成缓存键
   */
  private generateKey(toolId: string, params: Record<string, unknown>): string {
    // 对参数进行排序，确保相同参数的不同顺序生成相同的键
    const sortedParams = Object.keys(params)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = params[key];
          return acc;
        },
        {} as Record<string, unknown>
      );

    // 简单哈希
    const paramsStr = JSON.stringify(sortedParams);
    let hash = 0;
    for (let i = 0; i < paramsStr.length; i++) {
      const char = paramsStr.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // 转换为 32bit 整数
    }

    return `${toolId}:${Math.abs(hash).toString(36)}`;
  }

  /**
   * 检查是否可以使用缓存
   */
  private async canUseCache(entry: CacheEntry): Promise<boolean> {
    // 检查缓存是否过期
    if (Date.now() - entry.timestamp > CACHE_CONFIG.maxAge) {
      return false;
    }

    // 如果缓存了文件操作，检查文件是否被修改
    if (entry.metadata.filePath && entry.metadata.fileModifiedTime) {
      try {
        const stats = await fs.stat(entry.metadata.filePath);
        if (stats.mtimeMs > entry.metadata.fileModifiedTime) {
          return false; // 文件已被修改
        }
      } catch {
        return false; // 文件不存在或无法访问
      }
    }

    return true;
  }

  /**
   * 获取缓存的结果
   */
  async get(toolId: string, params: Record<string, unknown>): Promise<ToolResult | null> {
    const key = this.generateKey(toolId, params);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // 检查是否可以使用缓存
    if (!(await this.canUseCache(entry))) {
      this.cache.delete(key);
      return null;
    }

    // 增加命中次数
    entry.hits++;

    logger.debug(`Cache HIT: ${toolId} (${entry.hits} hits)`);

    return entry.result;
  }

  /**
   * 设置缓存
   */
  async set(toolId: string, params: Record<string, unknown>, result: ToolResult): Promise<void> {
    // 只缓存成功的结果
    if (!result.success) {
      return;
    }

    // 只缓存小于 maxFileSize 的结果
    if (result.output && result.output.length > CACHE_CONFIG.maxFileSize) {
      return;
    }

    // 限制缓存大小
    if (this.cache.size >= CACHE_CONFIG.maxEntries) {
      this.evictOldest();
    }

    const key = this.generateKey(toolId, params);
    const entry: CacheEntry = {
      result,
      timestamp: Date.now(),
      hits: 0,
      metadata: {},
    };

    // 如果是文件读取操作，记录文件信息
    if (toolId === 'read' || toolId === 'ls' || toolId === 'glob') {
      const filePath = (params as any).filePath || (params as any).path;
      if (filePath && typeof filePath === 'string') {
        try {
          const stats = await fs.stat(filePath);
          entry.metadata.filePath = filePath;
          entry.metadata.fileModifiedTime = stats.mtimeMs;
          entry.metadata.fileSize = stats.size;
        } catch {
          // 文件不存在或无法访问，不缓存
          return;
        }
      }
    }

    this.cache.set(key, entry);

    logger.debug(`Cache SET: ${toolId} (${this.cache.size}/${CACHE_CONFIG.maxEntries})`);
  }

  /**
   * 淘汰最旧的缓存条目
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      logger.debug(`Cache EVICT: ${oldestKey}`);
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    logger.debug('Cache CLEARED');
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    const entries = Array.from(this.cache.values());

    return {
      size: this.cache.size,
      maxEntries: CACHE_CONFIG.maxEntries,
      totalHits: entries.reduce((sum, e) => sum + e.hits, 0),
      avgHits:
        entries.length > 0 ? entries.reduce((sum, e) => sum + e.hits, 0) / entries.length : 0,
      oldestEntry: entries.length > 0 ? Math.min(...entries.map((e) => e.timestamp)) : null,
      newestEntry: entries.length > 0 ? Math.max(...entries.map((e) => e.timestamp)) : null,
    };
  }

  /**
   * 使指定文件的缓存失效
   */
  async invalidateFile(filePath: string): Promise<void> {
    let invalidated = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.metadata.filePath === filePath) {
        this.cache.delete(key);
        invalidated++;
      }
    }

    if (invalidated > 0) {
      logger.debug(`Cache INVALIDATED: ${filePath} (${invalidated} entries)`);
    }
  }
}

// 全局缓存实例
export const toolCallCache = new ToolCallCache();
