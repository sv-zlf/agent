/**
 * 工具执行监控包装器
 * 为工具执行添加监控、日志和性能追踪
 */

import { createLogger } from './logger';
import type { ToolCall, ToolResult } from '../types';

const logger = createLogger();

/**
 * 监控统计数据
 */
interface ToolStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalDuration: number;
  averageDuration: number;
  lastCallTime: number;
  errors: Record<string, number>;
}

/**
 * 工具监控器
 */
class ToolMonitor {
  private stats: Map<string, ToolStats> = new Map();

  /**
   * 记录工具调用
   */
  recordCall(toolName: string, result: ToolResult): void {
    const stats = this.stats.get(toolName) || {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      totalDuration: 0,
      averageDuration: 0,
      lastCallTime: 0,
      errors: {},
    };

    stats.totalCalls++;
    stats.lastCallTime = Date.now();

    if (result.success) {
      stats.successfulCalls++;
      if (result.metadata?.duration) {
        stats.totalDuration += result.metadata.duration;
        stats.averageDuration = stats.totalDuration / stats.successfulCalls;
      }
    } else {
      stats.failedCalls++;
      const errorCode = result.error || 'unknown';
      stats.errors[errorCode] = (stats.errors[errorCode] || 0) + 1;
    }

    this.stats.set(toolName, stats);
  }

  /**
   * 获取工具统计
   */
  getStats(toolName?: string): ToolStats | Record<string, ToolStats> {
    if (toolName) {
      return (
        this.stats.get(toolName) || {
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          totalDuration: 0,
          averageDuration: 0,
          lastCallTime: 0,
          errors: {},
        }
      );
    }
    return Object.fromEntries(this.stats.entries());
  }

  /**
   * 重置统计
   */
  reset(toolName?: string): void {
    if (toolName) {
      this.stats.delete(toolName);
    } else {
      this.stats.clear();
    }
  }

  /**
   * 打印统计摘要
   */
  printSummary(): void {
    const allStats = this.getStats();
    const toolNames = Object.keys(allStats);

    if (toolNames.length === 0) {
      logger.info('No tool calls recorded yet.');
      return;
    }

    logger.info('\n=== Tool Execution Statistics ===\n');

    for (const [name, stats] of Object.entries(allStats)) {
      const successRate = ((stats.successfulCalls / stats.totalCalls) * 100).toFixed(1);
      logger.info(`${name}:`);
      logger.info(`  Total calls: ${stats.totalCalls}`);
      logger.info(`  Success rate: ${successRate}%`);
      logger.info(`  Avg duration: ${stats.averageDuration.toFixed(0)}ms`);
      if (stats.failedCalls > 0) {
        logger.info(`  Errors:`);
        for (const [error, count] of Object.entries(stats.errors)) {
          logger.info(`    - ${error}: ${count}x`);
        }
      }
      logger.info('');
    }
  }
}

/**
 * 全局监控器实例
 */
export const toolMonitor = new ToolMonitor();

/**
 * 包装工具执行，添加监控功能
 */
export function wrapToolExecution(
  toolName: string,
  _call: ToolCall,
  executeFn: () => Promise<ToolResult>
): Promise<ToolResult> {
  const startTime = Date.now();

  logger.debug(`[${toolName}] Starting execution with tool: ${toolName}`);

  return executeFn()
    .then((result) => {
      const duration = Date.now() - startTime;

      // 添加执行时间到元数据
      if (!result.metadata) {
        result.metadata = {};
      }
      result.metadata.duration = duration;
      result.metadata.toolName = toolName;

      // 记录到监控
      toolMonitor.recordCall(toolName, result);

      // 日志输出
      if (result.success) {
        logger.debug(`[${toolName}] Completed successfully in ${duration}ms`);
      } else {
        logger.warning(`[${toolName}] Failed after ${duration}ms: ${result.error}`);
      }

      return result;
    })
    .catch((error) => {
      const duration = Date.now() - startTime;

      // 记录错误
      toolMonitor.recordCall(toolName, {
        success: false,
        error: error.message,
        metadata: { duration, toolName },
      } as ToolResult);

      logger.error(`[${toolName}] Exception after ${duration}ms: ${error.message || error}`);

      throw error;
    });
}

/**
 * 获取工具统计信息（用于显示给用户）
 */
export function getToolStatsSummary(): string {
  const allStats = toolMonitor.getStats();
  const toolNames = Object.keys(allStats);

  if (toolNames.length === 0) {
    return 'No tool calls recorded yet.';
  }

  const lines: string[] = ['\n📊 Tool Execution Statistics:\n'];

  for (const [name, stats] of Object.entries(allStats)) {
    const successRate =
      stats.totalCalls > 0 ? ((stats.successfulCalls / stats.totalCalls) * 100).toFixed(1) : '0.0';

    lines.push(`**${name}**`);
    lines.push(
      `  Calls: ${stats.totalCalls} | Success: ${successRate}% | Avg: ${stats.averageDuration.toFixed(0)}ms`
    );

    if (stats.failedCalls > 0) {
      const errorSummary = Object.entries(stats.errors)
        .map(([err, cnt]) => `${err}(${cnt}x)`)
        .join(', ');
      lines.push(`  Errors: ${errorSummary}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
