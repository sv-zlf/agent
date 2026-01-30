/**
 * GG CODE - Batch 工具
 * 批量并行执行多个工具调用
 */

import * as z from 'zod';
import { defineTool } from './tool';
import * as tools from './index';

/**
 * 工具调用定义
 */
interface ToolCallDef {
  tool: string;
  parameters: Record<string, any>;
}

/**
 * 禁止在 Batch 中使用的工具
 */
const DISALLOWED_TOOLS = new Set(['batch']);

/**
 * 执行单个工具调用
 */
async function executeToolCall(
  toolName: string,
  parameters: Record<string, any>,
  ctx: any
): Promise<{ success: boolean; tool: string; result?: any; error?: string }> {
  try {
    // 检查是否是禁止的工具
    if (DISALLOWED_TOOLS.has(toolName)) {
      throw new Error(`工具 '${toolName}' 不允许在 batch 中使用`);
    }

    // 获取工具
    const toolMap = (tools as any).tools;
    const tool = toolMap[toolName];

    if (!tool) {
      // 尝试通过别名查找（小写、驼峰转换等）
      const normalizedKey = Object.keys(toolMap).find(
        key => key.toLowerCase() === toolName.toLowerCase()
      );
      if (normalizedKey) {
        throw new Error(`工具名称应为 '${normalizedKey}'，请使用标准工具名称`);
      }
      throw new Error(`未找到工具: '${toolName}'`);
    }

    // 初始化工具
    const toolInfo = await tool.init();

    // 验证参数
    try {
      toolInfo.parameters.parse(parameters);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMsg = error.issues
          .map(issue => `  - ${issue.path.join('.')}: ${issue.message}`)
          .join('\n');
        throw new Error(`参数验证失败:\n${errorMsg}`);
      }
      throw error;
    }

    // 执行工具
    const result = await toolInfo.execute(parameters, ctx);

    return { success: true, tool: toolName, result };
  } catch (error) {
    return {
      success: false,
      tool: toolName,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 格式化批量执行结果
 */
function formatBatchResults(results: Array<{ success: boolean; tool: string; result?: any; error?: string }>): string {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  let lines: string[] = [];

  if (failed.length > 0) {
    lines.push(`## 批量执行结果\n`);
    lines.push(`✓ 成功: ${successful.length}/${results.length}`);
    lines.push(`✗ 失败: ${failed.length}/${results.length}\n`);

    // 显示成功的工具
    if (successful.length > 0) {
      lines.push(`### 成功的工具 (${successful.length})`);
      successful.forEach(r => {
        const title = r.result?.title || '无标题';
        lines.push(`- ${r.tool}: ${title}`);
      });
      lines.push('');
    }

    // 显示失败的工具
    if (failed.length > 0) {
      lines.push(`### 失败的工具 (${failed.length})`);
      failed.forEach(r => {
        lines.push(`- ${r.tool}: ${r.error}`);
      });
      lines.push('');
    }

    // 显示详细输出
    if (successful.length > 0) {
      lines.push(`### 详细输出\n`);
      successful.forEach((r, idx) => {
        const output = r.result?.output || '';
        const truncated = output.length > 500 ? output.substring(0, 500) + '\n... (输出已截断)' : output;
        lines.push(`#### ${r.tool}\n${truncated}\n`);
      });
    }

    lines.push(`\n💡 提示: 批量执行已将失败的工具列出，请检查错误后重试`);
  } else {
    lines.push(`## 批量执行成功\n`);
    lines.push(`所有 ${successful.length} 个工具执行成功！\n`);

    // 显示所有工具的简要结果
    successful.forEach(r => {
      const title = r.result?.title || '无标题';
      lines.push(`✓ ${r.tool}: ${title}`);
    });

    lines.push(`\n💡 继续使用 Batch 工具可以保持最佳性能！`);
  }

  return lines.join('\n');
}

/**
 * BatchTool - 批量并行执行工具
 *
 * 注意事项：
 * - 最多支持 25 个工具调用
 * - 所有调用并行执行，不保证顺序
 * - 部分失败不会影响其他工具
 * - 不允许嵌套 batch 调用
 * - 仅适用于独立的工具调用（无依赖关系）
 */
export const BatchTool = defineTool('batch', {
  description: '批量并行执行多个独立工具调用，提高效率。适用于读取多个文件、组合搜索等场景。',
  parameters: z.object({
    tool_calls: z.array(
      z.object({
        tool: z.string().describe('要执行的工具名称'),
        parameters: z.object({}).loose().describe('工具参数（JSON 对象）'),
      })
    ).min(1, '至少需要一个工具调用').max(25, '最多支持 25 个工具调用').describe('要并行执行的工具调用数组'),
  }),
  formatValidationError(error) {
    const formattedErrors = error.issues
      .map(issue => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
        return `  - ${path}: ${issue.message}`;
      })
      .join('\n');

    return `Batch 工具参数验证失败:\n${formattedErrors}\n\n期望的格式:\n[{"tool": "工具名", "parameters": {...}}, ...]`;
  },
  async execute(args, ctx) {
    const { tool_calls } = args;

    // 执行所有工具调用（并行）
    const results = await Promise.all(
      tool_calls.map(call => executeToolCall(call.tool, call.parameters, ctx))
    );

    // 统计结果
    const successfulCount = results.filter(r => r.success).length;
    const failedCount = results.length - successfulCount;

    // 格式化输出
    const output = formatBatchResults(results);

    // 收集所有成功工具的附件
    const attachments = results
      .filter(r => r.success && r.result?.attachments)
      .flatMap(r => r.result.attachments);

    return {
      title: `批量执行 (${successfulCount}/${results.length} 成功)`,
      output,
      metadata: {
        totalCalls: results.length,
        successful: successfulCount,
        failed: failedCount,
        tools: tool_calls.map(c => c.tool),
        details: results.map(r => ({
          tool: r.tool,
          success: r.success,
          error: r.error,
        })),
      },
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  },
});
