#!/usr/bin/env node

/**
 * GG CODE - EXE 打包脚本 (简化版)
 * 使用 pkg 将项目打包成独立的可执行文件
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * 递归复制目录
 * @param {string} src 源目录
 * @param {string} dest 目标目录
 */
function copyRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 格式化文件大小
 * @param {number} bytes 字节数
 * @returns {string} 格式化的大小
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

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
  try {
    console.log('🧹 清理旧的输出目录...');

    // 在 Windows 上使用 robocopy 清理目录
    try {
      const tempDir = path.join(path.dirname(outputDir), 'temp-delete');
      fs.mkdirSync(tempDir, { recursive: true });

      // 使用 robocopy 镜像空目录来删除内容
      execSync(`robocopy "${tempDir}" "${outputDir}" /MIR /NFL /NDL /NJH /NJS`, { stdio: 'pipe' });
      fs.rmSync(tempDir, { recursive: true });

      // 再次尝试删除目录
      fs.rmSync(outputDir, { recursive: true, force: true });
      console.log('✓ 清理旧的输出目录');
    } catch (robocopyError) {
      // 如果 robocopy 失败，尝试正常删除
      try {
        fs.rmSync(outputDir, { recursive: true, force: true });
        console.log('✓ 清理旧的输出目录');
      } catch (fsError) {
        console.log('❌ 无法清理输出目录，请手动删除 dist-exe 文件夹后重试');
        console.log(`路径: ${outputDir}`);
        process.exit(1);
      }
    }
  } catch (error) {
    console.log('❌ 清理输出目录失败:', error.message);
    process.exit(1);
  }
}
fs.mkdirSync(outputDir, { recursive: true });

// 确保项目已编译
console.log('\n📦 编译 TypeScript...');
try {
  const buildResult = execSync('npm run build', { cwd: rootDir, encoding: 'utf8' });
  console.log('✓ 编译完成\n');
} catch (error) {
  console.error('\n❌ 编译失败:');
  console.error(error.stdout || error.message);
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

  // 验证文件是否生成
  if (!fs.existsSync(outputFile)) {
    throw new Error('可执行文件未生成');
  }

  console.log('\n✅ Windows 可执行文件打包完成!\n');
} catch (error) {
  console.error('\n❌ 打包失败:');
  console.error(error.message || error);

  // 提供故障排除提示
  console.log('\n💡 故障排除提示:');
  console.log('  1. 确保有足够的磁盘空间');
  console.log('  2. 检查网络连接（pkg 需要下载 Node.js 运行时）');
  console.log('  3. 尝试更新 pkg: npm update pkg');

  process.exit(1);
}

// 所有提示词已内嵌到可执行文件中，无需外部资源
console.log('📄 提示词已内嵌到可执行文件\n');
let copiedFiles = 0;

// 生成安装脚本
console.log('\n📝 生成安装脚本...');
const installScriptContent = `@echo off
chcp 65001 >nul
echo =========================================
echo    GG CODE v${version} - 安装向导
echo =========================================
echo.

:: 获取脚本所在目录
set SCRIPT_DIR=%~dp0
set EXE_FILE=%SCRIPT_DIR%${name}-win.exe
set INSTALL_DIR=%USERPROFILE%\\.ggcode

:: 检查 exe 文件是否存在
if not exist "%EXE_FILE%" (
    echo [错误] 找不到 ${name}-win.exe 文件
    echo 请确保 install.bat 和 ${name}-win.exe 在同一目录下
    echo.
    pause
    exit /b 1
)

echo [1/3] 创建安装目录...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%INSTALL_DIR%\\bin" mkdir "%INSTALL_DIR%\\bin"
echo       ✓ 安装目录: %INSTALL_DIR%

echo.
echo [2/3] 复制可执行文件...
copy /Y "%EXE_FILE%" "%INSTALL_DIR%\\bin\\ggcode.exe" >nul
echo       ✓ 可执行文件已复制

echo.
echo [3/3] 添加到系统 PATH...

:: 检测 Windows 版本
ver | findstr /i "6\.1\.7601" >nul
if %errorlevel%==0 goto WIN7_PATH

ver | findstr /i "6\.1\." >nul
if %errorlevel%==0 goto WIN7_PATH

:: Windows 8+ 使用 PowerShell
set "PS_CMD=$p='%INSTALL_DIR%\\\\bin';$u=[Environment]::GetEnvironmentVariable('Path','User');if($u-notlike(\"*;$p;*\")-and$u-notlike(\"*;$p\")-and$u-notlike(\"$p;*\")){[Environment]::SetEnvironmentVariable('Path',$u+';'+$p,'User');Write-Host '       ✓ 已添加到用户 PATH'}else{Write-Host '       ✓ 已在 PATH 中'}"
powershell -NoProfile -Command "%PS_CMD%" 2>nul
if errorlevel 1 (
    echo       ⚠ 自动添加 PATH 失败，请手动添加
)
goto PATH_DONE

:WIN7_PATH
echo       检测到 Windows 7
echo.
echo       需要手动添加以下路径到系统 PATH:
echo.
echo       %INSTALL_DIR%\\bin
echo.
echo       按任意键继续...
pause >nul

:PATH_DONE

echo.
echo =========================================
echo [完成] 安装成功！
echo =========================================
echo 使用方法:
echo.
echo 1. 关闭当前终端窗口，重新打开一个新的终端
echo.
echo 2. 在任何目录下输入以下命令启动:
echo    ggcode
echo.
echo 3. 查看帮助:
echo    ggcode --help
echo.
echo =========================================
echo 安装信息:
echo   安装目录: %INSTALL_DIR%
echo   可执行文件: %INSTALL_DIR%\\bin\\ggcode.exe
echo   版本: ${version}
echo.
echo 💡 提示: 如果 ggcode 命令无法使用，请重启电脑
echo.
pause
`;

try {
  fs.writeFileSync(path.join(outputDir, 'install.bat'), installScriptContent, 'utf-8');
  console.log('  ✓ install.bat (安装脚本)');
  copiedFiles++;
} catch (error) {
  console.error('  ❌ 生成 install.bat 失败:', error.message);
}

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

## Windows 7 用户注意

Windows 7 及早期版本需要手动添加 PATH 环境变量：

1. 右键点击"计算机"，选择"属性"
2. 点击"高级系统设置"
3. 点击"环境变量"
4. 在"用户变量"中找到"Path"，点击"编辑"
5. 在变量值末尾添加：\`;C:\\\\Users\\\\你的用户名\\\\.ggcode\\\\bin\`
6. 点击"确定"保存

## 使用说明

### 基本命令
\`\`\`bash
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
配置文件位于用户主目录下的 \`~/.ggcode/config.json\`

首次运行会自动创建配置文件模板。

### 无需 Node.js
本可执行文件已内置 Node.js 运行时，无需单独安装。

## 系统要求
- **Windows 7/8/10/11** (x64)
- **管理员权限**（安装时需要）

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

try {
  fs.writeFileSync(path.join(outputDir, 'README.txt'), readmeContent);
  console.log('  ✓ README.txt (使用说明)');
  copiedFiles++;
} catch (error) {
  console.error('  ❌ 生成 README.txt 失败:', error.message);
}

// 获取文件大小
if (fs.existsSync(outputFile)) {
  const stats = fs.statSync(outputFile);
  console.log(`\n📊 可执行文件大小: ${formatFileSize(stats.size)}`);
}

console.log(`\n📊 复制了 ${copiedFiles} 个资源文件`);
console.log(`\n📁 输出目录: ${outputDir}`);
console.log('\n✅ 打包完成!\n');
console.log('💡 分发给用户的文件:');
console.log('  1. gg-code-win.exe (主程序，包含所有提示词)');
console.log('  2. install.bat (安装脚本)');
console.log('  3. README.txt (使用说明)');
console.log('\n💡 用户安装步骤:');
console.log('  1. 将上述文件放在同一目录');
console.log('  2. 双击 install.bat 安装');
console.log('  3. 重启终端后即可使用 ggcode 命令');
console.log('\n📦 所有提示词已内嵌到可执行文件中，无需外部资源文件！');
