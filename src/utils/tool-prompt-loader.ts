/**
 * GG CODE - 工具提示词加载器
 * 从 src/prompts/_tools/ 目录加载工具的详细使用说明
 * 优先文件系统，打包提示词作为生产环境回退
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getToolPrompt, hasPackedPrompts } from './packed-prompts';

const promptCache = new Map<string, string>();

function getToolPromptPath(toolId: string): string {
  return path.join(__dirname, '../prompts/_tools', `${toolId}.txt`);
}

export async function loadToolPrompt(toolId: string): Promise<string> {
  if (promptCache.has(toolId)) {
    return promptCache.get(toolId)!;
  }

  // 优先从文件系统加载（开发环境）
  const promptPath = getToolPromptPath(toolId);
  try {
    const content = await fs.readFile(promptPath, 'utf-8');
    promptCache.set(toolId, content);
    return content;
  } catch {
    // 回退到打包提示词（生产环境）
    if (hasPackedPrompts()) {
      const packedPrompt = getToolPrompt(toolId);
      if (packedPrompt) {
        promptCache.set(toolId, packedPrompt);
        return packedPrompt;
      }
    }
    return '';
  }
}

export function clearPromptCache(): void {
  promptCache.clear();
}

export async function loadToolPrompts(toolIds: string[]): Promise<Record<string, string>> {
  const prompts: Record<string, string> = {};
  await Promise.all(
    toolIds.map(async (toolId) => {
      prompts[toolId] = await loadToolPrompt(toolId);
    })
  );
  return prompts;
}

export async function hasToolPrompt(toolId: string): Promise<boolean> {
  // 检查文件系统
  try {
    const promptPath = getToolPromptPath(toolId);
    await fs.access(promptPath);
    return true;
  } catch {
    // 回退到打包提示词
    return hasPackedPrompts() && !!getToolPrompt(toolId);
  }
}

export async function getPromptModTime(toolId: string): Promise<Date | null> {
  // 检查文件系统
  try {
    const promptPath = getToolPromptPath(toolId);
    const stats = await fs.stat(promptPath);
    return stats.mtime;
  } catch {
    // 打包提示词返回当前时间
    return hasPackedPrompts() && getToolPrompt(toolId) ? new Date() : null;
  }
}
