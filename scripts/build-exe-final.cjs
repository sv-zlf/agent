#!/usr/bin/env node

/**
 * GG CODE - 独立 EXE 打包脚本
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const { exec } = require('child_process');

const NODE_VERSION = '18.19.1';

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const packageJson = require(path.join(rootDir, 'package.json'));
  const version = packageJson.version;
  const name = packageJson.name;

  console.log('🚀 开始打包 ' + name + ' v' + version + ' 为独立 EXE...\n');

  // 确保项目已编译
  console.log('📦 编译 TypeScript...');
  try {
    execSync('npm run build', { cwd: rootDir, encoding: 'utf8' });
    console.log('✓ 编译完成\n');
  } catch (error) {
    console.error('❌ 编译失败');
    process.exit(1);
  }

  // 创建临时目录
  const tempDir = path.join(rootDir, 'dist-exe-final');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  // 下载 Node.js
  const nodeZipPath = path.join(tempDir, 'node.zip');
  const nodeUrl =
    'https://nodejs.org/dist/v' + NODE_VERSION + '/node-v' + NODE_VERSION + '-win-x64.zip';

  console.log('⬇️  下载 Node.js ' + NODE_VERSION + '...');
  await downloadFile(nodeUrl, nodeZipPath);
  console.log('✓ 下载完成: ' + (fs.statSync(nodeZipPath).size / 1024 / 1024).toFixed(2) + ' MB\n');

  // 解压
  console.log('📦 解压 Node.js...');
  execSync('unzip -o "' + nodeZipPath + '" -d "' + tempDir + '"', { stdio: 'pipe' });
  fs.unlinkSync(nodeZipPath);
  console.log('✓ 解压完成\n');

  // 找到解压后的目录
  const nodeDir = fs.readdirSync(tempDir).find((d) => d.startsWith('node-'));
  if (!nodeDir) {
    console.error('❌ 未找到 Node.js 目录');
    process.exit(1);
  }
  const appDir = path.join(tempDir, nodeDir);
  console.log('✓ Node.js 目录: ' + nodeDir + '\n');

  // 复制应用文件
  console.log('📁 复制应用文件...');
  copyDir(path.join(rootDir, 'dist'), path.join(appDir, 'dist'));

  // 复制 package.json (精简版)
  const newPackageJson = { ...packageJson };
  delete newPackageJson.devDependencies;
  delete newPackageJson.scripts;
  delete newPackageJson.bin;
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(newPackageJson, null, 2));
  console.log('✓ 应用文件已复制\n');

  // 创建启动批处理
  console.log('📝 创建启动脚本...');
  const launchBatch =
    '@echo off\nchcp 65001 >nul\ntitle GG CODE v' +
    version +
    '\n' +
    'echo =========================================\n' +
    'echo    GG CODE v' +
    version +
    ' - AI 编程助手\n' +
    'echo =========================================\n' +
    'echo.\n' +
    'cd /d "%~dp0' +
    nodeDir +
    '"\n' +
    'node dist\\index.js %*\n' +
    'pause\n';
  fs.writeFileSync(path.join(tempDir, 'launch.bat'), launchBatch, 'utf-8');

  // 计算文件大小
  let totalSize = 0;
  const files = [];
  function calculateSize(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        calculateSize(fullPath);
      } else {
        const stats = fs.statSync(fullPath);
        totalSize += stats.size;
        files.push({ name: path.relative(appDir, fullPath), size: stats.size });
      }
    }
  }
  calculateSize(appDir);

  function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  console.log('✅ 打包完成!\n');
  console.log('📁 输出目录: ' + tempDir);
  console.log('📊 总大小: ' + formatSize(totalSize));
  console.log('\n💡 使用方法:');
  console.log('   1. 将整个文件夹分发给用户');
  console.log('   2. 用户双击运行 launch.bat');
  console.log('\n📦 文件列表 (前10个):');
  files.slice(0, 10).forEach((f) => {
    console.log('   ' + f.name + ' (' + formatSize(f.size) + ')');
  });
  if (files.length > 10) {
    console.log('   ... 还有 ' + (files.length - 10) + ' 个文件');
  }
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          downloadFile(response.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        const file = fs.createWriteStream(dest);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        try {
          fs.unlinkSync(dest);
        } catch {}
        reject(err);
      });
  });
}

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

main().catch((err) => {
  console.error('打包失败:', err);
  process.exit(1);
});
