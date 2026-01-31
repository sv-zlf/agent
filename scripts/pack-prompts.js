#!/usr/bin/env node

/**
 * GG CODE - 提示词打包脚本
 * 在构建时将所有提示词文件打包成 JavaScript 模块
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const outputFile = path.join(rootDir, 'src', 'utils', 'packed-prompts.ts');

console.log('🔖 打包提示词文件...');

// 读取项目级提示词（src/prompts）
const projectPrompts = {};
const projectPromptsDir = path.join(rootDir, 'src', 'prompts');
if (fs.existsSync(projectPromptsDir)) {
  const items = fs.readdirSync(projectPromptsDir);
  for (const item of items) {
    const itemPath = path.join(projectPromptsDir, item);
    if (fs.statSync(itemPath).isFile() && item.endsWith('.txt')) {
      const key = item.replace('.txt', '');
      const content = fs.readFileSync(itemPath, 'utf-8');
      projectPrompts[key] = content;
      console.log(`  ✓ project/${key}`);
    }
  }
}

// 读取工具级提示词（src/tools/prompts）
const toolPrompts = {};
const toolsDir = path.join(rootDir, 'src', 'tools', 'prompts');
if (fs.existsSync(toolsDir)) {
  const toolFiles = fs.readdirSync(toolsDir);
  for (const toolFile of toolFiles) {
    if (toolFile.endsWith('.txt')) {
      const toolKey = toolFile.replace('.txt', '');
      const content = fs.readFileSync(path.join(toolsDir, toolFile), 'utf-8');
      toolPrompts[toolKey] = content;
      console.log(`  ✓ tool/${toolKey}`);
    }
  }
}

// 生成 TypeScript 代码
const content = `/**
 * GG CODE - 打包的提示词
 * 此文件由构建脚本自动生成，请勿手动修改
 */

export const PACKED_PROMPTS: {
  tools: Record<string, string>;
  project: Record<string, string>;
} = {
  // 工具提示词
  tools: ${JSON.stringify(toolPrompts, null, 2)},
  
  // 项目级提示词
  project: ${JSON.stringify(projectPrompts, null, 2)}
};

/**
 * 获取工具提示词
 */
export function getToolPrompt(toolId: string): string {
  return PACKED_PROMPTS.tools[toolId] || '';
}

/**
 * 获取项目提示词
 */
export function getProjectPrompt(name: string): string {
  return PACKED_PROMPTS.project[name] || '';
}

/**
 * 检查是否有打包的提示词
 */
export function hasPackedPrompts(): boolean {
  return Object.keys(PACKED_PROMPTS.tools).length > 0 || Object.keys(PACKED_PROMPTS.project).length > 0;
}
`;

// 写入文件
fs.writeFileSync(outputFile, content);
console.log(`\n✅ 提示词已打包到: ${outputFile}`);
console.log(`📊 工具提示词: ${Object.keys(toolPrompts).length} 个`);
console.log(`📊 项目提示词: ${Object.keys(projectPrompts).length} 个`);
