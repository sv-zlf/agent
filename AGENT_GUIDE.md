# AI自主编程助手使用指南

## 概述

`agent` 命令将此工具从简单的问答助手升级为类似 Claude Code 的自主编程助手。它可以：

- 📖 **读取文件** - 查看代码内容
- ✏️ **编辑文件** - 精确修改代码
- 🔍 **搜索代码** - 使用模式和正则表达式查找代码
- ⚙️ **执行命令** - 运行测试、构建、git操作等
- 🤖 **自主规划** - 分解复杂任务并逐步执行

## 快速开始

### 1. 启动Agent模式

```bash
# 基础模式（需要批准每个工具调用）
npm run dev -- agent

# 自动批准模式（谨慎使用）
npm run dev -- agent --yes

# 自定义最大迭代次数
npm run dev -- agent --iterations 20
```

### 2. 与Agent交互

启动后，你可以像与 Claude Code 交互一样与 Agent 对话：

```
You: 帮我添加一个用户认证功能
```

Agent会：
1. 分析你的需求
2. 查找相关文件（使用 Glob 工具）
3. 阅读代码（使用 Read 工具）
4. 修改文件（使用 Edit 工具）
5. 运行测试（使用 Bash 工具）
6. 向你报告结果

## 可用工具

### Read - 读取文件

读取文件内容，支持分页读取。

```json
{
  "tool": "Read",
  "parameters": {
    "file_path": "/path/to/file.ts",
    "offset": 0,
    "limit": 100
  }
}
```

### Write - 写入文件

创建新文件或完全覆盖现有文件。

```json
{
  "tool": "Write",
  "parameters": {
    "file_path": "/path/to/new-file.ts",
    "content": "文件内容..."
  }
}
```

### Edit - 编辑文件

对文件执行精确的字符串替换。**这是修改现有文件的首选方式。**

```json
{
  "tool": "Edit",
  "parameters": {
    "file_path": "/path/to/file.ts",
    "old_string": "要替换的代码",
    "new_string": "替换后的代码",
    "replace_all": false
  }
}
```

### Glob - 文件查找

使用 glob 模式查找文件。

```json
{
  "tool": "Glob",
  "parameters": {
    "pattern": "**/*.ts",
    "path": "./src"
  }
}
```

### Grep - 代码搜索

在文件中搜索匹配的内容，支持正则表达式。

```json
{
  "tool": "Grep",
  "parameters": {
    "pattern": "function.*Auth",
    "path": "./src",
    "glob": "*.ts",
    "case_insensitive": true
  }
}
```

### Bash - 执行命令

执行 shell 命令。

```json
{
  "tool": "Bash",
  "parameters": {
    "command": "npm test",
    "description": "运行测试"
  }
}
```

## 使用场景

### 场景1：添加新功能

```
You: 添加一个用户登录功能，支持邮箱和密码登录
```

Agent会：
1. 使用 `Glob` 查找用户相关文件
2. 使用 `Read` 阅读现有用户模块
3. 使用 `Edit` 添加登录函数
4. 使用 `Write` 创建登录路由
5. 使用 `Bash` 运行测试验证

### 场景2：修复Bug

```
You: 修复用户登录后session没有保存的问题
```

Agent会：
1. 使用 `Grep` 搜索 "session" 相关代码
2. 使用 `Read` 查看登录处理逻辑
3. 分析问题原因
4. 使用 `Edit` 应用修复
5. 使用 `Bash` 运行测试确认修复

### 场景3：重构代码

```
You: 将数据库查询逻辑抽取到单独的repository层
```

Agent会：
1. 使用 `Glob` 查找所有包含数据库查询的文件
2. 使用 `Read` 分析现有查询代码
3. 使用 `Write` 创建 repository 文件
4. 使用 `Edit` 重构现有代码使用 repository
5. 使用 `Bash` 运行测试确保没有破坏功能

## 配置选项

在 `config/config.yaml` 中配置Agent行为：

```yaml
agent:
  max_context_tokens: 8000      # 最大上下文token数
  backup_before_edit: true      # 编辑前自动备份
  backup_dir: "./backups"       # 备份目录
  max_file_size: 1048576        # 最大文件大小（1MB）
  max_history: 10               # 最大历史记录数
  max_iterations: 10            # Agent最大迭代次数
  auto_approve: false           # 是否自动批准工具调用

prompts:
  system: "./prompts/system.txt"
  code_edit: "./prompts/code-edit.txt"
  agent_mode: "./prompts/agent.txt"
```

## 交互式命令

在Agent模式下，你可以使用以下特殊命令：

- `exit` 或 `quit` - 退出Agent
- `clear` - 清空对话上下文
- `tools` - 显示所有可用工具列表

## 安全注意事项

1. **备份**：默认情况下，所有文件修改都会自动创建备份（`.backup` 文件）
2. **审批流程**：默认需要手动批准每个工具调用，使用 `--yes` 跳过审批（谨慎使用）
3. **危险命令**：Agent会检测危险命令（如 `rm -rf`）并额外确认
4. **工作目录**：Agent在当前工作目录下操作

## 工作流程

Agent执行任务时遵循以下流程：

```
用户请求
    ↓
理解需求
    ↓
规划步骤
    ↓
┌─────────────┐
│  执行循环    │
│  ↓          │
│ 调用工具    │
│  ↓          │
│ 获取结果    │
│  ↓          │
│ 检查错误    │
│  ↓          │
│ 继续或完成  │
└─────────────┘
    ↓
报告结果
```

## 与Chat模式的区别

| 特性 | Chat模式 | Agent模式 |
|------|----------|-----------|
| 主要用途 | 问答对话 | 自主编程 |
| 工具调用 | ❌ 不支持 | ✅ 支持 |
| 文件操作 | ❌ 只读 | ✅ 读写编辑 |
| 命令执行 | ❌ 不支持 | ✅ 支持 |
| 任务规划 | ❌ 不支持 | ✅ 支持 |
| 迭代执行 | ❌ 不支持 | ✅ 支持 |

## 最佳实践

1. **明确需求** - 清晰地描述你想要完成什么
2. **逐步迭代** - 对于复杂任务，可以分步指导Agent
3. **审查结果** - 检查Agent的修改是否符合预期
4. **使用版本控制** - 确保项目在git下，可以随时回退
5. **保持对话** - Agent会记住上下文，可以基于之前的操作继续

## 示例对话

```
You: 帮我在项目中添加一个日志工具

Agent: [使用Glob查找工具文件]
Agent: [使用Read阅读现有工具]
Agent: [使用Write创建logger.ts]
Agent: [使用Edit在index.ts中导出logger]

✅ 完成！我已经创建了logger工具，包含以下功能：
- info级别日志
- error级别日志
- warn级别日志
- 支持文件和时间戳

You: 现在在用户登录函数中添加日志记录

Agent: [使用Grep查找登录函数]
Agent: [使用Read阅读登录代码]
Agent: [使用Edit添加日志语句]

✅ 完成！已在登录函数中添加日志记录
```

## 故障排除

### 问题：Agent无法找到文件

**解决方案**：提供更明确的路径或使用 `**/*.ts` 模式搜索

### 问题：工具调用失败

**解决方案**：
1. 检查文件路径是否正确
2. 确认文件权限
3. 查看错误消息了解具体原因

### 问题：达到最大迭代次数

**解决方案**：
1. 使用 `--iterations` 增加迭代次数
2. 将大任务分解为多个小任务
3. 继续对话，Agent会记住之前的上下文

## 架构说明

Agent模式采用了类似Claude Code的架构：

- **Tool Engine** - 工具执行引擎，管理所有可用工具
- **Agent Orchestrator** - 代理编排器，负责任务规划和执行
- **Context Manager** - 上下文管理器，维护对话历史
- **Built-in Tools** - 内置工具集合（Read, Write, Edit, Glob, Grep, Bash）

这种架构使Agent能够自主地理解用户意图、规划任务步骤、执行工具调用，并逐步完成复杂的编程任务。
