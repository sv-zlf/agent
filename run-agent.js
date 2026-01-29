#!/usr/bin/env node

/**
 * GG CODE 启动脚本
 * 统一的跨平台启动方式
 * 默认启动 agent 模式
 */

const { spawn } = require('child_process');

// 默认使用 agent 模式
const args = ['agent', ...process.argv.slice(2)];

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
  console.error('\n请确保已安装依赖: npm install');
  process.exit(1);
});
