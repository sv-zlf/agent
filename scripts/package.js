#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const packageJson = require(path.join(rootDir, 'package.json'));

// 读取版本号
const version = packageJson.version;
const name = packageJson.name;

// 创建输出目录
const outputDir = path.join(rootDir, 'release');
fs.ensureDirSync(outputDir);

// 创建临时打包目录
const tempDir = path.join(rootDir, 'release', `${name}-v${version}`);
fs.removeSync(tempDir);
fs.ensureDirSync(tempDir);

console.log(`📦 打包 ${name} v${version}...`);

// 需要包含的文件和目录
const includeFiles = [
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  '.npmrc',
  'tsconfig.json',
];

const includeDirs = [
  'src',
  'bin',
  'prompts',
  'docs',
  'scripts',
  'config',
];

// 需要排除的文件和目录（glob 模式）
const excludePatterns = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/backups/**',
  '**/temp/**',
  '**/.git/**',
  '**/.idea/**',
  '**/.claude/**',
  '**/*.log',
  '**/.env',
  '**/.env.*',
  '**/.DS_Store',
  '**/*.tsbuildinfo',
];

// 复制文件
console.log('📄 复制文件...');
for (const file of includeFiles) {
  const src = path.join(rootDir, file);
  const dest = path.join(tempDir, file);
  if (fs.existsSync(src)) {
    fs.copySync(src, dest);
    console.log(`  ✓ ${file}`);
  }
}

// 复制目录
console.log('📁 复制目录...');
for (const dir of includeDirs) {
  const src = path.join(rootDir, dir);
  const dest = path.join(tempDir, dir);
  if (fs.existsSync(src)) {
    fs.copySync(src, dest, {
      filter: (srcPath) => {
        const relativePath = path.relative(rootDir, srcPath);

        // 检查是否匹配排除模式
        for (const pattern of excludePatterns) {
          const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
          if (regex.test(relativePath)) {
            return false;
          }
        }
        return true;
      }
    });
    console.log(`  ✓ ${dir}/`);
  }
}

// 创建 .gitignore 文件（如果不存在）
const gitignoreContent = `node_modules/
dist/
coverage/
backups/
*.log
.env
.DS_Store
*.tsbuildinfo
`;
fs.writeFileSync(path.join(tempDir, '.gitignore'), gitignoreContent);

// 创建 ZIP 文件
console.log('\n🗜️  创建 ZIP 文件...');
const zipPath = path.join(outputDir, `${name}-v${version}.zip`);
const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', {
  zlib: { level: 9 } // 最高压缩级别
});

output.on('close', () => {
  const sizeInMB = (archive.pointer() / 1024 / 1024).toFixed(2);
  console.log(`\n✅ 打包完成!`);
  console.log(`📦 文件: ${zipPath}`);
  console.log(`📊 大小: ${sizeInMB} MB`);
  console.log(`\n临时目录: ${tempDir}`);
  console.log('(可以手动删除临时目录)');

  // 清理临时目录
  console.log('\n是否删除临时目录? (y/n)');
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data) => {
    if (data.toString().trim().toLowerCase() === 'y') {
      fs.removeSync(tempDir);
      console.log('✓ 临时目录已删除');
    }
    process.exit(0);
  });
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(tempDir, false);
archive.finalize();
