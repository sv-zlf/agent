@echo off
chcp 65001 >nul
echo.
echo ==========================================
echo   GG CODE - 卸载脚本
echo ==========================================
echo.

REM 检查是否以管理员身份运行
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [错误] 请以管理员身份运行此脚本！
    echo.
    echo 右键点击 uninstall.bat，选择"以管理员身份运行"
    echo.
    pause
    exit /b 1
)

set "INSTALL_DIR=C:\Program Files\ggcode"
set "BIN_DIR=C:\Windows\System32"

echo [警告] 即将卸载 GG CODE！
echo.
echo 将删除以下内容：
echo   - %INSTALL_DIR%
echo   - %BIN_DIR%\ggcode.bat
echo.
set /p confirm="确认卸载？(Y/N): "

if /i not "%confirm%"=="Y" (
    echo 已取消卸载。
    pause
    exit /b 0
)

echo.
echo [1/2] 删除全局命令...
if exist "%BIN_DIR%\ggcode.bat" (
    del /F /Q "%BIN_DIR%\ggcode.bat"
    echo   ✓ 已删除: ggcode.bat
) else (
    echo   - 全局命令不存在
)

echo.
echo [2/2] 删除安装目录...
if exist "%INSTALL_DIR%" (
    rmdir /S /Q "%INSTALL_DIR%"
    echo   ✓ 已删除: %INSTALL_DIR%
) else (
    echo   - 安装目录不存在
)

echo.
echo ==========================================
echo   ✅ 卸载完成！
echo ==========================================
echo.
echo 感谢使用 GG CODE！
echo.
pause