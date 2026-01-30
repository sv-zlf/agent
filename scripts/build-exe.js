#!/usr/bin/env node

/**
 * GG CODE - EXE 打包脚本
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
try {
  require.resolve('pkg');
} catch (e) {
  console.error('❌ pkg 未安装！');
  console.log('请运行: npm install --save-dev pkg');
  process.exit(1);
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
  console.log('✓ 编译完成');
} catch (e) {
  console.error('❌ 编译失败');
  process.exit(1);
}

// 确保 prompts 目录存在
const promptsDir = path.join(rootDir, 'prompts');
if (!fs.existsSync(promptsDir)) {
  console.error('❌ prompts 目录不存在！');
  process.exit(1);
}

// 使用 pkg 打包
console.log('\n🔨 使用 pkg 打包...');

const pkg = require('pkg');

// pkg 配置
const pkgConfig = {
  targets: [
    'node16-win-x64',      // Windows 64位
    'node16-linux-x64',    // Linux 64位
    'node16-macos-x64',    // macOS Intel
  ],
  output: path.join(outputDir, name), // 输出文件名（不含扩展名）
  input: path.join(rootDir, 'dist', 'index.js'),
};

// 执行打包
async function build() {
  try {
    await pkg.exec([pkgConfig.input, '--target', pkgConfig.targets[0], '--output', `${pkgConfig.output}-win.exe`]);
    console.log('✓ Windows 可执行文件已生成');

    // 如果需要其他平台
    // await pkg.exec([pkgConfig.input, '--target', pkgConfig.targets[1], '--output', `${pkgConfig.output}-linux`]);
    // console.log('✓ Linux 可执行文件已生成');

    // await pkg.exec([pkgConfig.input, '--target', pkgConfig.targets[2], '--output', `${pkgConfig.output}-macos`]);
    // console.log('✓ macOS 可执行文件已生成');

  } catch (error) {
    console.error('❌ 打包失败:', error.message);
    process.exit(1);
  }
}

build().then(() => {
  console.log('\n✅ 打包完成!\n');

  // 复制必要的资源文件
  console.log('📄 复制资源文件...');

  // 创建资源目录
  const resourcesDir = path.join(outputDir, 'resources');
  fs.mkdirSync(resourcesDir, { recursive: true });

  // 复制 prompts 目录
  const promptsDest = path.join(resourcesDir, 'prompts');
  fs.mkdirSync(promptsDest, { recursive: true });
  const promptsFiles = fs.readdirSync(promptsDir);
  promptsFiles.forEach(file => {
    fs.copyFileSync(
      path.join(promptsDir, file),
      path.join(promptsDest, file)
    );
  });
  console.log('  ✓ prompts/');

  // 复制配置示例
  const configExample = path.join(rootDir, 'config', 'config.example.yaml');
  if (fs.existsSync(configExample)) {
    fs.mkdirSync(path.join(resourcesDir, 'config'), { recursive: true });
    fs.copyFileSync(configExample, path.join(resourcesDir, 'config', 'config.example.yaml'));
    console.log('  ✓ config/config.example.yaml');
  }

  // 创建使用说明
  const readmeContent = `# GG CODE v${version} - 可执行文件

## 使用说明

### Windows
直接运行 \`gg-code-win.exe\`

### 配置文件
配置文件位于用户主目录下的 \`.ggcode/config.yaml\`

首次运行会自动创建配置文件。

### 资源文件
程序需要的资源文件已包含在可执行文件中。

## 版本信息
- 版本: ${version}
- 构建时间: ${new Date().toLocaleString('zh-CN')}

## 许可证
MIT License
`;

  fs.writeFileSync(path.join(outputDir, 'README.txt'), readmeContent);
  console.log('  ✓ README.txt');

  // 获取文件大小
  const exePath = path.join(outputDir, `${name}-win.exe`);
  if (fs.existsSync(exePath)) {
    const stats = fs.statSync(exePath);
    const sizeInMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`\n📊 Windows 可执行文件大小: ${sizeInMB} MB`);
  }

  console.log(`\n📁 输出目录: ${outputDir}`);
  console.log('\n💡 提示: 可以直接运行 .exe 文件，无需安装 Node.js');

}).catch(error => {
  console.error('❌ 打包过程出错:', error);
  process.exit(1);
});
