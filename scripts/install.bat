@echo off
chcp 65001 >nul
echo.
echo ==========================================
echo   GG CODE - 全局安装脚本
echo ==========================================
echo.

REM 检查是否以管理员身份运行
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [错误] 请以管理员身份运行此脚本！
    echo.
    echo 右键点击 install.bat，选择"以管理员身份运行"
    echo.
    pause
    exit /b 1
)

REM 获取脚本所在目录
set "SCRIPT_DIR=%~dp0"
set "EXE_FILE=%SCRIPT_DIR%gg-code-win.exe"
set "INSTALL_DIR=C:\Program Files\ggcode"
set "BIN_DIR=C:\Windows\System32"

REM 检查 exe 文件是否存在
if not exist "%EXE_FILE%" (
    echo [错误] 找不到 gg-code-win.exe 文件！
    echo 请确保 install.bat 与 gg-code-win.exe 在同一目录下。
    echo.
    pause
    exit /b 1
)

echo [1/4] 检查环境...
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
    echo   ✓ 创建安装目录: %INSTALL_DIR%
) else (
    echo   ✓ 安装目录已存在
)

echo.
echo [2/4] 复制文件...
copy /Y "%EXE_FILE%" "%INSTALL_DIR%\ggcode.exe" >nul
if %errorLevel% neq 0 (
    echo   [错误] 复制文件失败！
    pause
    exit /b 1
)
echo   ✓ 已复制: ggcode.exe

REM 复制资源文件（如果存在）
if exist "%SCRIPT_DIR%resources" (
    xcopy /E /I /Y "%SCRIPT_DIR%resources" "%INSTALL_DIR%\resources" >nul
    echo   ✓ 已复制: resources/
)

echo.
echo [3/4] 创建全局命令...
REM 创建 ggcode.bat 批处理文件
echo @echo off > "%BIN_DIR%\ggcode.bat"
echo "%INSTALL_DIR%\ggcode.exe" %%* >> "%BIN_DIR%\ggcode.bat"

if %errorLevel% neq 0 (
    echo   [错误] 创建全局命令失败！
    pause
    exit /b 1
)
echo   ✓ 已创建全局命令: ggcode

echo.
echo [4/4] 验证安装...
"%INSTALL_DIR%\ggcode.exe" --version >nul 2>&1
if %errorLevel% neq 0 (
    echo   [警告] 版本检查失败，但安装可能已完成
) else (
    echo   ✓ 安装验证成功
)

echo.
echo ==========================================
echo   ✅ 安装完成！
echo ==========================================
echo.
echo 使用方法：
echo   在任意位置打开命令行，输入:
echo   ggcode
echo.
echo 或带参数运行:
echo   ggcode agent
echo   ggcode --help
echo.
echo 卸载方法：
echo   运行 uninstall.bat 或手动删除:
echo   - %INSTALL_DIR%
echo   - %BIN_DIR%\ggcode.bat
echo.
pause