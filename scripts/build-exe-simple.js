#!/usr/bin/env node

/**
 * GG CODE - EXE 打包脚本 (简化版)
 * 使用 pkg 将项目打包成独立的可执行文件
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const packageJson = require(path.join(rootDir, 'package.json'));

const version = packageJson.version;
const name = packageJson.name;

console.log(`🚀 开始打包 ${name} v${version} 为可执行文件...\n`);

// 检查 pkg 是否已安装
let pkgInstalled = false;
try {
  require.resolve('pkg');
  pkgInstalled = true;
  console.log('✓ pkg 已安装\n');
} catch (e) {
  console.log('⚠️  pkg 未安装，正在安装...\n');
}

if (!pkgInstalled) {
  try {
    console.log('运行: npm install --save-dev pkg');
    execSync('npm install --save-dev pkg', { cwd: rootDir, stdio: 'inherit' });
    console.log('\n✓ pkg 安装完成\n');
  } catch (e) {
    console.error('\n❌ pkg 安装失败');
    console.log('请手动运行: npm install --save-dev pkg');
    process.exit(1);
  }
}

// 清理并创建输出目录
const outputDir = path.join(rootDir, 'dist-exe');
if (fs.existsSync(outputDir)) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  console.log('✓ 清理旧的输出目录');
}
fs.mkdirSync(outputDir, { recursive: true });

// 确保项目已编译
console.log('\n📦 编译 TypeScript...');
try {
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
  console.log('✓ 编译完成\n');
} catch (e) {
  console.error('❌ 编译失败');
  process.exit(1);
}

// 构建 pkg 命令
console.log('🔨 使用 pkg 打包...\n');

const inputFile = path.join(rootDir, 'dist', 'index.js');
const outputFile = path.join(outputDir, `${name}-win.exe`);

// Windows 目标
const target = 'node16-win-x64';

try {
  const pkgCmd = `npx pkg ${inputFile} --target ${target} --output ${outputFile}`;
  console.log(`运行: ${pkgCmd}\n`);

  execSync(pkgCmd, { cwd: rootDir, stdio: 'inherit' });

  console.log('\n✅ Windows 可执行文件打包完成!\n');

} catch (error) {
  console.error('\n❌ 打包失败:', error.message);
  process.exit(1);
}

// 复制必要的资源文件
console.log('📄 复制资源文件...\n');

// 创建资源目录
const resourcesDir = path.join(outputDir, 'resources');
fs.mkdirSync(resourcesDir, { recursive: true });

// 复制 prompts 目录
const promptsDir = path.join(rootDir, 'prompts');
if (fs.existsSync(promptsDir)) {
  const promptsDest = path.join(resourcesDir, 'prompts');
  fs.mkdirSync(promptsDest, { recursive: true });

  const promptsFiles = fs.readdirSync(promptsDir);
  promptsFiles.forEach(file => {
    const srcPath = path.join(promptsDir, file);
    const destPath = path.join(promptsDest, file);
    if (fs.statSync(srcPath).isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  });
  console.log('  ✓ prompts/');
}

// 复制配置示例
const configDir = path.join(rootDir, 'config');
if (fs.existsSync(configDir)) {
  const configDest = path.join(resourcesDir, 'config');
  fs.mkdirSync(configDest, { recursive: true });

  const configFiles = fs.readdirSync(configDir);
  configFiles.forEach(file => {
    if (file.endsWith('.example.yaml') || file.endsWith('.example.json')) {
      fs.copyFileSync(
        path.join(configDir, file),
        path.join(configDest, file)
      );
      console.log(`  ✓ config/${file}`);
    }
  });
}

// 创建使用说明
const readmeContent = `# GG CODE v${version} - Windows 可执行文件

## 使用说明

### 直接运行
双击 \`gg-code-win.exe\` 或在命令行中运行：
\`\`\`
gg-code-win.exe
\`\`\`

### 常用命令
\`\`\`
# 启动 AI 编程助手
gg-code-win.exe agent

# 查看配置
gg-code-win.exe config show

# 查看帮助
gg-code-win.exe --help
\`\`\`

### 配置文件
配置文件位于用户主目录下的 \`.ggcode/config.yaml\`

首次运行会自动创建配置文件模板。

### 无需 Node.js
本可执行文件已内置 Node.js 运行时，无需单独安装。

## 版本信息
- 版本: ${version}
- 构建时间: ${new Date().toLocaleString('zh-CN')}
- 平台: Windows x64

## 许可证
MIT License

## 技术支持
如有问题，请访问项目主页或提交 Issue。
`;

fs.writeFileSync(path.join(outputDir, 'README.txt'), readmeContent);
console.log('  ✓ README.txt');

// 获取文件大小
if (fs.existsSync(outputFile)) {
  const stats = fs.statSync(outputFile);
  const sizeInMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`\n📊 可执行文件大小: ${sizeInMB} MB`);
}

console.log(`\n📁 输出目录: ${outputDir}`);
console.log('\n✅ 打包完成!\n');
console.log('💡 提示:');
console.log('  - 可执行文件已包含 Node.js 运行时');
console.log('  - 双击 .exe 文件即可运行');
console.log('  - prompts/ 目录包含 AI 提示词模板');
console.log('  - 首次运行会创建配置文件');
