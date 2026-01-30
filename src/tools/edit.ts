/**
 * GG CODE - Edit Tool
 * 编辑文件内容
 */

import * as z from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { defineTool } from './tool';

export const EditTool = defineTool('edit', {
  description: '对文件执行精确的字符串替换。必须在读取文件后才能使用此工具。old_string 必须与文件内容完全匹配，包括缩进和换行符。',
  parameters: z.object({
    filePath: z.string().describe('要编辑的文件的绝对路径'),
    oldString: z.string().describe('要替换的旧字符串（必须完全匹配）'),
    newString: z.string().describe('要替换成的新字符串'),
    replaceAll: z.boolean().optional().describe('是否替换所有匹配项（默认只替换第一个）'),
  }),
  async execute(args, ctx) {
    const { filePath, oldString, newString, replaceAll = false } = args;

    try {
      // 读取文件内容
      const content = await fs.readFile(filePath, 'utf-8');

      // 检查是否包含要替换的字符串
      if (!content.includes(oldString)) {
        return {
          title: 'Edit Failed',
          output: `Edit failed: old_string not found in file\n\nThe specified string was not found. You must use the Read tool first to see the exact content.`,
          metadata: { error: true, notFound: true },
        };
      }

      // 计算匹配数量
      const count = (content.match(new RegExp(escapeRegExp(oldString), 'g')) || []).length;

      if (count > 1 && !replaceAll) {
        return {
          title: 'Edit Failed',
          output: `Edit failed: old_string appears ${count} times in the file\n\nPlease set replace_all=true to replace all occurrences, or provide a more unique old_string.`,
          metadata: { error: true, multipleMatches: true, count },
        };
      }

      // 执行替换
      const newContent = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString);

      // 写回文件
      await fs.writeFile(filePath, newContent, 'utf-8');

      const replacementLines = newString.split('\n').length;
      const replacedLines = oldString.split('\n').length;

      return {
        title: `File edited: ${path.basename(filePath)}`,
        output: `Edit successful\n${replaceAll ? `Replaced ${count} occurrence(s)` : 'Replaced 1 occurrence'}`,
        metadata: {
          filePath,
          replacements: count,
          replacementLines,
          replacedLines,
        },
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {
          title: 'Edit Failed',
          output: `Edit failed: file not found\n\nFile does not exist: ${filePath}\n\nUse the Write tool to create new files.`,
          metadata: { error: true, notFound: true },
        };
      }
      return {
        title: 'Edit Error',
        output: `Error editing file: ${error.message}`,
        metadata: { error: true },
      };
    }
  },
});

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
