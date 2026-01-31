/**
 * GG CODE - Read Tool
 * 读取文件内容
 */

import * as z from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { defineTool } from './tool';
import { truncateOutput } from '../utils/truncation';

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

export const ReadTool = defineTool('read', {
  description:
    '读取文件内容。如果文件不存在，会尝试提供相似文件的建议。支持通过 offset 和 limit 参数分页读取大文件。',
  parameters: z.object({
    filePath: z.string().describe('要读取的文件的绝对路径'),
    offset: z.coerce.number().optional().describe('开始读取的行号（从0开始）'),
    limit: z.coerce.number().optional().describe('要读取的行数（默认为2000）'),
  }),
  async execute(args, _ctx) {
    const { filePath, offset = 0, limit = DEFAULT_READ_LIMIT } = args;

    try {
      // 检查文件是否存在
      const stat = await fs.stat(filePath).catch(() => null);

      if (!stat) {
        // 文件不存在，尝试提供相似文件建议
        const dir = path.dirname(filePath);
        const base = path.basename(filePath);

        try {
          const dirEntries = await fs.readdir(dir);
          const suggestions = dirEntries
            .filter(
              (entry) =>
                entry.toLowerCase().includes(base.toLowerCase()) ||
                base.toLowerCase().includes(entry.toLowerCase())
            )
            .map((entry) => path.join(dir, entry))
            .slice(0, 3);

          if (suggestions.length > 0) {
            return {
              title: `File not found: ${filePath}`,
              output: `File not found: ${filePath}\n\nDid you mean one of these?\n${suggestions.join('\n')}`,
              metadata: { error: true, suggestions },
            };
          }
        } catch {
          // 忽略目录读取错误
        }

        return {
          title: `File not found: ${filePath}`,
          output: `File not found: ${filePath}`,
          metadata: { error: true },
        };
      }

      if (stat.isDirectory()) {
        return {
          title: `Path is a directory: ${filePath}`,
          output: `Path is a directory, not a file: ${filePath}`,
          metadata: { error: true },
        };
      }

      // 读取文件内容
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      // 截取指定范围的行
      const raw: string[] = [];
      let bytes = 0;
      const MAX_BYTES = 50 * 1024;

      for (let i = offset; i < Math.min(lines.length, offset + limit); i++) {
        const line =
          lines[i].length > MAX_LINE_LENGTH
            ? lines[i].substring(0, MAX_LINE_LENGTH) + '...'
            : lines[i];
        const size = Buffer.byteLength(line, 'utf-8') + (raw.length > 0 ? 1 : 0);
        if (bytes + size > MAX_BYTES) break;
        raw.push(line);
        bytes += size;
      }

      // 格式化输出
      const contentWithLineNumbers = raw
        .map((line, index) => {
          const lineNum = offset + index + 1;
          return `${lineNum.toString().padStart(5, '0')}| ${line}`;
        })
        .join('\n');

      let output = `<file>\n${contentWithLineNumbers}`;

      const totalLines = lines.length;
      const lastReadLine = offset + raw.length;
      const hasMoreLines = totalLines > lastReadLine;

      if (hasMoreLines) {
        output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`;
      } else {
        output += `\n\n(End of file - total ${totalLines} lines)`;
      }
      output += '\n</file>';

      // 使用智能截断
      const truncateResult = await truncateOutput(output, {
        maxLines: limit + 20,
        maxBytes: MAX_BYTES + 1024,
        direction: 'head',
      });

      return {
        title: path.basename(filePath),
        output: truncateResult.content,
        metadata: {
          filePath,
          lineCount: totalLines,
          linesRead: raw.length,
          offset,
          truncated: truncateResult.truncated,
          truncationFile: truncateResult.truncated ? (truncateResult as any).outputPath : undefined,
        },
      };
    } catch (error: any) {
      return {
        title: 'Read Error',
        output: `Error reading file: ${error.message}`,
        metadata: { error: true },
      };
    }
  },
});
