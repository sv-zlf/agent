# API 测试工具使用指南

在外网开发环境下，由于无法连接内网 API，我们提供了一套完整的测试工具来验证工具的准确性。

## 📋 目录

- [测试方案概述](#测试方案概述)
- [Mock API 测试](#mock-api-测试)
- [录制/回放测试](#录制回放测试)
- [单元测试](#单元测试)
- [测试场景管理](#测试场景管理)

## 🎯 测试方案概述

我们提供了三种测试方案：

| 方案 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| **Mock API** | 外网开发，快速验证 | 无需网络，快速，可控 | 需要手动编写场景 |
| **录制/回放** | 内外网切换 | 真实数据，完整覆盖 | 需要先在内网录制 |
| **单元测试** | 工具级别验证 | 精确，自动化 | 不测试 API 交互 |

## 🎭 Mock API 测试

Mock API 允许你在没有真实 API 的情况下测试工具调用。

### 1. 创建测试场景

在 `tests/fixtures/mock-scenarios/` 目录下创建 JSON 文件：

```json
{
  "name": "my-scenario",
  "description": "测试场景描述",
  "responses": [
    {
      "input": {
        "messages": [
          { "role": "user", "content": "用户输入" }
        ]
      },
      "output": "AI 的响应内容",
      "delay": 100
    },
    {
      "output": "另一个响应",
      "error": {
        "message": "错误消息",
        "code": "ERROR_CODE"
      }
    }
  ]
}
```

### 2. 运行 Mock 测试

```bash
# 首先编译项目
npm run build

# 运行 Mock API 测试
node scripts/test-with-mock.js
```

### 3. 编程方式使用

```typescript
import { createMockAPIAdapter } from './src/api';

const adapter = createMockAPIAdapter(config);

// 加载场景
await adapter.loadScenarioFromFile('my-scenario', 'path/to/scenario.json');

// 选择场景
adapter.selectScenario('my-scenario');

// 发送聊天请求
const response = await adapter.chat([
  { role: 'user', content: '测试消息' }
]);
```

## 📼 录制/回放测试

在内网时录制真实的 API 交互，在外网时回放。

### 1. 在内网环境录制

```typescript
import { createRecordingAPIAdapter } from './src/api';

const adapter = createRecordingAPIAdapter(config, {
  mode: 'record',
  recordingDir: './recordings'
});

// 开始录制
await adapter.startRecording('test-session', '测试场景描述');

// 执行正常的 AI 对话
const response = await adapter.chat([
  { role: 'user', content: '你的问题' }
]);

// 停止录制
await adapter.stopRecording();
```

### 2. 在外网环境回放

```typescript
import { createRecordingAPIAdapter } from './src/api';

const adapter = createRecordingAPIAdapter(config, {
  mode: 'playback',
  recordingDir: './recordings',
  sessionName: 'test-session'
});

// 加载会话并回放
await adapter.loadSession('test-session');

const response = await adapter.chat([
  { role: 'user', content: '你的问题' }
]);
```

### 3. 查看可用会话

```typescript
const sessions = await adapter.listSessions();
console.log('可用会话:', sessions);
```

### 4. 导出为 Markdown

```typescript
await adapter.exportToMarkdown('test-session', './output.md');
```

## 🧪 单元测试

运行不依赖 API 的工具级别测试：

```bash
# 运行所有测试
npm test

# 运行特定测试文件
npm test -- tests/tools-validation.test.ts

# 运行测试并生成覆盖率报告
npm run test:coverage
```

### 测试覆盖范围

- ✅ 工具注册验证
- ✅ 工具参数验证
- ✅ 文件操作准确性
- ✅ 搜索功能验证
- ✅ 错误处理
- ✅ 边界情况

## 📁 测试场景管理

### 目录结构

```
tests/
├── fixtures/
│   ├── mock-scenarios/      # Mock 测试场景
│   │   ├── file-read.json
│   │   ├── code-edit.json
│   │   └── error-handling.json
│   └── recordings/          # 录制的会话
├── tools.test.ts            # 工具系统测试
├── tools-validation.test.ts # 工具验证测试
└── README.md                # 本文档
```

### 创建新场景

1. **确定测试目标**：你想测试什么功能？
2. **准备输入输出**：定义用户输入和预期 AI 响应
3. **编写场景文件**：创建 JSON 配置
4. **验证场景**：运行测试确认正确性

### 场景示例

#### 场景 1：文件读取测试

```json
{
  "name": "file-read",
  "description": "测试 Read 工具调用",
  "responses": [
    {
      "output": "我会读取文件...",
      "delay": 100
    },
    {
      "output": "⮐\n{\"name\": \"Read\", \"parameters\": {\"filePath\": \"/path/to/file\"}}\n",
      "delay": 50
    },
    {
      "output": "读取成功，文件内容是..."
    }
  ]
}
```

#### 场景 2：代码编辑测试

```json
{
  "name": "code-edit",
  "description": "测试编辑工作流",
  "responses": [
    {
      "output": "先读取文件..."
    },
    {
      "output": "⮐\n{\"name\": \"Read\", ...}\n"
    },
    {
      "output": "现在编辑..."
    },
    {
      "output": "⮐\n{\"name\": \"Edit\", ...}\n"
    },
    {
      "output": "编辑完成！"
    }
  ]
}
```

## 🔄 工作流程推荐

### 外网开发流程

1. **使用 Mock API 快速验证**
   ```bash
   npm run build
   node scripts/test-with-mock.js
   ```

2. **运行单元测试确保工具正确性**
   ```bash
   npm test
   ```

3. **编写新功能时创建对应 Mock 场景**
   - 在 `tests/fixtures/mock-scenarios/` 添加场景
   - 运行测试验证

### 内外网切换流程

**内网环境（第一次）：**

1. 录制真实场景
2. 导出为 Markdown 文档
3. 保存录制文件

**外网环境（后续开发）：**

1. 使用回放模式测试
2. 使用 Mock API 补充新场景
3. 运行单元测试验证

## 📊 测试报告

### Mock API 测试输出

```
🧪 Mock API 测试工具

✓ 已加载 3 个测试场景: file-read, code-edit, error-handling
✓ 已注册 13 个工具

============================================================
测试场景: file-read
============================================================
✓ 已加载场景: 测试文件读取工具调用场景
ℹ 预期响应数: 3
✓ 收到 AI 响应

...

总计: 5/5 通过
✅ 所有测试通过！
```

### 单元测试输出

```
PASS  tests/tools-validation.test.ts
  工具调用准确性验证
    文件操作工具
      ✓ 读取存在的文本文件 (15ms)
      ✓ 读取不存在的文件 (8ms)
      ✓ 写入新文件 (12ms)
      ...

Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

## 💡 最佳实践

### 1. 场景命名规范

- 使用小写字母和连字符：`file-read`, `code-edit`
- 名称应清晰描述功能：`error-handling`, `multi-turn`

### 2. 场景组织

- 按功能模块分组
- 每个场景专注测试一个功能点
- 包含成功和失败案例

### 3. 延迟设置

```json
{
  "delay": 100  // 100ms，模拟真实网络延迟
}
```

- 正常操作：50-100ms
- 网络慢：200-500ms
- 快速测试：0-50ms

### 4. 输入验证（可选）

在 Mock 场景中可以验证输入：

```json
{
  "input": {
    "messages": [
      { "role": "user", "content": "预期的用户输入" }
    ]
  },
  "output": "对应的响应"
}
```

## 🐛 故障排查

### 问题：场景加载失败

```
Error: 场景 "xxx" 不存在
```

**解决**：检查场景文件路径和文件名是否正确。

### 问题：回放索引超出范围

```
Error: 回放索引超出范围: 5 >= 3
```

**解决**：回放的请求数超过了录制的交互数。检查代码逻辑。

### 问题：编译错误

```
Cannot find module '../dist/api'
```

**解决**：先运行 `npm run build` 编译项目。

## 📚 相关文档

- [tools/README.md](tools/README.md) - 工具系统文档
- [tests/README.md](tests/README.md) - 测试系统文档
- [CLAUDE.md](CLAUDE.md) - 项目架构文档
