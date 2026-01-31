/**
 * GG CODE - Write Tool
 * 写入文件内容
 */

import * as z from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { defineTool } from './tool';

export const WriteTool = defineTool('write', {
  description: '创建新文件或覆盖现有文件的内容。如果文件已存在，将被完全覆盖。',
  parameters: z.object({
    filePath: z.string().describe('要写入的文件的绝对路径'),
    content: z.string().describe('要写入文件的内容'),
  }),
  async execute(args, _ctx) {
    const { filePath, content } = args;

    try {
      // 确保目录存在
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // 写入文件
      await fs.writeFile(filePath, content, 'utf-8');

      const lines = content.split('\n').length;

      return {
        title: `File written: ${path.basename(filePath)}`,
        output: `File created successfully: ${filePath}\n${lines} lines written`,
        metadata: {
          filePath,
          lineCount: lines,
          bytes: Buffer.byteLength(content, 'utf-8'),
        },
      };
    } catch (error: any) {
      return {
        title: 'Write Error',
        output: `Error writing file: ${error.message}`,
        metadata: { error: true },
      };
    }
  },
});
