/**
 * GG CODE - MultiEdit 工具
 * 对单个文件执行多次编辑操作
 */

import * as z from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { defineTool } from './tool';

/**
 * 编辑操作定义
 */
interface EditOperation {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 验证编辑操作是否有效
 */
function validateEditOperations(operations: EditOperation[]): { valid: boolean; error?: string } {
  for (let i = 0; i < operations.length; i++) {
    const edit = operations[i];

    // 检查 oldString 和 newString 是否不同
    if (edit.oldString === edit.newString) {
      return {
        valid: false,
        error: `编辑操作 #${i + 1}: oldString 和 newString 不能相同`,
      };
    }

    // 检查 oldString 不能为空（除非是创建新文件的特殊情况）
    if (edit.oldString === '' && i > 0) {
      return {
        valid: false,
        error: `编辑操作 #${i + 1}: 只有第一个操作可以使用空 oldString（用于创建新文件）`,
      };
    }
  }

  return { valid: true };
}

/**
 * 格式化编辑结果
 */
function formatMultiEditResults(
  filePath: string,
  results: Array<{ index: number; success: boolean; message: string; replacements?: number }>,
  totalCount: number
): string {
  const lines: string[] = [];

  lines.push(`## MultiEdit 结果`);
  lines.push(`文件: ${path.basename(filePath)}\n`);

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (failed.length > 0) {
    lines.push(`### ❌ 编辑失败`);
    lines.push(`成功: ${successful.length}/${totalCount}`);
    lines.push(`失败: ${failed.length}/${totalCount}\n`);

    lines.push(`### 失败的操作:`);
    failed.forEach(r => {
      lines.push(`${r.index}. ${r.message}`);
    });
  } else {
    lines.push(`### ✅ 所有编辑成功`);
    lines.push(`执行了 ${totalCount} 个编辑操作\n`);

    const totalReplacements = successful.reduce((sum, r) => sum + (r.replacements || 0), 0);
    lines.push(`总计: ${totalReplacements} 处替换\n`);

    lines.push(`### 编辑详情:`);
    successful.forEach(r => {
      lines.push(`${r.index}. ${r.message}`);
    });
  }

  return lines.join('\n');
}

/**
 * MultiEditTool - 对单个文件执行多次编辑
 *
 * 核心特性：
 * - 原子性操作：所有编辑成功或全部失败
 * - 顺序执行：编辑按提供的顺序依次应用
 * - 高效执行：对同一文件的多次编辑优化
 *
 * 适用场景：
 * - 需要对同一文件进行多处修改
 * - 重构代码中的多个相关部分
 * - 创建新文件并进行初始编辑
 */
export const MultiEditTool = defineTool('multiedit', {
  description: '对单个文件执行多次编辑操作。所有编辑按顺序执行，原子性操作（全部成功或全部失败）。适用于需要对同一文件进行多处修改的场景。',
  parameters: z.object({
    filePath: z.string().describe('要编辑的文件的绝对路径'),
    edits: z.array(
      z.object({
        oldString: z.string().describe('要替换的旧字符串（必须完全匹配）'),
        newString: z.string().describe('要替换成的新字符串'),
        replaceAll: z.boolean().optional().describe('是否替换所有匹配项（默认只替换第一个）'),
      })
    ).min(1, '至少需要一个编辑操作').max(50, '最多支持 50 个编辑操作').describe('编辑操作数组，按顺序执行'),
  }),
  formatValidationError(error) {
    const formattedErrors = error.issues
      .map(issue => {
        const path = issue.path.join('.');
        return `  - ${path}: ${issue.message}`;
      })
      .join('\n');

    return `MultiEdit 工具参数验证失败:\n${formattedErrors}\n\n期望的格式:\n{\n  "filePath": "绝对路径",\n  "edits": [\n    {"oldString": "...", "newString": "...", "replaceAll": false}\n  ]\n}`;
  },
  async execute(args, ctx) {
    const { filePath, edits } = args;

    try {
      // 验证编辑操作
      const validation = validateEditOperations(edits);
      if (!validation.valid) {
        return {
          title: 'MultiEdit 验证失败',
          output: validation.error!,
          metadata: { error: true, validationFailed: true },
        };
      }

      // 读取原始文件内容（用于回滚）
      let originalContent: string | null = null;
      let currentContent: string;

      try {
        originalContent = await fs.readFile(filePath, 'utf-8');
        currentContent = originalContent;
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // 文件不存在，检查是否是创建新文件
          const firstEdit = edits[0];
          if (firstEdit.oldString === '') {
            // 创建新文件
            currentContent = '';
            originalContent = null; // 新文件不需要回滚
          } else {
            return {
              title: 'MultiEdit 失败',
              output: `文件不存在: ${filePath}\n\n提示: 如要创建新文件，第一个编辑操作应使用空 oldString`,
              metadata: { error: true, notFound: true },
            };
          }
        } else {
          throw error;
        }
      }

      // 执行所有编辑操作
      const results: Array<{ index: number; success: boolean; message: string; replacements?: number }> = [];
      let contentAfterEdits = currentContent;

      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        const { oldString, newString, replaceAll = false } = edit;

        try {
          // 处理创建新文件的特殊情况
          if (oldString === '' && i === 0) {
            contentAfterEdits = newString;
            results.push({
              index: i + 1,
              success: true,
              message: `创建新文件（${newString.split('\n').length} 行）`,
              replacements: 1,
            });
            continue;
          }

          // 检查是否包含要替换的字符串
          if (!contentAfterEdits.includes(oldString)) {
            throw new Error(`未找到要替换的内容: "${oldString.substring(0, 50)}${oldString.length > 50 ? '...' : ''}"`);
          }

          // 计算匹配数量
          const count = (contentAfterEdits.match(new RegExp(escapeRegExp(oldString), 'g')) || []).length;

          if (count > 1 && !replaceAll) {
            throw new Error(`找到 ${count} 处匹配，需要设置 replaceAll=true 或提供更唯一的 oldString`);
          }

          // 执行替换
          contentAfterEdits = replaceAll
            ? contentAfterEdits.split(oldString).join(newString)
            : contentAfterEdits.replace(oldString, newString);

          results.push({
            index: i + 1,
            success: true,
            message: replaceAll ? `替换了 ${count} 处` : `替换了 1 处`,
            replacements: count,
          });
        } catch (error: any) {
          // 编辑失败，停止后续操作
          results.push({
            index: i + 1,
            success: false,
            message: error.message || String(error),
          });

          // 原子性：如果有失败，不写入文件
          return {
            title: `MultiEdit 失败 (${results.filter(r => r.success).length}/${edits.length} 成功)`,
            output: formatMultiEditResults(filePath, results, edits.length),
            metadata: {
              error: true,
              partialFailure: true,
              successful: results.filter(r => r.success).length,
              failed: results.filter(r => !r.success).length,
              details: results,
            },
          };
        }
      }

      // 所有编辑成功，写入文件
      await fs.writeFile(filePath, contentAfterEdits, 'utf-8');

      // 计算统计信息
      const totalReplacements = results.reduce((sum, r) => sum + (r.replacements || 0), 0);
      const linesBefore = currentContent.split('\n').length;
      const linesAfter = contentAfterEdits.split('\n').length;
      const lineDelta = linesAfter - linesBefore;

      return {
        title: `MultiEdit 成功: ${path.basename(filePath)}`,
        output: formatMultiEditResults(filePath, results, edits.length),
        metadata: {
          filePath,
          totalEdits: edits.length,
          totalReplacements,
          linesBefore,
          linesAfter,
          lineDelta,
          details: results,
        },
      };
    } catch (error: any) {
      return {
        title: 'MultiEdit 错误',
        output: `执行 MultiEdit 时出错: ${error.message}`,
        metadata: { error: true },
      };
    }
  },
});
