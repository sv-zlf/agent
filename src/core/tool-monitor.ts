/**
 * GG CODE - 工具使用监控
 * 追踪和统计工具调用性能和使用情况
 */

import { createLogger } from '../utils';

const logger = createLogger(true);

/**
 * 工具调用记录
 */
interface ToolCallRecord {
  toolId: string;
  timestamp: number;
  duration: number;
  success: boolean;
  errorMessage?: string;
  parameterCount: number;
}

/**
 * 工具统计信息
 */
interface ToolStatistics {
  toolId: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  avgDuration: number;
  totalDuration: number;
  lastUsed?: number;
}
/**
 * 工具监控器
 */
export class ToolMonitor {
  private records: ToolCallRecord[] = [];
  private maxRecords = 1000; // 最多保存 1000 条记录
  private stats = new Map<string, ToolStatistics>();

  /**
   * 记录工具调用
   */
  recordCall(record: ToolCallRecord): void {
    // 添加到记录列表
    this.records.push(record);

    // 限制记录数量
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }

    // 更新统计
    let stats = this.stats.get(record.toolId);
    if (!stats) {
      stats = {
        toolId: record.toolId,
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        avgDuration: 0,
        totalDuration: 0,
      };
      this.stats.set(record.toolId, stats);
    }

    stats.totalCalls++;
    stats.totalDuration += record.duration;

    if (record.success) {
      stats.successCalls++;
    } else {
      stats.failedCalls++;
    }

    stats.avgDuration = stats.totalDuration / stats.totalCalls;
    stats.lastUsed = record.timestamp;
  }

  /**
   * 获取工具统计
   */
  getStats(toolId?: string): ToolStatistics | ToolStatistics[] | undefined {
    if (toolId) {
      return this.stats.get(toolId);
    }
    return Array.from(this.stats.values()).sort((a, b) => b.totalCalls - a.totalCalls);
  }

  /**
   * 获取最常用的工具
   */
  getTopTools(limit = 5): ToolStatistics[] {
    return Array.from(this.stats.values())
      .sort((a, b) => b.totalCalls - a.totalCalls)
      .slice(0, limit);
  }

  /**
   * 获取最慢的工具
   */
  getSlowestTools(limit = 5): ToolStatistics[] {
    const toolsWithMinCalls = Array.from(this.stats.values())
      .filter((s) => s.totalCalls >= 3)
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, limit);

    return toolsWithMinCalls;
  }

  /**
   * 获取失败率最高的工具
   */
  getMostFailingTools(limit = 5): ToolStatistics[] {
    const toolsWithMinCalls = Array.from(this.stats.values())
      .filter((s) => s.totalCalls >= 3)
      .map((s) => ({
        ...s,
        failureRate: s.failedCalls / s.totalCalls,
      }))
      .sort((a, b) => b.failureRate - a.failureRate)
      .slice(0, limit);

    return toolsWithMinCalls;
  }

  /**
   * 打印统计报告
   */
  printReport(): void {
    const topTools = this.getTopTools(5);
    const slowestTools = this.getSlowestTools(5);
    const failingTools = this.getMostFailingTools(5);

    logger.info('\n========== 工具使用统计 ==========\n');

    logger.info('最常用的工具:');
    topTools.forEach((stat, i) => {
      const successRate = ((stat.successCalls / stat.totalCalls) * 100).toFixed(1);
      logger.info(
        `  ${i + 1}. ${stat.toolId}: ${stat.totalCalls} 次调用 (成功率: ${successRate}%, 平均: ${stat.avgDuration.toFixed(0)}ms)`
      );
    });

    if (slowestTools.length > 0) {
      logger.info('\n最慢的工具:');
      slowestTools.forEach((stat, i) => {
        logger.info(`  ${i + 1}. ${stat.toolId}: ${stat.avgDuration.toFixed(0)}ms 平均`);
      });
    }

    const toolsWithFailures = failingTools.filter((s) => s.failedCalls > 0);
    if (toolsWithFailures.length > 0) {
      logger.info('\n失败率最高的工具:');
      toolsWithFailures.forEach((stat, i) => {
        const failureRate = ((stat.failedCalls / stat.totalCalls) * 100).toFixed(1);
        logger.info(
          `  ${i + 1}. ${stat.toolId}: ${failureRate}% 失败率 (${stat.failedCalls}/${stat.totalCalls})`
        );
      });
    }

    logger.info('\n==================================\n');
  }

  /**
   * 清空记录
   */
  clear(): void {
    this.records = [];
    this.stats.clear();
  }

  /**
   * 获取总体统计
   */
  getOverallStats() {
    const totalCalls = this.records.length;
    const successCalls = this.records.filter((r) => r.success).length;
    const failedCalls = totalCalls - successCalls;
    const avgDuration =
      totalCalls > 0 ? this.records.reduce((sum, r) => sum + r.duration, 0) / totalCalls : 0;

    return {
      totalCalls,
      successCalls,
      failedCalls,
      successRate: totalCalls > 0 ? (successCalls / totalCalls) * 100 : 0,
      avgDuration,
    };
  }
}

/**
 * 创建工具监控器实例
 */
export function createToolMonitor(): ToolMonitor {
  return new ToolMonitor();
}

// 全局监控器实例
export const toolMonitor = new ToolMonitor();
