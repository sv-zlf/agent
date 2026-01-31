/**
 * GG CODE - Grep Tool
 * 内容搜索工具
 */

import * as z from 'zod';
import { defineTool } from './tool';

// 使用 require 避免 glob 类型问题
const globFn = require('glob');

export const GrepTool = defineTool('grep', {
  description: '在文件中搜索匹配正则表达式的文本。返回包含匹配内容的文件路径和匹配行。',
  parameters: z.object({
    pattern: z.string().describe('要搜索的正则表达式模式'),
    path: z.string().optional().describe('搜索的根目录（默认为当前工作目录）'),
    filePattern: z.string().optional().describe('限制搜索的文件模式，例如 *.ts'),
  }),
  async execute(args, _ctx) {
    const { pattern, path: searchPath = process.cwd(), filePattern = '**/*' } = args;

    try {
      const results: Array<{ file: string; matches: string[] }> = [];

      // 手动实现简单搜索
      const files: string[] = await new Promise((resolve, reject) => {
        globFn(
          filePattern,
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

      if (pattern.length > 10000) {
        return {
          title: 'Invalid Pattern',
          output: `正则表达式过于复杂，可能导致性能问题。请简化搜索模式。`,
          metadata: { error: true, pattern },
        };
      }

      const regex = new RegExp(pattern, 'i');

      for (const file of files) {
        try {
          const fs = await import('fs/promises');
          const content = await fs.readFile(file, 'utf-8');
          const lines = content.split('\n');
          const matches: string[] = [];

          lines.forEach((line, index) => {
            if (regex.test(line)) {
              matches.push(`  ${(index + 1).toString().padStart(5, '0')}| ${line.trim()}`);
            }
          });

          if (matches.length > 0) {
            results.push({ file, matches });
          }
        } catch {
          // 忽略读取错误
        }
      }

      if (results.length === 0) {
        return {
          title: `No matches for: ${pattern}`,
          output: `No matches found for pattern: ${pattern}`,
          metadata: { pattern, path: searchPath, filePattern, count: 0 },
        };
      }

      // 格式化输出
      let output = '';
      let totalMatches = 0;
      const MAX_RESULTS = 100;
      let truncated = false;

      for (let i = 0; i < results.length && totalMatches < MAX_RESULTS; i++) {
        const result = results[i];
        const available = Math.min(result.matches.length, MAX_RESULTS - totalMatches);
        output += `${result.file}:\n${result.matches.slice(0, available).join('\n')}\n\n`;
        totalMatches += available;

        if (available < result.matches.length) {
          truncated = true;
        }
      }

      if (truncated) {
        output += `\n(Output truncated at ${MAX_RESULTS} matches)`;
      }

      return {
        title: `Found matches in ${results.length} file(s)`,
        output,
        metadata: {
          pattern,
          path: searchPath,
          filePattern,
          fileCount: results.length,
          truncated,
        },
      };
    } catch (error: any) {
      return {
        title: 'Grep Error',
        output: `Error searching content: ${error.message}`,
        metadata: { error: true },
      };
    }
  },
});
