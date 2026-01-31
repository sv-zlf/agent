# GG CODE 安装指南

## 方法一：一键安装（推荐）

### Windows 用户

1. 解压下载的安装包
2. 以**管理员身份**运行 `install.bat`
3. 按照提示完成安装
4. 打开新的终端窗口，输入 `ggcode` 即可使用

### 安装过程说明

`install.bat` 会自动执行以下操作：

1. **检查系统环境**：验证 Windows 版本和权限
2. **创建安装目录**：默认安装到 `C:\Program Files\GGCode`
3. **复制程序文件**：复制 exe 和资源文件
4. **添加到 PATH**：将安装目录添加到系统环境变量
5. **创建快捷方式**：在桌面和开始菜单创建快捷方式
6. **验证安装**：测试 `ggcode` 命令是否可用

### 卸载

运行 `uninstall.bat` 即可完全卸载程序。

---

## 方法二：手动安装

### 步骤 1：选择安装位置

将 `dist-exe` 文件夹复制到您想要的目录，例如：
```
C:\Program Files\GGCode
```

### 步骤 2：添加到系统 PATH

#### Windows 10/11

1. 右键点击"此电脑" → "属性"
2. 点击"高级系统设置"
3. 点击"环境变量"
4. 在"系统变量"中找到 `Path`，点击"编辑"
5. 点击"新建"，添加：`C:\Program Files\GGCode`
6. 点击"确定"保存所有设置

#### Windows 7/8

1. 右键点击"计算机" → "属性"
2. 点击"高级系统设置"
3. 点击"环境变量"
4. 在"系统变量"中找到 `Path`，点击"编辑"
5. 在变量值末尾添加：`;C:\Program Files\GGCode`
6. 点击"确定"保存所有设置

### 步骤 3：验证安装

**重要**：关闭所有终端窗口，打开新的终端窗口，然后运行：

```bash
ggcode --version
```

如果显示版本号，说明安装成功！

---

## 使用示例

安装完成后，可以在任何位置打开终端使用：

```bash
# 启动 AI 编程助手
ggcode agent

# 查看配置
ggcode config show

# 查看帮助
ggcode --help
```

---

## 常见问题

### Q: 运行 `ggcode` 命令提示"不是内部或外部命令"？

A: 请确保：
1. 已将安装目录添加到 PATH 环境变量
2. **关闭所有终端窗口后重新打开**
3. 以管理员身份运行 install.bat

### Q: install.bat 提示"权限不足"？

A: 请右键点击 `install.bat`，选择"以管理员身份运行"

### Q: 安装后命令不可用？

A: 尝试以下步骤：
1. 重启电脑
2. 手动检查 PATH 环境变量是否包含安装目录
3. 直接运行完整路径测试：`C:\Program Files\GGCode\ggcode.exe --version`

### Q: 如何修改安装目录？

A: 编辑 `install.bat`，修改第 9 行的 `INSTALL_DIR` 变量。

---

## 技术细节

### 环境变量修改

安装脚本会使用 `setx` 命令永久修改系统 PATH：
```batch
setx PATH "%PATH%;%INSTALL_DIR%" /M
```

### 文件结构

安装后的目录结构：
```
C:\Program Files\GGCode\
├── ggcode.exe           # 主程序
├── resources/           # 资源文件
│   ├── prompts/        # AI 提示词模板
│   └── config/         # 配置示例
└── uninstall.bat       # 卸载脚本
```

### 配置文件位置

用户配置文件位于：`%USERPROFILE%\.ggcode\config.yaml`

---

## 许可证

MIT License
