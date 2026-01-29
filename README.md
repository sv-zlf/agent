# 内网代码编辑助手

基于内网聊天API的代码编辑CLI工具，支持交互式对话、AI自主编程、代码编辑和搜索功能。

## 功能特性

- **AI自主编程**: 类似Claude Code，AI可以自主执行文件操作、命令执行等任务
- **交互式对话**: 与AI助手进行多轮对话
- **文件上下文**: 自动加载和分析代码文件
- **代码编辑**: 智能识别并应用代码修改
- **代码搜索**: 快速搜索代码模式
- **历史记录**: 保存对话历史
- **配置管理**: 灵活的配置系统

## 安装

### 环境要求

- Node.js >= 16.0.0
- npm (或内网npm仓库)

### 安装依赖

```bash
npm install
```

### 编译

```bash
npm run build
```

### 全局安装（可选）

```bash
npm link
```

## 快速开始

### 1. 初始化配置

```bash
npm run dev config init
```

### 2. 验证配置

```bash
npm run dev config validate
```

### 3. 开始对话

```bash
npm run dev chat
```

## 使用方法

### 配置管理

```bash
# 初始化配置文件
npm run dev config init

# 查看当前配置
npm run dev config

# 验证配置
npm run dev config validate

# 设置配置项
npm run dev config set api.timeout 30000

# 获取配置项
npm run dev config get api.model
```

### AI自主编程（Agent模式）

```bash
# 启动Agent模式（推荐）
npm run dev -- agent

# 自动批准所有操作（谨慎使用）
npm run dev -- agent --yes

# 自定义最大迭代次数
npm run dev -- agent --iterations 20

# 不保存历史记录
npm run dev -- agent --no-history
```

详细使用指南请查看 [AGENT_GUIDE.md](./AGENT_GUIDE.md)

### 交互式对话

```bash
# 基础对话
npm run dev chat

# 带文件上下文的对话
npm run dev chat --context ./src/app.ts

# 自定义系统提示词
npm run dev chat --system "你是一个Python专家"

# 不保存历史记录
npm run dev chat --no-history
```

### 交互式命令

在对话模式中：
- `exit` 或 `quit` - 退出对话
- `clear` - 清空对话上下文

## 配置文件

配置文件位于 `./config/config.yaml`：

```yaml
api:
  base_url: "http://10.252.167.50:8021"
  access_key_id: "1305842310935769088"
  tx_code: "A4011LM01"
  sec_node_no: "400136"
  model: "F-G-9B-V20241220-0000-00"
  timeout: 30000

agent:
  max_context_tokens: 8000
  backup_before_edit: true
  backup_dir: "./backups"
  max_file_size: 1048576  # 1MB
  max_history: 10

prompts:
  system: "./prompts/system.txt"
  code_edit: "./prompts/code-edit.txt"
```

## 项目结构

```
agent/
├── bin/
│   └── agent.js            # CLI入口
├── src/
│   ├── api/                # API适配器
│   ├── commands/           # CLI命令
│   ├── config/             # 配置管理
│   ├── core/               # 核心功能
│   ├── types/              # 类型定义
│   ├── utils/              # 工具函数
│   └── index.ts            # 主入口
├── prompts/                # 提示词模板
├── config/                 # 配置文件
├── tests/                  # 测试文件
└── package.json
```

## 开发

```bash
# 开发模式（使用ts-node）
npm run dev -- [command]

# 构建
npm run build

# 运行测试
npm test

# 监听测试
npm run test:watch
```

## 常见问题

### 1. API调用失败

检查：
- 网络连接是否正常
- API配置是否正确
- 认证信息是否有效

### 2. 配置文件加载失败

确保：
- 配置文件路径正确
- YAML格式正确
- 使用 `npm run dev config validate` 验证

### 3. 文件读取失败

检查：
- 文件路径是否正确
- 文件大小是否超过限制
- 文件编码是否为UTF-8

## License

MIT
