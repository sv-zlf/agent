/**
 * GG CODE - Edit Tool
 * 编辑文件内容
 */

import * as z from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { defineTool } from './tool';

export const EditTool = defineTool('edit', {
  description:
    '对文件执行精确的字符串替换。必须在读取文件后才能使用此工具。old_string 必须与文件内容完全匹配，包括缩进和换行符。',
  parameters: z.object({
    filePath: z.string().describe('要编辑的文件的绝对路径'),
    oldString: z.string().describe('要替换的旧字符串（必须完全匹配）'),
    newString: z.string().describe('要替换成的新字符串'),
    replaceAll: z.boolean().optional().describe('是否替换所有匹配项（默认只替换第一个）'),
  }),
  async execute(args, _ctx) {
    const { filePath, oldString, newString, replaceAll = false } = args;

    // 验证 oldString 不能为空
    if (!oldString) {
      return {
        success: false,
        error: 'oldString cannot be empty',
        title: 'Edit Failed',
        output: 'Edit failed: oldString cannot be empty',
        metadata: { error: true, invalidParams: true },
      };
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      let searchContent = oldString;
      let useNormalized = false;

      if (!content.includes(oldString)) {
        const normalizedOld = oldString.replace(/\r\n/g, '\n');
        const normalizedContent = content.replace(/\r\n/g, '\n');

        if (normalizedContent.includes(normalizedOld)) {
          searchContent = normalizedOld;
          useNormalized = true;
        } else {
          return {
            success: false,
            error: 'old_string not found in file',
            title: 'Edit Failed',
            output: `Edit failed: old_string not found in file\n\nThe specified string was not found. You must use the Read tool first to see the exact content.`,
            metadata: { error: true, notFound: true },
          };
        }
      }

      const count = (content.match(new RegExp(escapeRegExp(searchContent), 'g')) || []).length;

      if (count > 1 && !replaceAll) {
        return {
          success: false,
          error: 'old_string appears multiple times',
          title: 'Edit Failed',
          output: `Edit failed: old_string appears ${count} times in the file\n\nPlease set replace_all=true to replace all occurrences, or provide a more unique old_string.`,
          metadata: { error: true, multipleMatches: true, count },
        };
      }

      let newContent: string;
      if (useNormalized) {
        const normalizedContent = content.replace(/\r\n/g, '\n');
        const normalizedNew = newString.replace(/\r\n/g, '\n');
        newContent = normalizedContent.split(searchContent).join(normalizedNew);
        newContent = newContent.replace(/\n/g, '\r\n');
      } else {
        newContent = replaceAll
          ? content.split(searchContent).join(newString)
          : content.replace(searchContent, newString);
      }

      await fs.writeFile(filePath, newContent, 'utf-8');

      return {
        title: `File edited: ${path.basename(filePath)}`,
        output: replaceAll
          ? `Replaced ${count} occurrence(s)`
          : `Successfully replaced 1 occurrence`,
        metadata: {
          filePath,
          replacements: count,
        },
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {
          success: false,
          error: `Edit failed: file not found`,
          title: 'Edit Failed',
          output: `Edit failed: file not found\n\nFile does not exist: ${filePath}\n\nUse the Write tool to create new files.`,
          metadata: { error: true, notFound: true },
        };
      }
      return {
        success: false,
        error: `Error editing file: ${error.message}`,
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
