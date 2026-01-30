/**
 * GG CODE - Make Directory Tool
 * 创建目录
 */

import * as z from 'zod';
import * as fs from 'fs/promises';
import { defineTool } from './tool';

export const MakeDirectoryTool = defineTool('make-directory', {
  description: '创建目录（包括所有必需的父目录）。如果目录已存在，不会报错。',
  parameters: z.object({
    path: z.string().describe('要创建的目录的绝对路径'),
  }),
  async execute(args, ctx) {
    const { path: dirPath } = args;

    try {
      await fs.mkdir(dirPath, { recursive: true });

      return {
        title: `Directory created: ${dirPath}`,
        output: `Directory created successfully: ${dirPath}`,
        metadata: { path: dirPath },
      };
    } catch (error: any) {
      return {
        title: 'Make Directory Error',
        output: `Error creating directory: ${error.message}`,
        metadata: { error: true },
      };
    }
  },
});
