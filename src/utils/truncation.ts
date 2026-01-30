/**
 * 智能输出截断系统
 * 参考 OpenCode 实现，支持按行数/字节数截断，溢出内容保存到文件
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from './logger';

const logger = createLogger();

/**
 * 截断默认配置
 */
export const TRUNCATE_DEFAULTS = {
  MAX_LINES: 2000,      // 最大行数
  MAX_BYTES: 50 * 1024, // 最大字节数 (50KB)
  RETENTION_DAYS: 7,    // 文件保留天数
} as const;

/**
 * 截断选项
 */
export interface TruncateOptions {
  maxLines?: number;    // 最大行数限制
  maxBytes?: number;    // 最大字节数限制
  direction?: 'head' | 'tail'; // 截断方向：head（保留头部）或 tail（保留尾部）
  outputDir?: string;   // 溢出文件存储目录
}

/**
 * 截断结果
 */
export type TruncateResult =
  | { content: string; truncated: false }
  | { content: string; truncated: true; outputPath: string; stats: TruncateStats };

/**
 * 截断统计信息
 */
export interface TruncateStats {
  totalLines: number;      // 总行数
  totalBytes: number;      // 总字节数
  keptLines: number;       // 保留行数
  keptBytes: number;       // 保留字节数
  removedLines?: number;   // 移除行数（如果按行截断）
  removedBytes?: number;   // 移除字节数（如果按字节截断）
  truncateReason: 'lines' | 'bytes'; // 截断原因
}

/**
 * 生成唯一文件 ID
 */
function generateFileId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `tool_${timestamp}_${random}`;
}

/**
 * 获取截断文件存储目录
 */
function getOutputDir(customDir?: string): string {
  if (customDir) {
    return customDir;
  }
  // 默认存储在用户主目录下的 .ggcode/tool-output
  return path.join(os.homedir(), '.ggcode', 'tool-output');
}

/**
 * 确保输出目录存在
 * 返回实际使用的目录路径
 */
async function ensureOutputDir(dir: string): Promise<string> {
  try {
    await fs.ensureDir(dir);
    return dir;
  } catch (error) {
    logger.warning(`Failed to create truncation output directory: ${dir}`);
    // 创建失败时回退到临时目录
    const tmpDir = path.join(os.tmpdir(), 'ggcode-tool-output');
    await fs.ensureDir(tmpDir);
    return tmpDir;
  }
}

/**
 * 清理过期的截断文件
 */
export async function cleanupOldTruncationFiles(
  outputDir?: string,
  retentionDays: number = TRUNCATE_DEFAULTS.RETENTION_DAYS
): Promise<void> {
  const dir = getOutputDir(outputDir);

  try {
    const exists = await fs.pathExists(dir);
    if (!exists) {
      return;
    }

    const files = await fs.readdir(dir);
    const now = Date.now();
    const cutoffTime = now - retentionDays * 24 * 60 * 60 * 1000;

    let cleanedCount = 0;
    for (const file of files) {
      if (!file.startsWith('tool_')) {
        continue;
      }

      try {
        const filePath = path.join(dir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath);
          cleanedCount++;
        }
      } catch (error) {
        // 忽略单个文件清理失败
        logger.debug(`Failed to cleanup truncation file: ${file}`);
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} old truncation files`);
    }
  } catch (error) {
    logger.warning(`Failed to cleanup truncation files: ${error}`);
  }
}

/**
 * 截断输出文本
 *
 * @param text - 要截断的文本
 * @param options - 截断选项
 * @returns 截断结果
 */
export async function truncateOutput(
  text: string,
  options: TruncateOptions = {}
): Promise<TruncateResult> {
  const maxLines = options.maxLines ?? TRUNCATE_DEFAULTS.MAX_LINES;
  const maxBytes = options.maxBytes ?? TRUNCATE_DEFAULTS.MAX_BYTES;
  const direction = options.direction ?? 'head';

  // 计算文本统计信息
  const lines = text.split('\n');
  const totalLines = lines.length;
  const totalBytes = Buffer.byteLength(text, 'utf-8');

  // 如果未超过限制，直接返回
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return { content: text, truncated: false };
  }

  // 按行数和字节数进行截断
  const result: string[] = [];
  let byteCount = 0;

  if (direction === 'head') {
    // 从头部开始截断
    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      const lineSize = Buffer.byteLength(lines[i], 'utf-8') + (i > 0 ? 1 : 0); // +1 for newline

      if (byteCount + lineSize > maxBytes) {
        // 字节限制已达到
        const keptBytes = byteCount;
        const removedBytes = totalBytes - keptBytes;

        // 生成截断提示
        const preview = result.join('\n');
        const truncatedResult = await saveTruncatedOutput(
          text,
          preview,
          {
            totalLines,
            totalBytes,
            keptLines: result.length,
            keptBytes,
            removedBytes,
            truncateReason: 'bytes',
          },
          options
        );

        return truncatedResult;
      }

      result.push(lines[i]);
      byteCount += lineSize;
    }

    // 行数限制已达到
    const keptLines = result.length;
    const removedLines = totalLines - keptLines;

    const preview = result.join('\n');
    return await saveTruncatedOutput(
      text,
      preview,
      {
        totalLines,
        totalBytes,
        keptLines,
        keptBytes: byteCount,
        removedLines,
        truncateReason: 'lines',
      },
      options
    );
  } else {
    // 从尾部开始截断（保留尾部）
    for (let i = lines.length - 1; i >= 0 && result.length < maxLines; i--) {
      const lineSize = Buffer.byteLength(lines[i], 'utf-8') + (result.length > 0 ? 1 : 0);

      if (byteCount + lineSize > maxBytes) {
        // 字节限制已达到
        const keptBytes = byteCount;
        const removedBytes = totalBytes - keptBytes;

        const preview = result.reverse().join('\n');
        const truncatedResult = await saveTruncatedOutput(
          text,
          preview,
          {
            totalLines,
            totalBytes,
            keptLines: result.length,
            keptBytes,
            removedBytes,
            truncateReason: 'bytes',
          },
          options
        );

        return truncatedResult;
      }

      result.unshift(lines[i]);
      byteCount += lineSize;
    }

    // 行数限制已达到
    const keptLines = result.length;
    const removedLines = totalLines - keptLines;

    const preview = result.join('\n');
    return await saveTruncatedOutput(
      text,
      preview,
      {
        totalLines,
        totalBytes,
        keptLines,
        keptBytes: byteCount,
        removedLines,
        truncateReason: 'lines',
      },
      options
    );
  }
}

/**
 * 保存截断后的完整输出并生成提示消息
 */
async function saveTruncatedOutput(
  fullText: string,
  preview: string,
  stats: TruncateStats,
  options: TruncateOptions
): Promise<TruncateResult> {
  const dir = await ensureOutputDir(getOutputDir(options.outputDir));
  const fileId = generateFileId();
  const outputPath = path.join(dir, fileId);

  try {
    // 将完整内容写入文件
    await fs.writeFile(outputPath, fullText, 'utf-8');

    // 生成截断提示
    const removed = stats.truncateReason === 'bytes'
      ? `${(stats.removedBytes || 0).toLocaleString()} bytes`
      : `${(stats.removedLines || 0).toLocaleString()} lines`;

    const hint = `\n... ${removed} truncated ...\n\n`;
    const message = `工具输出已截断，完整内容已保存到：${outputPath}\n可以使用 Grep 搜索完整内容，或使用 Read 工具配合 offset/limit 参数查看特定部分。`;

    const content =
      options.direction === 'tail'
        ? `${hint}${message}\n\n${preview}`
        : `${preview}\n\n${hint}${message}`;

    return {
      content,
      truncated: true,
      outputPath,
      stats,
    };
  } catch (error) {
    logger.error(`Failed to save truncated output: ${error}`);

    // 如果保存失败，至少返回截断后的内容
    const removed = stats.truncateReason === 'bytes'
      ? `${(stats.removedBytes || 0).toLocaleString()} bytes`
      : `${(stats.removedLines || 0).toLocaleString()} lines`;

    return {
      content: `${preview}\n\n... ${removed} truncated (failed to save full output) ...`,
      truncated: false,
    };
  }
}

/**
 * 格式化截断统计信息为可读字符串
 */
export function formatTruncateStats(stats: TruncateStats): string {
  const { totalLines, totalBytes, keptLines, keptBytes, truncateReason } = stats;

  const removed = truncateReason === 'bytes'
    ? ((totalBytes - keptBytes) / 1024).toFixed(1) + ' KB'
    : (totalLines - keptLines).toLocaleString() + ' lines';

  return `Truncated: ${removed} (${keptLines.toLocaleString()} lines, ${(keptBytes / 1024).toFixed(1)} KB kept of ${totalLines.toLocaleString()} lines, ${(totalBytes / 1024).toFixed(1)} KB total)`;
}
