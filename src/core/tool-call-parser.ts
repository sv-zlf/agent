/**
 * GG CODE - 优化后的工具调用解析器
 * 参考 Opencode 设计，简化为只支持标准 JSON 格式
 */

import type { ToolCall } from '../types';
import { createLogger } from '../utils';

const logger = createLogger(true);

/**
 * 解析统计
 */
const PARSE_STATS = {
  totalAttempts: 0,
  successCount: 0,
  failureCount: 0,
  avgTimeMs: 0,
};

/**
 * 简化的工具调用解析器
 * 支持格式:
 * - 单个对象: {"tool": "read", "parameters": {...}}
 * - 数组格式: [{"tool": "read", ...}, {"tool": "edit", ...}]
 */
export class ToolCallParser {
  /**
   * 从 AI 响应中提取工具调用
   * 使用简化的解析策略，只支持 JSON 格式
   */
  static parseToolCalls(response: string, knownTools: Set<string>): ToolCall[] {
    const startTime = Date.now();
    PARSE_STATS.totalAttempts++;

    const calls: ToolCall[] = [];
    const seen = new Set<string>();

    // 清理响应文本
    const cleaned = this.cleanResponse(response);

    // 策略 0: 提取 JSON 数组 (批量调用)
    // 格式: [{"tool": "read", "parameters": {...}}, {"tool": "edit", ...}]
    const arrayPattern = /\[\s*\{\s*"tool"\s*:\s*"\w+"[\s\S]*?\}\s*\]/g;

    let arrayMatch = arrayPattern.exec(cleaned);
    if (arrayMatch) {
      try {
        const parsedArray = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsedArray)) {
          for (const item of parsedArray) {
            if (item.tool && item.parameters) {
              const toolId = item.tool.toLowerCase();
              if (knownTools.has(toolId)) {
                const key = `${toolId}:${JSON.stringify(item.parameters)}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  calls.push({
                    tool: toolId,
                    parameters: item.parameters,
                    id: item.id || this.generateId(),
                  });
                }
              }
            }
          }
          if (calls.length > 0) {
            logger.debug(`✅ 成功解析 ${calls.length} 个工具调用 (数组格式)`);
            return calls;
          }
        }
      } catch (error) {
        // 数组解析失败，静默处理，继续尝试单个对象
        // 不向用户显示技术错误，后台默默处理
        // 数组解析失败，继续尝试单个对象
      }
    }

    // 策略 1: 提取 JSON 对象 (最常用)
    // 格式: {"tool": "Read", "parameters": {"filePath": "..."}}
    const jsonPattern = /\{\s*"tool"\s*:\s*"(\w+)"\s*,\s*"parameters"\s*:\s*\{[\s\S]*?\}\s*(?:,\s*"id"\s*:\s*"([^"]+)")?\s*\}/g;

    let match;
    while ((match = jsonPattern.exec(cleaned)) !== null && calls.length < 10) {
      const toolName = match[1];
      const jsonString = match[0];

      try {
        const parsed = JSON.parse(jsonString);
        if (parsed.tool && parsed.parameters) {
          const toolId = toolName.toLowerCase();

          // 验证工具是否存在
          if (knownTools.has(toolId)) {
            const key = `${toolId}:${JSON.stringify(parsed.parameters)}`;
            if (!seen.has(key)) {
              seen.add(key);
              calls.push({
                tool: toolId,
                parameters: parsed.parameters,
                id: parsed.id || this.generateId(),
              });
            }
          } else {
            logger.debug(`Unknown tool: ${toolId}`);
          }
        }
      } catch (error) {
        // JSON 解析失败，静默处理
        // 不显示技术错误给用户，后台默默处理
      }
    }

    // 策略 2: 查找代码块内的 JSON
    // 格式:
    // ```json
    // {"tool": "Read", "parameters": {...}}
    // ```
    const codeBlockPattern = /```(?:json)?\s*\n?\s*(\{\s*"tool"\s*:\s*"\w+"\s*,\s*"parameters"\s*:\s*\{[\s\S]*?\}\s*(?:,\s*"id"\s*:\s*"[^"]+")?\s*\})\s*```?/g;

    while ((match = codeBlockPattern.exec(cleaned)) !== null && calls.length < 10) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.tool && parsed.parameters) {
          const toolId = parsed.tool.toLowerCase();

          if (knownTools.has(toolId)) {
            const key = `${toolId}:${JSON.stringify(parsed.parameters)}`;
            if (!seen.has(key)) {
              seen.add(key);
              calls.push({
                tool: toolId,
                parameters: parsed.parameters,
                id: parsed.id || this.generateId(),
              });
            }
          }
        }
      } catch (error) {
        logger.debug(`Failed to parse code block JSON: ${error}`);
      }
    }

    // 更新统计
    const duration = Date.now() - startTime;
    PARSE_STATS.avgTimeMs = (PARSE_STATS.avgTimeMs * (PARSE_STATS.totalAttempts - 1) + duration) / PARSE_STATS.totalAttempts;

    if (calls.length > 0) {
      PARSE_STATS.successCount++;
    } else {
      PARSE_STATS.failureCount++;
    }

    return calls;
  }

  /**
   * 清理响应文本
   */
  private static cleanResponse(response: string): string {
    // 移除控制字符
    let cleaned = response.replace(/^[\u0000-\u001F\u007F-\u009F\u200B-\u200F\uFEFF]+/, '');

    // 移除 markdown 代码块标记（保留内容）
    cleaned = cleaned.replace(/```\w*\n?/g, '');

    return cleaned;
  }

  /**
   * 生成工具调用 ID
   */
  private static generateId(): string {
    return `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 检测是否存在工具调用
   */
  static hasToolCalls(response: string): boolean {
    const cleaned = this.cleanResponse(response);
    // 简单检测：是否包含 "tool" 和 "parameters" 关键字
    return cleaned.includes('"tool"') && cleaned.includes('"parameters"');
  }

  /**
   * 获取解析统计
   */
  static getStats() {
    return { ...PARSE_STATS };
  }

  /**
   * 重置统计
   */
  static resetStats() {
    PARSE_STATS.totalAttempts = 0;
    PARSE_STATS.successCount = 0;
    PARSE_STATS.failureCount = 0;
    PARSE_STATS.avgTimeMs = 0;
  }
}
