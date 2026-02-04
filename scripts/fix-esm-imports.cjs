#!/usr/bin/env node
/**
 * 修复 ESM 导入路径，为相对导入添加 .js 扩展名
 * 对于 barrel exports（如 '../core'），添加 '/index.js'
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');

// 检查是否是 barrel export（是否有 index.ts 或 index.js）
function isBarrelExport(resolvedPath) {
  return fs.existsSync(path.join(resolvedPath, 'index.ts')) ||
         fs.existsSync(path.join(resolvedPath, 'index.js'));
}

// 检查是否是文件（不需要添加 .js，因为已经有扩展名了）
function isFile(resolvedPath) {
  return fs.existsSync(resolvedPath + '.ts') ||
         fs.existsSync(resolvedPath + '.js') ||
         fs.existsSync(resolvedPath);
}

function fixImportsInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const fileDir = path.dirname(filePath);

  // 匹配所有相对导入，包括 export * from 语法
  // 模式：import/export ... from '...'
  content = content.replace(
    /(\s*(?:import|export)(?:(?:\s+type)?(?:\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)|(?:\s+\*\s+from\s+)))'(\.\.?\/[^']+)'/g,
    (match, prefix, importPath) => {
      // 如果已经有扩展名，不处理
      if (importPath.endsWith('.js') || importPath.endsWith('.ts') || importPath.endsWith('.json')) {
        return match;
      }

      // 解析导入路径的绝对路径
      const resolvedPath = path.resolve(fileDir, importPath);

      // 如果是 barrel export（有 index.ts/index.js）
      if (isBarrelExport(resolvedPath)) {
        return `${prefix}'${importPath}/index.js'`;
      }

      // 如果是文件，添加 .js
      if (isFile(resolvedPath + '.ts') || isFile(resolvedPath + '.js')) {
        return `${prefix}'${importPath}.js'`;
      }

      // 否则保持原样（可能是 node_modules）
      return match;
    }
  );

  fs.writeFileSync(filePath, content, 'utf-8');
}

function walkDir(dir, callback) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // 跳过 node_modules 和 dist
      if (file !== 'node_modules' && file !== 'dist' && file !== '.git') {
        walkDir(filePath, callback);
      }
    } else if (file.endsWith('.ts')) {
      callback(filePath);
    }
  }
}

console.log('修复 ESM 导入路径...');
let count = 0;

walkDir(srcDir, (filePath) => {
  try {
    fixImportsInFile(filePath);
    count++;
  } catch (error) {
    console.error(`处理文件失败: ${filePath}`, error.message);
  }
});

console.log(`✓ 已处理 ${count} 个文件`);
