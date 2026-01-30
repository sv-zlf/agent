# GG CODE - Agent 指导文档

## 项目概述

GG CODE 是一个 TypeScript CLI 应用，实现了 AI 驱动的代码编辑助手，灵感来自 Claude Code 和 OpenCode。它连接到内部网络聊天 API，提供具有自主代码编辑能力的交互式聊天。

## 构建和测试命令

- **安装依赖**: `npm install`
- **编译**: `npm run build` (编译 TypeScript 到 dist/)
- **运行 Agent**: `npm run agent` (启动 AI 助手)
- **开发模式**: `npm run dev -- [command]` (使用 ts-node)
- **测试**: `npm test` (运行 Jest 测试)
- **单文件测试**: `npm test -- path/to/test.test.ts`
- **测试监听**: `npm run test:watch`
- **Lint**: `npm run lint` (ESLint)
- **格式化**: `npm run format` (Prettier)

## 代码风格

- **运行时**: Node.js >= 16.0.0 with TypeScript
- **模块系统**: CommonJS (ESM 导入), tsconfig strict mode enabled
- **类型安全**: Zod schemas 用于工具参数验证，TypeScript 接口用于数据结构
- **导入风格**:
  - 第三方库: `import * as z from 'zod'`, `import chalk from 'chalk'`
  - 本地模块: `import { Logger } from '../utils'`, `import * as fs from 'fs/promises'`
  - 类型导出: `export * from './message'` 用于批量导出
  - 工具别名: `import { ReadTool, WriteTool } from './read'` 等
- **命名约定**:
  - 变量/函数: camelCase (如 `toolCallStartTime`, `executeToolCall`)
  - 类/接口/类型: PascalCase (如 `ToolEngine`, `AgentOrchestrator`)
  - 常量: UPPER_SNAKE_CASE (如 `DEFAULT_READ_LIMIT`, `MAX_BYTES`)
  - 工具导出: PascalCase + Tool 后缀 (如 `ReadTool`, `BashTool`)
- **文件组织**: 按功能模块化 (core/, tools/, utils/, types/)
- **错误处理**: 工具函数返回错误对象而非抛出异常，避免中断 Agent 执行

## 架构

### 核心组件

- **ToolEngine** (`src/core/tool-engine.ts`): 工具注册和执行
  - 工具权限级别: `safe`, `local-modify`, `network`, `dangerous`
  - `safe` 权限的工具（Read, Glob, Grep）自动执行无需确认
  - 默认超时: 30s，最大: 120s

- **ContextManager** (`src/core/context-manager.ts`): 对话历史管理
  - 支持两种消息格式: `Message` 和 `EnhancedMessage`
  - 会话隔离的历史文件 (`.agent-history-{sessionId}.json`)
  - Token 估算用于上下文管理

- **AgentOrchestrator** (`src/core/agent.ts`): Agent 编排
  - 多 Agent 协调 (default, explore, build, plan, general)
  - 基于权限的工具批准工作流
  - 迭代工具调用直到完成或达到最大迭代次数

- **SessionManager** (`src/core/session-manager.ts`): 会话管理
  - 多会话支持，隔离的历史
  - 会话持久化在 `.agent-sessions/` 目录
  - 会话类型: default, explore, build, plan

### 工具系统 (`src/tools/`)

所有工具使用统一框架 (`src/tools/tool.ts`):

```typescript
export const ToolName = defineTool('tool-id', {
  description: '工具描述',
  parameters: z.object({
    param: z.string().describe('参数描述'),
  }),
  async execute(args, ctx) {
    return {
      title: '标题',
      output: '输出内容',
      metadata: { /* 元数据 */ }
    };
  }
});
```

**可用工具**:
- `read` - 读取文件内容
- `write` - 写入文件
- `edit` - 编辑文件（字符串替换）
- `glob` - 文件模式匹配
- `grep` - 内容搜索
- `bash` - 执行命令
- `make-directory` - 创建目录

### 配置系统

配置文件: `./config/config.yaml` 或 `.ggrc.json`

**重要**: API 使用**双重 JSON 序列化**:
```typescript
{
  Data_cntnt: JSON.stringify({
    user_id: string,
    messages: Message[],
    model_config: { model, temperature, top_p, top_k, repetition_penalty }
  }),
  Fst_Attr_Rmrk: access_key_id
}
```

## Slash 命令

- `/init` - 创建/更新项目 DESIGN.md
- `/models [model]` - 列出或切换 AI 模型
- `/session new/list/switch/delete` - 会话管理
- `/compress on/off/manual/status` - 上下文压缩控制
- `/tokens` - 显示 token 使用统计
- `/test` - 测试交互式选择功能

## 开发指南

1. **添加新工具**: 在 `src/tools/` 创建新文件，使用 `defineTool` 模式
2. **添加新 Agent**: 在 prompts 目录创建 agent-specific prompt
3. **修改系统提示**: 更新 `src/tools/prompts/default.txt`
4. **测试**: 使用 `/test` 命令测试交互功能

## 代码模式

- **Logger**: `import { createLogger } from '../utils'; const logger = createLogger(debugMode);`
- **类型导出**: `export * from './message'` 用于批量导出类型
- **异步错误处理**: 工具返回 `{ success, output?, error?, metadata }` 而非抛出异常

## 常见任务

### 添加新工具
1. 在 `src/tools/` 创建 `new-tool.ts`
2. 使用 `defineTool` 定义工具
3. 在 `src/tools/index.ts` 导出
4. 更新系统提示词描述新工具

### 调试工具调用
1. 检查 `src/core/tool-engine.ts` 中的工具执行
2. 查看工具返回的 metadata
3. 检查权限系统是否正确工作

### 自定义 Agent Prompt
1. 在 `src/tools/prompts/{agent-name}.txt` 创建 prompt
2. 使用 `/session switch` 切换到该 agent
3. Agent 会自动加载对应的 prompt 文件

## 注意事项

- **双重 JSON 序列化**: API 调用必须嵌套 JSON
- **权限系统**: safe 权限工具自动批准
- **会话隔离**: 每个会话有独立的历史文件
- **Token 限制**: 接近限制时自动触发上下文压缩
- **P 键中断**: 支持 P 键中断 AI 思考或工具执行
- **工具输出截断**: 大文件自动截断到 50KB/2000 行，完整内容保存到临时文件
