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

// 读取工具级提示词（src/prompts/_tools）
const toolPrompts = {};
const toolsDir = path.join(rootDir, 'src', 'prompts', '_tools');
if (fs.existsSync(toolsDir)) {
  const toolFiles = fs.readdirSync(toolsDir);
  for (const toolFile of toolFiles) {
    if (toolFile.endsWith('.txt')) {
      const toolKey = toolFile.replace('.txt', '');
      const content = fs.readFileSync(path.join(toolsDir, toolFile), 'utf-8');
      toolPrompts[toolKey] = content;
      console.log(`  ✓ tools/${toolKey}`);
    }
  }
}

// 读取项目级提示词（src/prompts 下除 _tools 和 _base 外的 txt 文件）
const projectPrompts = {};
const projectDirs = ['agents', 'system'];
for (const dir of projectDirs) {
  const dirPath = path.join(rootDir, 'src', 'prompts', dir);
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (file.endsWith('.txt')) {
        const key = `${dir}/${file.replace('.txt', '')}`;
        const content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
        projectPrompts[key] = content;
        console.log(`  ✓ project/${key}`);
      }
    }
  }
}

// 读取基础组件提示词（_base 目录）
const baseDir = path.join(rootDir, 'src', 'prompts', '_base');
if (fs.existsSync(baseDir)) {
  const files = fs.readdirSync(baseDir);
  for (const file of files) {
    if (file.endsWith('.txt')) {
      const key = `_base/${file.replace('.txt', '')}`;
      const content = fs.readFileSync(path.join(baseDir, file), 'utf-8');
      projectPrompts[key] = content;
      console.log(`  ✓ project/${key}`);
    }
  }
}

// 读取根目录的提示词文件（default.txt 等）
const rootPromptFiles = ['default.txt'];
for (const file of rootPromptFiles) {
  const filePath = path.join(rootDir, 'src', 'prompts', file);
  if (fs.existsSync(filePath)) {
    const key = file.replace('.txt', '');
    const content = fs.readFileSync(filePath, 'utf-8');
    projectPrompts[key] = content;
    console.log(`  ✓ project/${key}`);
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
