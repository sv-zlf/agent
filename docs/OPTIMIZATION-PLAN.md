# GG CODE 优化方案
## 参考 OPENCODE 架构

本文档总结了从 opencode 学到的关键架构特性，并提供了 GG CODE 的优化建议。

---

## 🎯 核心优化点

### 1. **增强的消息系统** ⭐⭐⭐⭐⭐

**opencode 的设计**:
- 支持多种 Part 类型：Text, File, Snapshot, Patch, Reasoning, Agent, Subtask
- 每个消息可以有多个 parts，结构化存储
- 支持 synthetic 标记（自动生成的部分）
- 支持 ignored 标记（忽略某些部分）

**GG CODE 当前问题**:
- 只支持简单的文本消息
- 工具调用和结果混在文本中
- 难以区分用户输入和系统生成内容

**优化方案**:

```typescript
// src/types/message.ts
export enum PartType {
  TEXT = 'text',
  FILE = 'file',
  TOOL_CALL = 'tool_call',
  TOOL_RESULT = 'tool_result',
  REASONING = 'reasoning',
  SYSTEM = 'system',
}

export interface MessagePart {
  type: PartType;
  id: string;
  content: string;
  metadata?: Record<string, any>;
  synthetic?: boolean;  // 系统自动生成
  ignored?: boolean;   // 不在上下文中使用
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
  timestamp: number;
  agent?: string;
}
```

**优势**:
- ✅ 结构清晰，易于调试
- ✅ 可以过滤某些 parts（如 synthetic）
- ✅ 更好的上下文管理
- ✅ 支持多模态（文本、文件、图像等）

---

### 2. **改进的对话循环控制** ⭐⭐⭐⭐⭐

**opencode 的设计**:
- 不是简单的固定轮次，而是智能循环
- 自动检测任务完成（assistant.finish 状态）
- 支持中间状态（tool-calls, unknown）
- Subtask 嵌套执行

**GG CODE 当前问题**:
- 固定最大迭代次数
- 难以优雅结束对话
- 不支持子任务

**优化方案**:

```typescript
// src/core/conversation.ts
export class ConversationController {
  async executeLoop(
    maxSteps: number = Infinity
  ): Promise<void> {
    let step = 0;

    while (step < maxSteps) {
      const lastUserMessage = this.getLastUserMessage();
      const lastAssistant = this.getLastAssistantMessage();

      // 检查是否应该结束
      if (this.shouldFinish(lastAssistant)) {
        break;
      }

      step++;
      const response = await this.callAI();

      // 解析工具调用
      const toolCalls = this.parseToolCalls(response);

      if (toolCalls.length === 0) {
        // 没有工具调用，任务完成
        this.addMessage('assistant', response);
        break;
      }

      // 执行工具
      const results = await this.executeTools(toolCalls);

      // 检查是否有子任务
      const subtasks = this.extractSubtasks(results);
      if (subtasks.length > 0) {
        await this.executeSubtasks(subtasks);
      }

      // 继续循环
    }
  }

  private shouldFinish(assistant: Message | undefined): boolean {
    if (!assistant) return false;

    // 如果有 finish 状态且不是 tool-calls/unknown，说明任务完成
    return !!assistant.finish &&
           !['tool-calls', 'unknown'].includes(assistant.finish);
  }
}
```

---

### 3. **权限系统** ⭐⭐⭐⭐

**opencode 的设计**:
- 细粒度权限控制
- 支持 allow/deny/ask 三种模式
- 基于模式的权限规则
- 工具级别的权限控制

**GG CODE 当前问题**:
- 只有简单的 auto-approve
- 没有细粒度控制
- 不支持 ask 模式

**优化方案**:

```typescript
// src/core/permissions.ts
export enum PermissionAction {
  ALLOW = 'allow',
  DENY = 'deny',
  ASK = 'ask',
}

export interface PermissionRule {
  tool: string;
  pattern: string;  // "*" 表示所有
  action: PermissionAction;
}

export class PermissionManager {
  private rules: PermissionRule[] = [];

  checkPermission(tool: string, path: string): PermissionAction {
    for (const rule of this.rules) {
      if (rule.tool === '*' || rule.tool === tool) {
        if (this.matchPattern(path, rule.pattern)) {
          return rule.action;
        }
      }
    }
    return PermissionAction.ALLOW;
  }

  async askPermission(
    tool: string,
    path: string,
    metadata?: any
  ): Promise<boolean> {
    // 交互式询问用户
    const answer = await this.promptUser({
      tool,
      path,
      metadata,
    });
    return answer === 'y';
  }

  private matchPattern(path: string, pattern: string): boolean {
    // 简单的通配符匹配
    const regex = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(regex).test(path);
  }
}
```

---

### 4. **上下文压缩** ⭐⭐⭐⭐

**opencode 的设计**:
- 当 token 数量接近上限时自动压缩上下文
- 保留关键信息，丢弃冗余内容
- 分阶段压缩
- 支持手动和自动压缩

**GG CODE 当前问题**:
- 只依赖 max_history 配置
- 没有智能压缩机制
- 可能浪费 tokens

**优化方案**:

```typescript
// src/core/context-optimizer.ts
export class ContextOptimizer {
  private MAX_TOKENS = 120000; // 根据模型调整

  async shouldCompress(context: Message[]): Promise<boolean> {
    const tokens = this.estimateTokens(context);
    return tokens > this.MAX_TOKENS * 0.8;
  }

  async compress(context: Message[]): Promise<Message[]> {
    const stages = [
      this.removeOldMessages,
      this.summarizeConversations,
      this.mergeSystemMessages,
      this.removeRedundantFiles,
    ];

    let optimized = context;
    for (const stage of stages) {
      optimized = await stage(optimized);
      if (await this.shouldCompress(optimized)) {
        continue;
      } else {
        break;
      }
    }

    return optimized;
  }

  private async summarizeConversations(
    context: Message[]
  ): Promise<Message[]> {
    // 识别连续的对话轮次
    // 保留最近 2-3 轮详细内容
    // 更早的轮次只保留摘要
    // ...
  }
}
```

---

### 5. **更好的工具执行反馈** ⭐⭐⭐⭐

**opencode 的设计**:
- 实时流式输出工具执行状态
- 详细的执行元数据
- 支持输出截断和文件附件
- 错误处理和重试机制

**GG CODE 当前问题**:
- 工具执行反馈不够详细
- 没有进度指示
- 错误处理简单

**优化方案**:

```typescript
// src/tools/base.ts
export interface ToolExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: {
    startTime: number;
    endTime: number;
    duration: number;
    truncated?: boolean;
    attachments?: string[];
  };
}

export abstract class BaseTool {
  abstract execute(params: any): Promise<ToolExecutionResult>;

  protected async executeWithProgress<T>(
    operation: (progress: (current: number, total: number) => void) => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await operation((current, total) => {
        this.updateProgress(current, total);
      });

      return {
        success: true,
        metadata: {
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
        },
        ...result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
        },
      };
    }
  }

  protected updateProgress(current: number, total: number): void {
    const percentage = Math.round((current / total) * 100);
    // 显示进度条
  }
}
```

---

### 6. **多 Agent 协作** ⭐⭐⭐⭐⭐

**opencode 的设计**:
- 支持 primary 和 subagent 两种模式
- Subtask 工具调用其他 agent
- Agent 之间传递上下文
- 权限继承和覆盖

**GG CODE 当前状态**:
- ✅ 已有基础的 Agent 系统
- ❌ 还不支持 subtask
- ❌ Agent 之间无法协作

**优化方案**:

```typescript
// src/tools/subtask.ts
export class SubtaskTool extends BaseTool {
  name = 'subtask';

  async execute(params: {
    agent: string;
    prompt: string;
    description?: string;
  }): Promise<ToolExecutionResult> {
    const agentManager = getAgentManager();
    const agent = agentManager.getAgent(params.agent);

    if (!agent) {
      return {
        success: false,
        error: `Agent not found: ${params.agent}`,
      };
    }

    if (agent.mode !== 'all' && agent.mode !== 'subagent') {
      return {
        success: false,
        error: `Agent ${params.agent} cannot be used as subtask`,
      };
    }

    // 创建新的会话执行子任务
    const subtaskContext = this.createSubtaskContext();
    const result = await this.executeSubtask(
      subtaskContext,
      agent,
      params.prompt
    );

    return {
      success: true,
      output: result.summary,
      metadata: {
        subagent: params.agent,
        subtaskId: subtaskContext.id,
      },
    };
  }
}
```

---

### 7. **计划模式 (Plan Mode)** ⭐⭐⭐⭐⭐

**opencode 的设计**:
- Plan agent: 只允许分析，不允许修改
- Plan file: 保存计划到文件
- Plan exit: 确认计划后再执行
- 分阶段：理解 → 设计 → 审查 → 执行

**GG CODE 当前状态**:
- ❌ 没有计划模式

**优化方案**:

```typescript
// src/core/plan-mode.ts
export class PlanMode {
  async enterPlanMode(userQuery: string): Promise<string> {
    // 1. 创建 plan.md 文件
    // 2. 使用 explore agent 分析需求
    // 3. 生成详细的执行计划
    // 4. 展示计划给用户确认
    // 5. 确认后切换到 build agent 执行
  }

  async generatePlan(userQuery: string): Promise<string> {
    const agentManager = getAgentManager();
    const planAgent = agentManager.getAgent('plan');
    const prompt = await agentManager.loadAgentPrompt('plan');

    // 执行规划...
  }
}
```

---

### 8. **更智能的工具调用解析** ⭐⭐⭐⭐

**opencode 的设计**:
- 从文本和 JSON 代码块中解析工具调用
- 支持多种格式
- 容错能力强
- 提供解析错误信息

**GG CODE 当前问题**:
- 解析逻辑简单
- 错误处理不够友好

**优化方案**:

```typescript
// src/core/tool-parser.ts
export class ToolCallParser {
  parse(response: string): ToolCall[] {
    const calls: ToolCall[] = [];

    // 1. 尝试解析 JSON 代码块
    const jsonCalls = this.parseJSONBlocks(response);
    calls.push(...jsonCalls);

    // 2. 尝试解析 markdown 格式
    const markdownCalls = this.parseMarkdownFormat(response);
    calls.push(...markdownCalls);

    // 3. 检测无效调用
    const validCalls = this.validateCalls(calls);

    return validCalls;
  }

  private parseJSONBlocks(text: string): ToolCall[] {
    // 匹配 ```json...``` 代码块
    const pattern = /```json\s+([\s\S]*?)\s+```/g;
    // ...
  }

  private parseMarkdownFormat(text: string): ToolCall[] {
    // 匹配 `{"tool": "...", "parameters": {...}}`
    const pattern = /`{(?:\\\s*"tool"\\\s*:\s*["']([^"']+)["'](?:\\\s*,\s*"parameters"\\\s*:\s*{(?:[^{}]|{[^}]*})*})}\s*`/g;
    // ...
  }
}
```

---

### 9. **会话状态管理** ⭐⭐⭐⭐

**opencode 的设计**:
- 清晰的状态定义：idle, busy, error
- 状态持久化
- 状态恢复机制
- 状态变化事件

**GG CODE 当前问题**:
- 没有明确的状态定义
- 难以追踪会话状态

**优化方案**:

```typescript
// src/core/session-state.ts
export enum SessionState {
  IDLE = 'idle',
  BUSY = 'busy',
  THINKING = 'thinking',
  EXECUTING = 'executing',
  ERROR = 'error',
}

export class SessionStateManager {
  private state: SessionState = SessionState.IDLE;
  private listeners: Set<(state: SessionState) => void> = new Set();

  setState(state: SessionState): void {
    const oldState = this.state;
    this.state = state;
    this.notifyListeners(oldState, state);
  }

  getState(): SessionState {
    return this.state;
  }

  subscribe(callback: (state: SessionState) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(oldState: SessionState, newState: SessionState): void {
    this.listeners.forEach(callback => callback(newState));
  }
}
```

---

### 10. **代码快照和回滚** ⭐⭐⭐

**opencode 的设计**:
- 支持创建代码快照
- 可以回滚到任意快照
- 用于实验性修改

**GG CODE 当前问题**:
- ❌ 没有快照功能
- ❌ 实验性修改不安全

**优化方案**:

```typescript
// src/core/snapshot.ts
export class SnapshotManager {
  async createSnapshot(name?: string): Promise<string> {
    const snapshotId = `snapshot-${Date.now()}`;

    // 保存当前所有修改的文件
    const modifiedFiles = await this.getModifiedFiles();
    const snapshot = {
      id: snapshotId,
      files: modifiedFiles.map(f => ({
        path: f,
        content: await this.readFile(f),
        originalContent: await this.getOriginalContent(f),
      })),
    };

    await this.saveSnapshot(snapshot);
    return snapshotId;
  }

  async rollback(snapshotId: string): Promise<void> {
    const snapshot = await this.loadSnapshot(snapshotId);

    for (const file of snapshot.files) {
      await this.writeFile(file.path, file.originalContent);
    }
  }
}
```

---

## 🎯 推荐的实施顺序

### 阶段 1: 快速优化（1-2天）
1. ✅ **改进消息系统** - 结构化消息存储 **(已完成 2026-01-29)**
   - ✅ 创建了 `src/types/message.ts` 定义增强消息类型
   - ✅ 实现了 PartType 枚举 (TEXT, FILE, TOOL_CALL, TOOL_RESULT, REASONING, SYSTEM)
   - ✅ 支持 synthetic 和 ignored 标志
   - ✅ 更新 ContextManager 支持增强消息模式
   - ✅ AgentOrchestrator 自动启用增强消息
   - ✅ 工具执行时长追踪
2. ✅ **会话状态管理** - 清晰的状态定义 **(已完成 2026-01-29)**
   - ✅ 创建了 `src/core/session-state.ts` 定义会话状态管理
   - ✅ 实现了 SessionState 枚举 (IDLE, BUSY, THINKING, EXECUTING, ERROR, COMPLETED)
   - ✅ 支持状态变化事件监听
   - ✅ 支持状态历史记录和统计
   - ✅ AgentOrchestrator 集成会话状态管理器
   - ✅ 与旧的状态系统兼容
3. ✅ **工具执行反馈** - 详细的执行元数据 **(已完成 2026-01-29)**
   - ✅ 创建了 ToolResultMetadata 接口
   - ✅ 支持 startTime/endTime/duration 追踪
   - ✅ 支持输出截断检测
   - ✅ 支持文件附件列表
   - ✅ 支持退出码和中断信号追踪
   - ✅ 工具引擎自动添加详细元数据
   - ✅ 支持重试次数追踪

### 阶段 2: 核心功能（3-5天）
4. ✅ **权限系统** - 细粒度权限控制
5. ✅ **上下文压缩** - 智能 token 管理
6. ✅ **对话循环控制** - 智能结束检测

### 阶段 3: 高级特性（5-7天）
7. ✅ **多 Agent 协作** - Subtask 工具
8. ✅ **计划模式** - Plan/Build 双模式
9. ✅ **代码快照** - 实验性修改支持
10. ✅ **智能解析** - 多格式工具调用解析

---

## 📊 对比表

| 特性 | GG CODE 当前 | opencode | 优化后 |
|------|------------|----------|--------|
| 消息结构 | ✅ Parts（多类型） | Parts（多类型） | ✅ 阶段1已完成 |
| 对话循环 | 固定轮次 | 智能循环 | 智能检测完成 |
| 权限控制 | 二元（all/ask） | 细粒度规则 | allow/deny/ask |
| 上下文管理 | max_history | 智能压缩 | 自动优化 |
| Agent 模式 | 单一模式 | Primary/Subagent | 多种模式 |
| 状态管理 | ✅ 显式状态机 | 显式状态机 | ✅ 阶段1已完成 |
| 工具反馈 | ✅ 详细元数据 | 详细元数据 | ✅ 阶段1已完成 |

---

## ✅ 阶段1完成总结 (2026-01-29)

阶段1的三个优化已全部完成，GG CODE 现在具备以下增强功能：

### 1. 增强消息系统
- 结构化的消息存储，支持多种 Part 类型
- 工具调用和结果作为独立的消息部分
- 支持 synthetic 和 ignored 标志用于过滤

### 2. 会话状态管理
- 清晰的状态定义 (IDLE, BUSY, THINKING, EXECUTING, ERROR, COMPLETED)
- 状态变化事件监听和历史记录
- 状态统计功能

### 3. 工具执行反馈
- 详细的执行元数据 (开始时间、结束时间、时长)
- 输出截断检测
- 中断信号追踪 (SIGINT, TIMEOUT)
- 支持文件附件列表

### 关键文件变更
- `src/types/message.ts` - 新增增强消息类型定义
- `src/types/index.ts` - 新增 ToolResultMetadata 接口
- `src/core/session-state.ts` - 新增会话状态管理器
- `src/core/context-manager.ts` - 支持增强消息模式
- `src/core/agent.ts` - 集成会话状态管理器
- `src/core/tool-engine.ts` - 增强工具执行元数据

---

**更新日期**: 2026-01-29
**参考**: H:\Project\agent\temp\opencode
