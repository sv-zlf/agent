#!/usr/bin/env node

/**
 * 简化的启动脚本
 * 直接调用 ts-node，避免所有平台兼容性问题
 */

const { spawn } = require('child_process');
const os = require('os');

const args = process.argv.slice(2);
const isWindows = os.platform() === 'win32';

console.log('🚀 Starting GG CODE...\n');

if (isWindows) {
  console.log('💡 检测到 Windows 系统...\n');

  // Windows: 使用 npx ts-node 执行
  console.log('📝 启动命令: npx ts-node src/index.ts', ...args, '\n');

  const child = spawn('npx', ['ts-node', 'src/index.ts', ...args], {
    stdio: 'inherit',
    env: { ...process.env },
    shell: true,
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });

  child.on('error', (err) => {
    console.error('❌ 启动失败:', err.message);
    console.error('\n请尝试直接运行: npx ts-node src/index.ts agent');
    process.exit(1);
  });

} else {
  // 非 Windows 系统：使用 npx ts-node
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
}
