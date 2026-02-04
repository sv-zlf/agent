/**
 * GG CODE - 工具错误处理优化
 * 参考 Opencode 设计，提供更友好的错误消息
 */

import * as z from 'zod';
import { createLogger } from '../utils';

const logger = createLogger(true);

/**
 * 格式化工具参数验证错误
 * 提供清晰的错误消息和正确示例
 */
export function formatToolValidationError(
  toolId: string,
  error: z.ZodError,
  parameters?: z.ZodType
): string {
  const issues = error.issues;

  let message = `❌ 工具 "${toolId}" 参数错误\n\n`;

  // 分类错误类型
  const missingParams = issues.filter(
    (e) => e.code === 'invalid_type' && e.received === 'undefined'
  );
  const invalidParams = issues.filter(
    (e) => e.code === 'invalid_type' && e.received !== 'undefined'
  );
  const otherErrors = issues.filter(
    (e) => e.code !== 'invalid_type' || e.received === 'undefined'
  );

  // 1. 缺少必需参数
  if (missingParams.length > 0) {
    message += `📋 缺少必需参数:\n`;
    missingParams.forEach((issue) => {
      const paramPath = issue.path.join('.') || 'unknown';
      message += `   ❌ ${paramPath}\n`;
    });

    // 如果有参数定义，生成正确示例
    if (parameters) {
      const example = generateParameterExample(toolId, parameters, missingParams);
      message += `\n✅ 正确示例:\n`;
      message += example;
    }
  }

  // 2. 参数类型错误
  if (invalidParams.length > 0) {
    if (missingParams.length > 0) message += '\n';
    message += `🔧 参数类型错误:\n`;
    invalidParams.forEach((issue) => {
      const paramPath = issue.path.join('.') || 'unknown';
      const expected = issue.expected;
      const received = issue.received;
      message += `   ❌ ${paramPath}: 期望 ${expected}, 收到 ${received}\n`;
    });
  }

  // 3. 其他错误
  if (otherErrors.length > 0) {
    if (missingParams.length > 0 || invalidParams.length > 0) message += '\n';
    message += `⚠️  其他错误:\n`;
    otherErrors.forEach((issue) => {
      const paramPath = issue.path.join('.');
      message += `   ❌ ${paramPath}: ${issue.message}\n`;
    });
  }

  return message;
}

/**
 * 生成参数示例
 */
function generateParameterExample(
  toolId: string,
  parameters: z.ZodType,
  missingParams: z.ZodIssue[]
): string {
  try {
    // 获取参数 schema
    const schema = parameters as z.ZodObject<any>;

    // 创建最小示例（只包含缺少的必需参数）
    const example: Record<string, any> = {};

    // 尝试从缺少的参数中推断示例值
    missingParams.forEach((issue) => {
      const paramName = issue.path[0];
      if (paramName) {
        example[paramName] = getExampleValue(paramName);
      }
    });

    return `{"tool": "${toolId}", "parameters": ${JSON.stringify(example, null, 2)}}`;
  } catch (error) {
    logger.debug(`Failed to generate parameter example: ${error}`);
    // 回退到简单示例
    return `{"tool": "${toolId}", "parameters": {}}`;
  }
}

/**
 * 根据参数名推断示例值
 */
function getExampleValue(paramName: string): string | number | boolean {
  const lowerName = paramName.toLowerCase();

  // 文件路径相关
  if (lowerName.includes('file') && lowerName.includes('path')) {
    return '/path/to/file.txt';
  }
  if (lowerName.includes('dir') && lowerName.includes('path')) {
    return '/path/to/directory';
  }
  if (lowerName === 'path') {
    return '/path/to/resource';
  }

  // 搜索相关
  if (lowerName.includes('pattern') || lowerName === 'query') {
    return 'search_pattern';
  }
  if (lowerName === 'glob') {
    return '**/*.ts';
  }

  // 内容相关
  if (lowerName === 'content' || lowerName === 'text' || lowerName === 'newstring') {
    return 'new content';
  }
  if (lowerName === 'oldstring') {
    return 'old content';
  }

  // 布尔值
  if (lowerName.includes('is') || lowerName.includes('has')) {
    return true;
  }
  if (lowerName === 'silent' || lowerName === 'recursive') {
    return true;
  }

  // 数字
  if (lowerName.includes('limit') || lowerName.includes('max') || lowerName.includes('count')) {
    return 10;
  }
  if (lowerName.includes('offset') || lowerName.includes('start')) {
    return 0;
  }

  // 默认返回字符串
  return 'value';
}

/**
 * 格式化工具执行错误
 */
export function formatToolExecutionError(
  toolId: string,
  error: Error | string
): string {
  const errorMessage = typeof error === 'string' ? error : error.message;

  // 分类错误类型
  if (errorMessage.includes('not found')) {
    return `❌ 工具 "${toolId}" 执行失败: 文件或目录不存在\n\n💡 提示: 请检查路径是否正确`;
  }

  if (errorMessage.includes('permission denied') || errorMessage.includes('EACCES')) {
    return `❌ 工具 "${toolId}" 执行失败: 权限不足\n\n💡 提示: 请检查文件权限或使用 sudo`;
  }

  if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
    return `❌ 工具 "${toolId}" 执行超时\n\n💡 提示: 操作耗时过长，已自动终止`;
  }

  if (errorMessage.includes('ENOENT')) {
    return `❌ 工具 "${toolId}" 执行失败: 找不到文件或目录\n\n💡 提示: 请确认路径拼写正确`;
  }

  // 默认错误消息
  return `❌ 工具 "${toolId}" 执行失败\n\n📝 错误详情: ${errorMessage}`;
}

/**
 * 创建工具使用提示
 */
export function createToolUsageHint(
  toolId: string,
  parameters: z.ZodType,
  description: string
): string {
  return `
🔧 工具使用指南: ${toolId}

📝 描述:
${description.split('\n')[0]}

📋 参数:
${getParameterList(parameters)}

💡 使用示例:
${generateParameterExample(toolId, parameters, [])}
`;
}

/**
 * 获取参数列表
 */
function getParameterList(parameters: z.ZodType): string {
  try {
    const schema = parameters as z.ZodObject<any>;
    const shape = schema.shape;

    return Object.entries(shape)
      .map(([name, def]: [string, any]) => {
        const required = !def.isOptional();
        const description = def.describe?.() || '';
        const mark = required ? '✓' : '○';
        return `   ${mark} ${name}: ${description}`;
      })
      .join('\n');
  } catch (error) {
    return '   (参数列表获取失败)';
  }
}
