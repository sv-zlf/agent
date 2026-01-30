/**
 * 增强的内置工具 - 简化版
 * 移除复杂的包装，直接实现 ToolDefinition 接口
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition, ToolResult } from '../types';
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
 * Levenshtein 距离算法
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * 查找相似的文件名
 */
async function findSimilarFiles(filePath: string, maxResults = 5): Promise<string[]> {
  try {
    const dir = path.dirname(filePath);
    const name = path.basename(filePath);

    if (!await fs.pathExists(dir)) {
      return [];
    }

    const files = await fs.readdir(dir);
    const similar: Array<{ file: string; score: number }> = [];

    for (const file of files) {
      const distance = levenshteinDistance(name, file);
      if (distance <= 3 && distance > 0) {
        similar.push({ file: path.join(dir, file), score: distance });
      }
    }

    similar.sort((a, b) => a.score - b.score);
    return similar.slice(0, maxResults).map((s) => s.file);
  } catch {
    return [];
  }
}

/**
 * 查找相似的字符串
 */
function findSimilarStrings(target: string, content: string, maxResults = 5): string[] {
  const lines = content.split('\n');
  const similar: Array<{ line: string; score: number }> = [];

  for (const line of lines.slice(0, 100)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      const distance = levenshteinDistance(target.trim(), trimmed);
      if (distance <= 5 && distance > 0) {
        similar.push({ line: trimmed.substring(0, 80), score: distance });
      }
    }
  }

  similar.sort((a, b) => a.score - b.score);
  return similar.slice(0, maxResults).map((s) => s.line);
}

/**
 * Read 工具 - 增强版
 */
export const EnhancedReadTool: ToolDefinition = {
  name: 'Read',
  description: '读取文件内容。这是用于读取文件的主要工具。在你想要查看文件内容时使用此工具。',
  category: 'file',
  permission: 'safe',
  parameters: {
    file_path: {
      type: 'string',
      description: '文件的绝对路径',
      required: true,
    },
    offset: {
      type: 'number',
      description: '开始读取的行号（从0开始）',
      required: false,
      default: 0,
    },
    limit: {
      type: 'number',
      description: '读取的最大行数',
      required: false,
    },
  },
  handler: async (args) => {
    try {
      const { file_path, offset = 0, limit } = args as { file_path: string; offset?: number; limit?: number };

      // 检查文件是否存在
      if (!await fs.pathExists(file_path)) {
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
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * Edit 工具 - 增强版
 */
export const EnhancedEditTool: ToolDefinition = {
  name: 'Edit',
  description: '对文件执行精确的字符串替换。在你想对文件进行修改时应该首选此工具。此工具执行字符串搜索和替换操作。',
  category: 'file',
  permission: 'local-modify',
  parameters: {
    file_path: {
      type: 'string',
      description: '文件的绝对路径',
      required: true,
    },
    old_string: {
      type: 'string',
      description: '要被替换的字符串',
      required: true,
    },
    new_string: {
      type: 'string',
      description: '替换后的新字符串',
      required: true,
    },
    replace_all: {
      type: 'boolean',
      description: '是否替换所有匹配项（默认为false，只替换第一个匹配项）',
      required: false,
      default: false,
    },
  },
  handler: async (args) => {
    try {
      const { file_path, old_string, new_string, replace_all = false } = args as {
        file_path: string;
        old_string: string;
        new_string: string;
        replace_all?: boolean;
      };

      // 验证参数
      if (old_string === new_string) {
        return {
          success: false,
          error: 'old_string 和 new_string 不能完全相同',
        };
      }

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
        const similar = findSimilarStrings(old_string, content);
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

      // 计算替换次数
      const occurrences = replace_all
        ? (content.match(new RegExp(old_string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
        : 1;

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
};

/**
 * Bash 工具 - 增强版
 */
export const EnhancedBashTool: ToolDefinition = {
  name: 'Bash',
  description: '执行shell命令。用于运行测试、构建项目、git 操作等。',
  category: 'command',
  permission: 'dangerous',
  parameters: {
    command: {
      type: 'string',
      description: '要执行的shell命令',
      required: true,
    },
    description: {
      type: 'string',
      description: '命令的简短描述（用于日志记录）',
      required: false,
    },
  },
  handler: async (args) => {
    const { command, description, __abortSignal__, __timeout__ } = args as {
      command: string;
      description?: string;
      __abortSignal__?: AbortSignal;
      __timeout__?: number;
    };

    // 检查危险命令
    const dangerousPatterns = [
      'rm -rf /',
      'rm -rf /*',
      'rm -rf /\\',
      'mkfs',
      'dd if=/dev/zero',
      'dd if=/dev/sda',
      'dd if=/dev/sdb',
      '> /dev/sda',
      '> /dev/sdb',
      'format',
      'del /f /s /q',
    ];

    const cmdLower = command.toLowerCase().trim();
    for (const pattern of dangerousPatterns) {
      if (cmdLower.includes(pattern)) {
        return {
          success: false,
          error: `检测到危险命令: ${pattern}`,
        };
      }
    }

    try {
      logger.debug(`Executing command: ${command}`);

      const timeout = __timeout__ || 60000;

      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024,
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

      // 检查是否是超时
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

      // 检查是否被中断
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
};

/**
 * 导出增强工具列表
 */
export const enhancedBuiltinTools = [
  EnhancedReadTool,
  EnhancedEditTool,
  EnhancedBashTool,
];
