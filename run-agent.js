#!/usr/bin/env node

/**
 * GG CODE 启动脚本
 * 统一的跨平台启动方式
 */

const { spawn } = require('child_process');

const args = process.argv.slice(2);

// 启动 GG CODE
const child = spawn('npx', ['ts-node', 'src/index.ts', ...args], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env }
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error('❌ 启动失败:', err.message);
  console.error('\n请尝试直接运行: npx ts-node src/index.ts agent');
  process.exit(1);
});
