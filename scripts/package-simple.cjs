#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const rootDir = path.resolve(__dirname, '..');
const packageJson = require(path.join(rootDir, 'package.json'));

// 读取版本号
const version = packageJson.version;
const name = packageJson.name;

// 创建输出目录
const outputDir = path.join(rootDir, 'release');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 创建临时打包目录
const tempDir = path.join(rootDir, 'release', `${name}-v${version}`);
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(tempDir, { recursive: true });

console.log(`📦 打包 ${name} v${version}...`);

// 需要包含的文件和目录
const includeFiles = [
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'tsconfig.json',
];

const includeDirs = [
  'src',
  'bin',
  'prompts',
  'docs',
  'config',
];

// 需要排除的目录
const excludeDirs = [
  'node_modules',
  'dist',
  'coverage',
  'backups',
  'temp',
  '.git',
  '.idea',
  '.claude',
];

// 需要排除的文件
const excludeFiles = [
  '.env',
  '.DS_Store',
  '*.log',
  '*.tsbuildinfo',
];

// 递归复制目录
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;

  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // 跳过排除的目录
    if (entry.isDirectory() && excludeDirs.includes(entry.name)) {
      continue;
    }

    // 跳过排除的文件
    if (entry.isFile()) {
      const shouldExclude = excludeFiles.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(entry.name);
        }
        return entry.name === pattern;
      });
      if (shouldExclude) continue;
    }

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 复制文件
console.log('📄 复制文件...');
for (const file of includeFiles) {
  const src = path.join(rootDir, file);
  const dest = path.join(tempDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`  ✓ ${file}`);
  }
}

// 复制目录
console.log('📁 复制目录...');
for (const dir of includeDirs) {
  const src = path.join(rootDir, dir);
  const dest = path.join(tempDir, dir);
  if (fs.existsSync(src)) {
    copyDir(src, dest);
    console.log(`  ✓ ${dir}/`);
  }
}

// 创建 .gitignore 文件
const gitignoreContent = `node_modules/
dist/
coverage/
backups/
*.log
.env
.DS_Store
*.tsbuildinfo
temp/
`;
fs.writeFileSync(path.join(tempDir, '.gitignore'), gitignoreContent);

// 创建 ZIP 文件
console.log('\n🗜️  创建 ZIP 文件...');

let zipCommand;
if (os.platform() === 'win32') {
  // Windows 使用 PowerShell
  const tempDirWin = tempDir.replace(/\\/g, '\\\\');
  const outputDirWin = outputDir.replace(/\\/g, '\\\\');
  zipCommand = `powershell -Command "Compress-Archive -Path '${tempDirWin}\\*' -DestinationPath '${outputDirWin}\\${name}-v${version}.zip' -Force"`;
} else {
  // Linux/Mac 使用 zip 命令
  zipCommand = `cd "${tempDir}" && zip -r "${outputDir}/${name}-v${version}.zip" .`;
}

try {
  execSync(zipCommand, { stdio: 'inherit' });

  // 获取文件大小
  const zipPath = path.join(outputDir, `${name}-v${version}.zip`);
  const stats = fs.statSync(zipPath);
  const sizeInMB = (stats.size / 1024 / 1024).toFixed(2);

  console.log(`\n✅ 打包完成!`);
  console.log(`📦 文件: ${zipPath}`);
  console.log(`📊 大小: ${sizeInMB} MB`);
  console.log(`\n💡 提示: 运行以下命令清理临时目录`);
  console.log(`   rm -rf "${tempDir}"`);

} catch (error) {
  console.error('❌ 打包失败:', error.message);
  console.log('\n💡 提示: 请手动压缩以下目录:');
  console.log(`   ${tempDir}`);
  process.exit(1);
}
