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
const outputDir = path.join(__dirname, '..', 'dist-exe');
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
  promptsFiles.forEach((file) => {
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
  configFiles.forEach((file) => {
    if (file.endsWith('.example.yaml') || file.endsWith('.example.json')) {
      fs.copyFileSync(path.join(configDir, file), path.join(configDest, file));
      console.log(`  ✓ config/${file}`);
    }
  });
}

// 生成安装脚本
console.log('\n📝 生成安装脚本...');
const installScriptContent = `@echo off
chcp 65001 >nul
echo =========================================
echo    GG CODE v${version} - 安装向导
echo =========================================
echo.

:: 获取脚本所在目录
set "SCRIPT_DIR=%~dp0"
set "EXE_FILE=%SCRIPT_DIR%${name}-win.exe"
set "INSTALL_DIR=%USERPROFILE%\\.ggcode"

:: 检查 exe 文件是否存在
if not exist "%EXE_FILE%" (
    echo [错误] 找不到 ${name}-win.exe 文件
    echo 请确保 install.bat 和 ${name}-win.exe 在同一目录下
    echo.
    pause
    exit /b 1
)

echo [1/4] 创建安装目录...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%INSTALL_DIR%\\bin" mkdir "%INSTALL_DIR%\\bin"
if not exist "%INSTALL_DIR%\\resources" mkdir "%INSTALL_DIR%\\resources"
echo       ✓ 安装目录: %INSTALL_DIR%

echo.
echo [2/4] 复制可执行文件...
copy /Y "%EXE_FILE%" "%INSTALL_DIR%\\bin\\ggcode.exe" >nul
echo       ✓ 可执行文件已复制

echo.
echo [3/4] 复制资源文件...
if exist "%SCRIPT_DIR%resources" (
    xcopy /E /I /Y "%SCRIPT_DIR%resources" "%INSTALL_DIR%\\resources" >nul
    echo       ✓ 资源文件已复制
) else (
    echo       ⚠ 未找到 resources 目录，跳过
)

echo.
echo [4/4] 添加到系统 PATH...
set "PATH_ADD=%INSTALL_DIR%\\bin"

:: 检查是否已在 PATH 中
for /f "tokens=2 delims==" %%A in ('"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command "\$env:PATH -split ';' | Select-String -Pattern '^%PATH_ADD%$' -Quiet"') do (
    set IN_PATH=%%A
)

if "%IN_PATH%"=="True" (
    echo       ✓ ggcode 已在 PATH 中，跳过添加
    goto :CREATE_SHORTCUT
)

:: 使用 PowerShell 添加到用户 PATH
"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command "\$oldPath = [Environment]::GetEnvironmentVariable('Path', 'User'); if (\$oldPath -notlike '*%PATH_ADD%*') { [Environment]::SetEnvironmentVariable('Path', \$oldPath + ';%PATH_ADD%', 'User'); Write-Host '       ✓ 已添加到用户 PATH'; } else { Write-Host '       ✓ 已在 PATH 中'; }"

:CREATE_SHORTCUT
echo.
echo [完成] 安装成功！
echo.
echo =========================================
echo 使用方法:
echo =========================================
echo.
echo 1. 关闭当前终端窗口，重新打开一个新的终端
echo.
echo 2. 在任何目录下输入以下命令启动:
echo.
echo    ggcode
echo.
echo 3. 查看帮助:
echo.
echo    ggcode --help
echo.
echo =========================================
echo 安装信息:
echo =========================================
echo   安装目录: %INSTALL_DIR%
echo   可执行文件: %INSTALL_DIR%\\bin\\ggcode.exe
echo   版本: ${version}
echo.
echo 💡 提示: 如果 ggcode 命令无法使用，请重启电脑或手动添加以下路径到系统 PATH:
echo           %PATH_ADD%
echo.
pause
`;

fs.writeFileSync(path.join(outputDir, 'install.bat'), installScriptContent, 'utf-8');
console.log('  ✓ install.bat (安装脚本)');

// 创建使用说明
const readmeContent = `# GG CODE v${version} - Windows 可执行文件

## 安装方法

### 方法一：自动安装（推荐）
1. 双击运行 \`install.bat\`
2. 按照提示完成安装
3. 关闭并重新打开终端
4. 在任何位置输入 \`ggcode\` 即可启动

### 方法二：手动安装
1. 将 \`${name}-win.exe\` 复制到你想安装的目录
2. 将该目录添加到系统 PATH 环境变量
3. 重命名文件为 \`ggcode.exe\`
4. 重新打开终端即可使用

## 使用说明

### 基本命令
\`\`\`
# 启动 AI 编程助手
ggcode

# 启动 agent 模式
ggcode agent

# 查看配置
ggcode config show

# 查看帮助
ggcode --help
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

## 卸载方法
1. 删除安装目录: \`%USERPROFILE%\\.ggcode\`
2. 从 PATH 环境变量中移除该目录

## 许可证
MIT License

## 技术支持
如有问题，请访问项目主页或提交 Issue。
`;

fs.writeFileSync(path.join(outputDir, 'README.txt'), readmeContent);
console.log('  ✓ README.txt (使用说明)');

// 获取文件大小
if (fs.existsSync(outputFile)) {
  const stats = fs.statSync(outputFile);
  const sizeInMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`\n📊 可执行文件大小: ${sizeInMB} MB`);
}

console.log(`\n📁 输出目录: ${outputDir}`);
console.log('\n✅ 打包完成!\n');
console.log('💡 分发给用户的文件:');
console.log('  1. gg-code-win.exe (主程序)');
console.log('  2. install.bat (安装脚本)');
console.log('  3. resources/ (资源文件，可选)');
console.log('  4. README.txt (使用说明)');
console.log('\n💡 用户安装步骤:');
console.log('  1. 将上述文件放在同一目录');
console.log('  2. 双击 install.bat 安装');
console.log('  3. 重启终端后即可使用 ggcode 命令');
