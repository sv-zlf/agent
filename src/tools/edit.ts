/**
 * GG CODE - Edit Tool
 * 编辑文件内容 - 支持智能匹配
 */

import * as z from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { defineTool } from './tool';
import { findMatch } from '../utils/edit-utils';
import { escapeRegExp } from '../utils/edit-utils';

export const EditTool = defineTool('edit', {
  description:
    '对文件执行精确的字符串替换。必须在读取文件后才能使用此工具。oldString 必须与文件内容完全匹配，包括缩进和换行符。',
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

      // 尝试查找匹配
      const matchResult = findMatch(content, oldString);

      if (!matchResult.found) {
        return {
          success: false,
          error: 'old_string not found in file',
          title: 'Edit Failed',
          output: `Edit failed: old_string not found in file

The specified string was not found after trying the following matching strategies:
${matchResult.strategies.map((s) => `  - ${s}`).join('\n')}

Suggestions:
1. Use the Read tool first to see the exact file content
2. Make sure to include the exact indentation (spaces/tabs) as shown after the line number
3. Try providing more context (surrounding lines) to make the match unique
4. Check for any trailing spaces or invisible characters`,
          metadata: { error: true, notFound: true, attemptedStrategies: matchResult.strategies },
        };
      }

      const matchedString = matchResult.matchedString;

      // 计算匹配数量
      const count = (content.match(new RegExp(escapeRegExp(matchedString), 'g')) || []).length;

      if (count > 1 && !replaceAll) {
        return {
          success: false,
          error: 'old_string appears multiple times',
          title: 'Edit Failed',
          output: `Edit failed: old_string appears ${count} times in the file

The matched string was found using the "${matchResult.strategy}" strategy.

Suggestions:
1. Set replaceAll=true to replace all occurrences
2. Provide a more unique old_string by including more surrounding lines`,
          metadata: {
            error: true,
            multipleMatches: true,
            count,
            matchStrategy: matchResult.strategy,
          },
        };
      }

      // 执行替换
      const newContent = replaceAll
        ? content.split(matchedString).join(newString)
        : content.replace(matchedString, newString);

      await fs.writeFile(filePath, newContent, 'utf-8');

      return {
        title: `File edited: ${path.basename(filePath)}`,
        output: replaceAll
          ? `Replaced ${count} occurrence(s) using "${matchResult.strategy}" strategy`
          : `Successfully replaced 1 occurrence using "${matchResult.strategy}" strategy`,
        metadata: {
          filePath,
          replacements: count,
          matchStrategy: matchResult.strategy,
        },
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {
          success: false,
          error: `Edit failed: file not found`,
          title: 'Edit Failed',
          output: `Edit failed: file not found

File does not exist: ${filePath}

Use the Write tool to create new files.`,
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
