/**
 * GG CODE - 工具提示词加载器
 * 从 src/tools/prompts/tools/ 目录加载工具的详细使用说明
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 工具提示词缓存
 */
const promptCache = new Map<string, string>();

/**
 * 获取工具提示词文件路径（相对于 __dirname）
 */
function getToolPromptPath(toolId: string): string {
  return path.join(__dirname, '../tools/prompts/tools', `${toolId}.txt`);
}

/**
 * 加载工具提示词
 * @param toolId 工具ID (如 'read', 'write', 'edit')
 * @returns 工具的详细使用说明文本，如果文件不存在则返回空字符串
 */
export async function loadToolPrompt(toolId: string): Promise<string> {
  // 检查缓存
  if (promptCache.has(toolId)) {
    return promptCache.get(toolId)!;
  }

  try {
    const promptPath = getToolPromptPath(toolId);
    const content = await fs.readFile(promptPath, 'utf-8');

    // 缓存结果
    promptCache.set(toolId, content);
    return content;
  } catch (error) {
    // 文件不存在或读取失败，返回空字符串
    return '';
  }
}

/**
 * 清除提示词缓存
 * 用于开发时热重载
 */
export function clearPromptCache(): void {
  promptCache.clear();
}

/**
 * 批量加载多个工具的提示词
 */
export async function loadToolPrompts(toolIds: string[]): Promise<Record<string, string>> {
  const prompts: Record<string, string> = {};

  await Promise.all(
    toolIds.map(async (toolId) => {
      prompts[toolId] = await loadToolPrompt(toolId);
    })
  );

  return prompts;
}

/**
 * 检查工具提示词文件是否存在
 */
export async function hasToolPrompt(toolId: string): Promise<boolean> {
  try {
    const promptPath = getToolPromptPath(toolId);
    await fs.access(promptPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取工具提示词文件的修改时间
 * 用于判断缓存是否过期
 */
export async function getPromptModTime(toolId: string): Promise<Date | null> {
  try {
    const promptPath = getToolPromptPath(toolId);
    const stats = await fs.stat(promptPath);
    return stats.mtime;
  } catch {
    return null;
  }
}
