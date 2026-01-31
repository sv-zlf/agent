/**
 * GG CODE - Glob Tool
 * 文件模式匹配搜索
 */

import * as z from 'zod';
import { defineTool } from './tool';
import { truncateOutput } from '../utils/truncation';

const globFn = require('glob');

export const GlobTool = defineTool('glob', {
  description:
    '使用 glob 模式搜索文件。支持 **/* 和 *.ts 等通配符。返回匹配的文件路径列表，按修改时间排序。',
  parameters: z.object({
    pattern: z.string().describe('Glob 搜索模式，例如 **/*.ts 或 src/**/*.js'),
    path: z.string().optional().describe('搜索的根目录（默认为当前工作目录）'),
  }),
  async execute(args, _ctx) {
    const { pattern, path: searchPath = process.cwd() } = args;

    try {
      const files: string[] = await new Promise((resolve, reject) => {
        globFn(
          pattern,
          {
            cwd: searchPath,
            absolute: true,
            windowsPathsNoEscape: true,
          },
          (err: any, matches: string[]) => {
            if (err) reject(err);
            else resolve(matches);
          }
        );
      });

      if (files.length === 0) {
        return {
          title: `No matches for: ${pattern}`,
          output: `No files found matching pattern: ${pattern}`,
          metadata: { pattern, path: searchPath, count: 0 },
        };
      }

      interface FileStat {
        filePath: string;
        mtime: number;
      }

      const filesWithStats: FileStat[] = await Promise.all(
        files.map(async (filePath: string): Promise<FileStat> => {
          try {
            const stat = await import('fs/promises').then((fs) => fs.stat(filePath));
            return { filePath, mtime: stat.mtimeMs };
          } catch {
            return { filePath, mtime: 0 };
          }
        })
      );

      filesWithStats.sort((a: FileStat, b: FileStat) => b.mtime - a.mtime);
      const sortedFiles = filesWithStats.map((f: FileStat) => f.filePath);

      const output = sortedFiles.join('\n');

      const truncateResult = await truncateOutput(output, {
        maxLines: 100,
        maxBytes: 10 * 1024,
        direction: 'head',
      });

      return {
        title: `Found ${files.length} file(s)`,
        output: truncateResult.content,
        metadata: {
          pattern,
          path: searchPath,
          count: files.length,
          truncated: truncateResult.truncated,
          truncationFile: truncateResult.truncated ? (truncateResult as any).outputPath : undefined,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Error searching files: ${error.message}`,
        title: 'Glob Error',
        output: `Error searching files: ${error.message}`,
        metadata: { error: true },
      };
    }
  },
});
