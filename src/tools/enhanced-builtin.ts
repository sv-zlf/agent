/**
 * 增强的内置工具
 * 使用 Zod 验证和智能文件检测
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as fg from 'fast-glob';
import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { ToolResult } from '../types';
import { createTool, Schemas, type ToolExecutionContext } from '../core/tool-enhanced';
import { createCodeOperator } from '../core/code-operator';
import { createLogger } from '../utils';

const logger = createLogger(true);
const execAsync = promisify(exec);

/**
 * 二进制文件扩展名
 */
const BINARY_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.lib',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
]);

/**
 * 文件大小限制
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LINE_COUNT = 10000;

/**
 * 检测是否为二进制文件
 */
function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * 检测文件编码
 */
async function detectFileEncoding(filePath: string): Promise<'utf8' | 'binary' | 'unknown'> {
  try {
    const buffer = await fs.readFile(filePath);
    const head = buffer.slice(0, 1000);

    // 检查 UTF-8 BOM
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      return 'utf8';
    }

    // 检查空字节（二进制文件）
    if (head.includes(0x00)) {
      return 'binary';
    }

    // 检查是否为文本（可打印字符占比）
    let printableChars = 0;
    for (let i = 0; i < head.length; i++) {
      const byte = head[i];
      if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
        printableChars++;
      }
    }

    const ratio = printableChars / head.length;
    if (ratio > 0.7) {
      return 'utf8';
    }

    return 'binary';
  } catch {
    return 'unknown';
  }
}

/**
 * 查找相似的文件名
 */
async function findSimilarFiles(filePath: string, maxResults = 5): Promise<string[]> {
  try {
    const dir = path.dirname(filePath);
    const name = path.basename(filePath);
    const ext = path.extname(name);
    const baseName = name.replace(ext, '');

    // 查找目录中的所有文件
    const files = await fs.readdir(dir);
    const similar: Array<{ file: string; score: number }> = [];

    for (const file of files) {
      // 计算相似度（简单的编辑距离）
      const distance = levenshteinDistance(baseName, file.replace(path.extname(file), ''));
      if (distance <= 3 && distance > 0) {
        similar.push({ file: path.join(dir, file), score: distance });
      }
    }

    // 按相似度排序
    similar.sort((a, b) => a.score - b.score);
    return similar.slice(0, maxResults).map((s) => s.file);
  } catch {
    return [];
  }
}

/**
 * 简单的编辑距离算法
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // 删除
        matrix[j - 1][i] + 1, // 插入
        matrix[j - 1][i - 1] + indicator // 替换
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Read 工具 - 增强版
 */
export const EnhancedReadTool = createTool({
  name: 'Read',
  description: '读取文件内容。这是用于读取文件的主要工具。在你想要查看文件内容时使用此工具。',
  category: 'file',
  permission: 'safe',
  parameters: z.object({
    file_path: Schemas.filePath(),
    offset: Schemas.offset(),
    limit: Schemas.limit(),
  }),
  examples: [
    {
      args: { file_path: '/path/to/file.ts' },
      description: '读取整个文件',
    },
    {
      args: { file_path: '/path/to/file.ts', offset: 100, limit: 50 },
      description: '读取第 100-149 行',
    },
  ],
  handler: async (args, context) => {
    const { file_path, offset = 0, limit } = args as { file_path: string; offset?: number; limit?: number };

    try {
      // 检查文件是否存在
      if (!await fs.pathExists(file_path)) {
        // 提供建议
        const similar = await findSimilarFiles(file_path);
        let suggestion = '';
        if (similar.length > 0) {
          suggestion = `\n\n您是否想查找以下文件？\n${similar.map((f) => `  - ${f}`).join('\n')}`;
        }

        return {
          success: false,
          error: `文件不存在: ${file_path}${suggestion}`,
        };
      }

      // 检查是否为二进制文件
      if (isBinaryFile(file_path)) {
        return {
          success: false,
          error: `不能读取二进制文件: ${file_path}`,
        };
      }

      // 检测文件编码
      const encoding = await detectFileEncoding(file_path);
      if (encoding === 'binary') {
        return {
          success: false,
          error: `文件似乎是二进制文件，无法读取: ${file_path}`,
        };
      }

      // 检查文件大小
      const stats = await fs.stat(file_path);
      if (stats.size > MAX_FILE_SIZE) {
        return {
          success: false,
          error: `文件过大 (${(stats.size / 1024 / 1024).toFixed(2)}MB)，超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)`,
        };
      }

      // 读取文件内容
      const content = await fs.readFile(file_path, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      // 检查行数限制
      if (totalLines > MAX_LINE_COUNT && !limit) {
        return {
          success: false,
          error: `文件行数过多 (${totalLines} 行)，请使用 offset 和 limit 参数分批读取`,
        };
      }

      // 截取内容
      let result = '';
      if (limit !== undefined) {
        result = lines.slice(offset, offset + limit).join('\n');
      } else {
        result = lines.slice(offset).join('\n');
      }

      // 添加行号前缀格式
      const startLine = offset + 1;
      const endLine = limit !== undefined ? Math.min(offset + limit, totalLines) : totalLines;

      const numberedLines = result.split('\n').map((line, i) => {
        const lineNum = startLine + i;
        return `${lineNum}\t${line}`;
      }).join('\n');

      // 检测是否被截断
      const truncated = limit !== undefined && offset + limit < totalLines;

      return {
        success: true,
        output: numberedLines,
        metadata: {
          file_path,
          total_lines: totalLines,
          lines_shown: endLine - startLine + 1,
          start_line: startLine,
          end_line: endLine,
          truncated,
          encoding,
          size_bytes: stats.size,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/**
 * Edit 工具 - 增强版（带验证）
 */
export const EnhancedEditTool = createTool({
  name: 'Edit',
  description: '对文件执行精确的字符串替换。在你想对文件进行修改时应该首选此工具。此工具执行字符串搜索和替换操作。',
  category: 'file',
  permission: 'local-modify',
  parameters: z.object({
    file_path: Schemas.filePath(),
    old_string: z.string().min(1, '要替换的字符串不能为空'),
    new_string: z.string(),
    replace_all: z.boolean().optional().default(false),
  }),
  validate: (args) => {
    // 验证 old_string 和 new_string 不能完全相同
    if (args.old_string === args.new_string) {
      return 'old_string 和 new_string 不能完全相同';
    }
    return null;
  },
  examples: [
    {
      args: {
        file_path: '/path/to/file.ts',
        old_string: 'const x = 1',
        new_string: 'const x = 2',
      },
      description: '替换单个匹配',
    },
    {
      args: {
        file_path: '/path/to/file.ts',
        old_string: 'foo',
        new_string: 'bar',
        replace_all: true,
      },
      description: '替换所有匹配',
    },
  ],
  handler: async (args, context) => {
    const { file_path, old_string, new_string, replace_all = false } = args;

    try {
      // 检查文件是否存在
      if (!await fs.pathExists(file_path)) {
        return {
          success: false,
          error: `文件不存在: ${file_path}`,
        };
      }

      // 检查是否为二进制文件
      if (isBinaryFile(file_path)) {
        return {
          success: false,
          error: `不能编辑二进制文件: ${file_path}`,
        };
      }

      // 备份文件
      const backupPath = file_path + '.backup';
      await fs.copy(file_path, backupPath);
      logger.debug(`Backup created: ${backupPath}`);

      // 读取文件内容
      const content = await fs.readFile(file_path, 'utf-8');

      // 检查 old_string 是否存在
      if (!content.includes(old_string)) {
        // 尝试提供相似字符串建议
        const lines = content.split('\n');
        const similar: string[] = [];

        for (const line of lines.slice(0, 50)) {
          const distance = levenshteinDistance(old_string.trim(), line.trim());
          if (distance <= 5 && line.trim().length > 0) {
            similar.push(line.trim().substring(0, 80));
          }
        }

        let suggestion = '';
        if (similar.length > 0) {
          suggestion = `\n\n文件中相似的字符串:\n${similar.map((s) => `  - ${s}`).join('\n')}`;
        }

        return {
          success: false,
          error: `未找到要替换的字符串: "${old_string.substring(0, 50)}${old_string.length > 50 ? '...' : ''}"${suggestion}`,
        };
      }

      // 执行替换
      const newContent = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string);

      // 检查实际替换次数
      const occurrences = replace_all
        ? (content.match(new RegExp(old_string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
        : (content.includes(old_string) ? 1 : 0);

      // 写入新内容
      await fs.writeFile(file_path, newContent, 'utf-8');

      return {
        success: true,
        output: `文件已成功编辑: ${file_path} (${occurrences} 处修改)`,
        metadata: {
          file_path,
          replacements: occurrences,
          backup_path: backupPath,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/**
 * Bash 工具 - 增强版（带安全检查）
 */
export const EnhancedBashTool = createTool({
  name: 'Bash',
  description: '执行 shell 命令。用于运行测试、构建项目、git 操作等。',
  category: 'command',
  permission: 'dangerous',
  parameters: z.object({
    command: Schemas.command(),
    description: z.string().optional().describe('命令的简短描述（用于日志记录）'),
  }),
  validate: (args) => {
    // 检查危险命令
    const dangerousCommands = ['rm -rf /', 'rm -rf /*', 'mkfs', 'dd if=/dev/zero', '> /dev/sda', 'format'];
    const cmd = args.command.toLowerCase().trim();

    for (const dangerous of dangerousCommands) {
      if (cmd.includes(dangerous)) {
        return `检测到危险命令: ${dangerous}`;
      }
    }

    return null;
  },
  examples: [
    {
      args: { command: 'npm test' },
      description: '运行测试',
    },
    {
      args: { command: 'git status' },
      description: '查看 Git 状态',
    },
  ],
  handler: async (args, context) => {
    const { command, description, __abortSignal__, __timeout__ } = args;

    try {
      logger.debug(`Executing command: ${command}`);

      // 使用自定义的超时或默认超时
      const timeout = __timeout__ || 60000; // 默认 60 秒

      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024, // 10MB
        timeout: timeout,
      });

      const output = stdout || stderr || '命令执行成功（无输出）';

      return {
        success: true,
        output: output.trim(),
        metadata: {
          command,
          description,
          has_stderr: !!stderr,
          exit_code: 0,
        },
      };
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // 检查是否是超时或中断
      if (__abortSignal__?.aborted) {
        return {
          success: false,
          error: '命令执行已被用户中断',
          metadata: {
            command,
            description,
          },
        };
      }

      // execAsync 的超时错误
      if (errorMsg.includes('timed out') || errorMsg.includes('ETIMEDOUT')) {
        return {
          success: false,
          error: `命令执行超时`,
          metadata: {
            command,
            description,
          },
        };
      }

      // 检查是否被 kill（用户 Ctrl+C）
      if (errorMsg.includes('killed') || errorMsg.includes('SIGTERM')) {
        return {
          success: false,
          error: '命令执行已被用户中断',
          metadata: {
            command,
            description,
          },
        };
      }

      return {
        success: false,
        error: `命令执行失败: ${errorMsg}`,
        metadata: {
          command,
          description,
          exit_code: error.code || 1,
        },
      };
    }
  },
});

/**
 * 导出增强工具列表
 */
export const enhancedBuiltinTools = [
  EnhancedReadTool,
  EnhancedEditTool,
  EnhancedBashTool,
];
