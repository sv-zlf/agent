import * as fs from 'fs-extra';
import * as path from 'path';
import * as fg from 'fast-glob';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition, ToolResult } from '../types';
import { createCodeOperator } from '../core/code-operator';
import { createLogger } from '../utils';

const logger = createLogger(true); // 启用debug模式用于工具执行

const execAsync = promisify(exec);

/**
 * 读取文件工具
 */
export const ReadTool: ToolDefinition = {
  name: 'Read',
  description: '读取文件内容。这是用于读取文件的主要工具。在你想要查看文件内容时使用此工具。',
  category: 'file',
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

      if (!await fs.pathExists(file_path)) {
        return {
          success: false,
          error: `文件不存在: ${file_path}`,
        };
      }

      const content = await fs.readFile(file_path, 'utf-8');
      const lines = content.split('\n');

      let result = '';
      if (limit !== undefined) {
        result = lines.slice(offset, offset + limit).join('\n');
      } else {
        result = lines.slice(offset).join('\n');
      }

      // 添加行号前缀格式
      const totalLines = lines.length;
      const startLine = offset + 1;
      const endLine = limit !== undefined ? Math.min(offset + limit, totalLines) : totalLines;

      const numberedLines = result.split('\n').map((line, i) => {
        const lineNum = startLine + i;
        return `${lineNum}\t${line}`;
      }).join('\n');

      return {
        success: true,
        output: numberedLines,
        metadata: {
          file_path,
          total_lines: totalLines,
          lines_shown: endLine - startLine + 1,
          start_line: startLine,
          end_line: endLine,
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
 * 写入文件工具
 */
export const WriteTool: ToolDefinition = {
  name: 'Write',
  description: '写入文件内容。此工具会覆盖整个文件。仅在你确定需要完全覆盖文件时使用此工具。否则，应该使用Edit工具。',
  category: 'file',
  parameters: {
    file_path: {
      type: 'string',
      description: '文件的绝对路径',
      required: true,
    },
    content: {
      type: 'string',
      description: '要写入的内容',
      required: true,
    },
  },
  handler: async (args) => {
    try {
      const { file_path, content } = args as { file_path: string; content: string };

      // 确保目录存在
      await fs.ensureDir(path.dirname(file_path));

      // 如果文件存在，先备份
      if (await fs.pathExists(file_path)) {
        const backupPath = file_path + '.backup';
        await fs.copy(file_path, backupPath);
        logger.debug(`Backup created: ${backupPath}`);
      }

      await fs.writeFile(file_path, content, 'utf-8');

      return {
        success: true,
        output: `文件已成功写入: ${file_path}`,
        metadata: {
          file_path,
          content_length: content.length,
          line_count: content.split('\n').length,
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
 * 编辑文件工具
 */
export const EditTool: ToolDefinition = {
  name: 'Edit',
  description: '对文件执行精确的字符串替换。在你想对文件进行修改时应该首选此工具。此工具执行字符串搜索和替换操作。',
  category: 'file',
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

      if (!await fs.pathExists(file_path)) {
        return {
          success: false,
          error: `文件不存在: ${file_path}`,
        };
      }

      // 备份文件
      const backupPath = file_path + '.backup';
      await fs.copy(file_path, backupPath);
      logger.debug(`Backup created: ${backupPath}`);

      const content = await fs.readFile(file_path, 'utf-8');

      if (!content.includes(old_string)) {
        return {
          success: false,
          error: '未找到要替换的字符串',
        };
      }

      const newContent = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string);

      await fs.writeFile(file_path, newContent, 'utf-8');

      return {
        success: true,
        output: `文件已成功编辑: ${file_path}`,
        metadata: {
          file_path,
          replacements: replace_all ? (content.split(old_string).length - 1) : 1,
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
 * Glob工具 - 文件模式匹配
 */
export const GlobTool: ToolDefinition = {
  name: 'Glob',
  description: '使用glob模式查找文件。当你需要根据模式查找文件时使用此工具。',
  category: 'search',
  parameters: {
    pattern: {
      type: 'string',
      description: 'glob模式，例如 "**/*.ts" 或 "src/**/*.js"',
      required: true,
    },
    path: {
      type: 'string',
      description: '搜索的根目录（默认为当前工作目录）',
      required: false,
    },
  },
  handler: async (args) => {
    try {
      const { pattern, path: searchPath = '.' } = args as { pattern: string; path?: string };

      const files = await fg.glob(pattern, {
        cwd: searchPath,
        onlyFiles: true,
        absolute: true,
      });

      return {
        success: true,
        output: files.join('\n'),
        metadata: {
          count: files.length,
          pattern,
          path: searchPath,
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
 * Grep工具 - 代码搜索
 */
export const GrepTool: ToolDefinition = {
  name: 'Grep',
  description: '在文件中搜索匹配的内容。支持正则表达式。当你想要查找代码中的特定内容时使用此工具。',
  category: 'search',
  parameters: {
    pattern: {
      type: 'string',
      description: '搜索模式（支持正则表达式）',
      required: true,
    },
    path: {
      type: 'string',
      description: '搜索路径（默认为当前目录）',
      required: false,
    },
    glob: {
      type: 'string',
      description: '文件过滤模式，例如 "*.ts" (默认搜索所有文件)',
      required: false,
    },
    case_insensitive: {
      type: 'boolean',
      description: '是否忽略大小写（默认为true）',
      required: false,
      default: true,
    },
  },
  handler: async (args) => {
    try {
      const {
        pattern,
        path: searchPath = '.',
        glob: fileGlob,
        case_insensitive = true,
      } = args as {
        pattern: string;
        path?: string;
        glob?: string;
        case_insensitive?: boolean;
      };

      const codeOperator = createCodeOperator();
      const results = await codeOperator.searchCode(pattern, {
        filePattern: fileGlob || '**/*',
        caseSensitive: !case_insensitive,
        maxResults: 100,
      });

      // 过滤结果路径
      const filteredResults = results.filter((result) => {
        const resultPath = result.split(':')[0];
        const fullPath = path.resolve(searchPath, resultPath);
        return fullPath.startsWith(path.resolve(searchPath));
      });

      return {
        success: true,
        output: filteredResults.join('\n'),
        metadata: {
          count: filteredResults.length,
          pattern,
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
 * Bash工具 - 执行命令
 */
export const BashTool: ToolDefinition = {
  name: 'Bash',
  description: '执行shell命令。用于运行测试、构建项目、git操作等。仅在你确定命令安全时使用。',
  category: 'command',
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
    const { command, description } = args as { command: string; description?: string };

    try {
      logger.info(`Executing command: ${command}`);

      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024, // 10MB
        timeout: 120000, // 2分钟
      });

      const output = stdout || stderr || '命令执行成功（无输出）';

      return {
        success: true,
        output: output.trim(),
        metadata: {
          command,
          description,
          has_stderr: !!stderr,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `命令执行失败: ${errorMsg}`,
        metadata: {
          command,
          description,
        },
      };
    }
  },
};

/**
 * MakeDirectory工具 - 创建目录
 */
export const MakeDirectoryTool: ToolDefinition = {
  name: 'MakeDirectory',
  description: '创建目录（文件夹）。支持递归创建多级目录。',
  category: 'file',
  parameters: {
    path: {
      type: 'string',
      description: '目录路径（相对或绝对路径）',
      required: true,
    },
    recursive: {
      type: 'boolean',
      description: '是否递归创建父目录（默认为true）',
      required: false,
    },
  },
  handler: async (args) => {
    try {
      const { path: dirPath, recursive = true } = args as { path: string; recursive?: boolean };

      logger.info(`Creating directory: ${dirPath}`);

      // 确保目录存在
      await fs.ensureDir(dirPath, {
        mode: 0o755, // rwxr-xr-x
      });

      // 验证目录是否创建成功
      const exists = await fs.pathExists(dirPath);
      if (!exists) {
        return {
          success: false,
          error: '目录创建失败：无法验证目录是否存在',
        };
      }

      return {
        success: true,
        output: `目录已创建: ${dirPath}`,
        metadata: {
          path: dirPath,
          recursive,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `创建目录失败: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          path: (args as any).path,
        },
      };
    }
  },
};

/**
 * 内置工具集合
 */
export const builtinTools: ToolDefinition[] = [
  ReadTool,
  WriteTool,
  EditTool,
  GlobTool,
  GrepTool,
  BashTool,
  MakeDirectoryTool,
];
