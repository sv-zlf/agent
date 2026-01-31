import type { ToolCall, ToolResult, AgentRuntimeConfig, AgentContext, AgentStatus } from '../types';
import { ToolEngine } from './tool-engine';
import type { IAPIAdapter } from '../api';
import { ContextManager } from './context-manager';
import { SessionStateManager, SessionState } from './session-state';
import { PermissionManager, PermissionAction, type PermissionRequest } from './permissions';
import { FunctionalAgentManager } from './functional-agents';
import { generateToolsDescription } from '../tools';

/**
 * Agent执行配置
 */
export interface AgentExecutionConfig extends AgentRuntimeConfig {
  onToolCall?: (call: ToolCall) => Promise<boolean>; // 返回true表示批准
  onStatusChange?: (status: AgentStatus, message?: string) => void;
}

/**
 * Agent执行结果
 */
interface AgentResult {
  success: boolean;
  iterations: number;
  toolCallsExecuted: number;
  finalAnswer?: string;
  error?: string;
}

/**
 * Agent代理编排器
 */
export class AgentOrchestrator {
  private apiAdapter: IAPIAdapter;
  private toolEngine: ToolEngine;
  private contextManager: ContextManager;
  private config: AgentExecutionConfig;
  private status: AgentStatus = 'idle';
  private toolCallStartTime: Map<string, number> = new Map(); // 跟踪工具调用开始时间
  private stateManager: SessionStateManager; // 会话状态管理器
  private permissionManager: PermissionManager; // 权限管理器
  private functionalAgentManager?: FunctionalAgentManager; // 功能性 Agent 管理器

  constructor(
    apiAdapter: IAPIAdapter,
    toolEngine: ToolEngine,
    contextManager: ContextManager,
    config: AgentExecutionConfig,
    stateManager?: SessionStateManager,
    permissionManager?: PermissionManager,
    functionalAgentManager?: FunctionalAgentManager
  ) {
    this.apiAdapter = apiAdapter;
    this.toolEngine = toolEngine;
    this.contextManager = contextManager;
    this.config = config;
    this.stateManager = stateManager || new SessionStateManager();
    this.permissionManager = permissionManager || new PermissionManager();
    this.functionalAgentManager = functionalAgentManager;

    // 启用增强消息模式
    contextManager.enableEnhancedMessages();

    // 设置初始状态
    this.stateManager.setState(SessionState.IDLE, 'Agent 初始化完成');

    // 订阅状态变化事件以更新旧的状态字段
    this.stateManager.subscribe((event) => {
      // 更新旧的 status 字段以保持兼容性
      if (event.to === SessionState.THINKING) {
        this.status = 'thinking';
      } else if (event.to === SessionState.EXECUTING || event.to === SessionState.BUSY) {
        this.status = 'running';
      } else if (event.to === SessionState.ERROR) {
        this.status = 'error';
      } else if (event.to === SessionState.IDLE) {
        this.status = 'idle';
      } else if (event.to === SessionState.COMPLETED) {
        this.status = 'completed';
      }

      // 调用用户的回调
      if (this.config.onStatusChange) {
        this.config.onStatusChange(this.status, event.message);
      }
    });
  }

  /**
   * 执行Agent任务
   */
  async execute(userQuery: string): Promise<AgentResult> {
    this.stateManager.setState(SessionState.BUSY, '开始执行任务');
    this.stateManager.setState(SessionState.THINKING, '正在分析任务...');

    const context: AgentContext = {
      iteration: 0,
      toolCalls: [],
      results: [],
      files: [],
      currentPlan: undefined,
    };

    try {
      // 只在第一次执行时设置系统提示词
      const messages = this.contextManager.getContext();
      const hasSystemPrompt = messages.length > 0 && messages[0].role === 'system';

      if (!hasSystemPrompt) {
        const systemPrompt = await this.buildSystemPrompt();
        this.contextManager.setSystemPrompt(systemPrompt);
      }

      // 添加用户查询到上下文
      this.contextManager.addMessage('user', userQuery);

      // 主执行循环
      while (context.iteration < this.config.maxIterations) {
        context.iteration++;

        this.stateManager.setState(SessionState.BUSY, `执行中 (第 ${context.iteration} 轮)...`);

        // 获取当前上下文
        const messages = this.contextManager.getContext();

        // AI 思考阶段
        this.stateManager.setState(SessionState.THINKING, 'AI 思考中...');
        const response = await this.apiAdapter.chat(messages);

        // 解析工具调用
        const toolCalls = this.toolEngine.parseToolCallsFromResponse(response);

        // 从响应中提取纯文本内容（移除工具调用 JSON）
        const cleanResponse = this.extractTextFromResponse(response);

        // 智能检测是否应该结束
        if (this.shouldFinish(response, toolCalls)) {
          this.stateManager.setState(SessionState.COMPLETED, '任务完成');
          this.contextManager.addMessage('assistant', cleanResponse);

          return {
            success: true,
            iterations: context.iteration,
            toolCallsExecuted: context.toolCalls.length,
            finalAnswer: cleanResponse,
          };
        }

        if (toolCalls.length === 0) {
          // 没有工具调用，任务完成
          this.stateManager.setState(SessionState.COMPLETED, '任务完成');
          this.contextManager.addMessage('assistant', cleanResponse);

          return {
            success: true,
            iterations: context.iteration,
            toolCallsExecuted: context.toolCalls.length,
            finalAnswer: cleanResponse,
          };
        }

        // 执行工具调用阶段
        this.stateManager.setState(
          SessionState.EXECUTING,
          `执行 ${toolCalls.length} 个工具调用...`
        );

        const toolResults = await this.executeToolCallsWithApproval(toolCalls);

        // 记录工具调用和结果
        context.toolCalls.push(...toolCalls);
        context.results.push(...toolResults);

        // 将AI的原始响应（包含工具调用）添加到上下文，供 AI 参考工具调用格式
        // 注意：这里保留完整响应是因为 AI 需要知道它之前调用了什么工具
        this.contextManager.addMessage('assistant', response);

        // 将工具执行结果作为用户反馈添加到上下文
        const toolResultMessage = this.formatToolResultsForAI(toolCalls, toolResults);
        this.contextManager.addMessage('user', toolResultMessage);

        // 检查是否所有工具都成功
        const allSuccess = toolResults.every((r) => r.success);
        if (!allSuccess) {
          // 如果有错误，添加额外的错误提示
          const errorHint = '\n\n请分析上述错误，修正后重试。如果需要更多信息，请使用工具获取。';
          this.contextManager.addMessage('user', errorHint);
        }
      }

      // 达到最大迭代次数 - 添加 max-steps 提示
      this.stateManager.setState(
        SessionState.COMPLETED,
        `达到最大迭代次数 (${this.config.maxIterations})`
      );

      // 如果有功能性 Agent 管理器，添加 max-steps 警告
      if (this.functionalAgentManager) {
        const maxStepsWarning = await this.functionalAgentManager.getMaxStepsWarning();

        // 获取当前上下文并添加 max-steps 警告作为用户消息
        const currentContext = this.contextManager.getContext();
        const messagesWithWarning = [
          ...currentContext,
          { role: 'user' as const, content: maxStepsWarning },
        ];

        // 进行最后一次 API 调用，让 AI 生成总结
        const response = await this.apiAdapter.chat(messagesWithWarning);

        this.contextManager.addMessage('assistant', response);

        return {
          success: true,
          iterations: context.iteration,
          toolCallsExecuted: context.toolCalls.length,
          finalAnswer: response,
        };
      }

      return {
        success: true,
        iterations: context.iteration,
        toolCallsExecuted: context.toolCalls.length,
        finalAnswer: '达到最大迭代次数，任务可能未完成',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.stateManager.setState(SessionState.ERROR, errorMsg);

      return {
        success: false,
        iterations: context.iteration,
        toolCallsExecuted: context.toolCalls.length,
        error: errorMsg,
      };
    } finally {
      this.stateManager.setState(SessionState.IDLE, '回到空闲状态');
    }
  }

  /**
   * 执行工具调用（带审批流程和权限检查）
   */
  private async executeToolCallsWithApproval(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      // 1. 检查权限
      const permissionRequest: PermissionRequest = {
        tool: call.tool,
        path: this.extractPathFromParams(call.tool, call.parameters),
        params: call.parameters,
      };

      const permissionResult = this.permissionManager.checkPermission(permissionRequest);

      // 2. 处理权限结果
      if (permissionResult.action === PermissionAction.DENY) {
        results.push({
          success: false,
          error: `权限拒绝: ${permissionResult.reason}`,
        });
        continue;
      }

      // 3. 检查是否需要审批
      let approved = this.config.autoApprove;

      // 如果权限规则要求询问，或者配置了审批回调
      if (permissionResult.action === PermissionAction.ASK || !approved) {
        if (this.config.onToolCall) {
          approved = await this.config.onToolCall(call);
        } else if (permissionResult.action === PermissionAction.ASK) {
          // 如果没有配置回调但权限要求询问，则拒绝
          approved = false;
        }
      }

      if (!approved) {
        results.push({
          success: false,
          error: '工具调用被用户拒绝',
        });
        continue;
      }

      // 记录工具调用开始时间
      const callId = call.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.toolCallStartTime.set(callId, Date.now());

      // 执行工具调用
      const result = await this.toolEngine.executeToolCall(call);

      // 计算执行时长
      const startTime = this.toolCallStartTime.get(callId);
      if (startTime) {
        const duration = Date.now() - startTime;
        result.metadata = {
          ...result.metadata,
          duration,
        };
        this.toolCallStartTime.delete(callId);
      }

      results.push(result);
    }

    return results;
  }

  /**
   * 从工具参数中提取路径（用于权限检查）
   */
  private extractPathFromParams(
    _tool: string,
    params: Record<string, unknown>
  ): string | undefined {
    // 常见的路径参数名
    const pathKeys = ['file_path', 'path', 'filePath', 'pattern', 'glob'];

    for (const key of pathKeys) {
      if (params[key]) {
        return String(params[key]);
      }
    }

    return undefined;
  }

  /**
   * 智能检测是否应该结束任务
   * 参考 opencode 的 finish 状态检测
   */
  private shouldFinish(response: string, toolCalls: ToolCall[]): boolean {
    // 1. 如果有工具调用，继续执行
    if (toolCalls.length > 0) {
      return false;
    }

    // 2. 检测完成关键词
    const completionPatterns = [
      /任务完成/g,
      /已完成/g,
      /完成/g,
      /done/gi,
      /finished/gi,
      /completed/gi,
      /没有问题了/g,
      /就这样/g,
    ];

    const hasCompletionSignal = completionPatterns.some((pattern) => pattern.test(response));
    if (hasCompletionSignal) {
      return true;
    }

    // 3. 检测明确的结束信号（如总结性陈述）
    const endingPatterns = [/总结：?/g, /综上所述/g, /以上就是/g, /简而言之/g];

    const hasEndingSignal = endingPatterns.some((pattern) => pattern.test(response));

    // 4. 检测是否在等待用户输入
    const waitingPatterns = [/需要.*信息/g, /请提供/g, /需要.*确认/g, /是否.*继续/g];

    const hasWaitingSignal = waitingPatterns.some((pattern) => pattern.test(response));

    // 如果有等待信号，说明还没完成
    if (hasWaitingSignal) {
      return false;
    }

    // 如果有结束信号或已经没有工具调用，可能完成了
    return hasEndingSignal || toolCalls.length === 0;
  }

  /**
   * 从 AI 响应中提取纯文本内容
   * 移除工具调用的 JSON 代码块，只保留文本说明
   */
  private extractTextFromResponse(response: string): string {
    // 移除代码块中的工具调用 JSON
    // 匹配 ```json 或 ```tool 后跟 JSON 对象的代码块
    const toolCallPattern = /```(?:json|tool)?\s*\n?\s*\{[\s\S]*?"tool"[\s\S]*?\}\s*```/g;
    let cleaned = response.replace(toolCallPattern, '[工具调用]');

    // 移除独立的 JSON 对象（不在代码块中的）
    const standaloneJsonPattern = /\{[\s\S]*?"tool"\s*:\s*"\w+"[\s\S]*?\}/g;
    cleaned = cleaned.replace(standaloneJsonPattern, '[工具调用]');

    // 清理多余的空行
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
  }

  /**
   * 构建系统提示词
   * 加载外部文件并添加环境信息和工具描述
   */
  private async buildSystemPrompt(): Promise<string> {
    // 从外部文件加载主提示词
    const fs = await import('fs/promises');
    const path = await import('path');

    const promptFile = path.join(process.cwd(), 'src/tools/prompts/default.txt');

    let mainPrompt: string;
    try {
      mainPrompt = await fs.readFile(promptFile, 'utf-8');
    } catch (error) {
      // 回退到硬编码的英文提示词
      mainPrompt = `# AI Coding Assistant

You are an autonomous coding assistant helping users with software engineering tasks.

## Core Principles

1. **Be Concise**: Keep responses under 4 lines (excluding tool calls). No unnecessary pleasantries.
2. **Use Tools**: Always use dedicated tools over bash commands
3. **Think First**: Analyze before acting
4. **Iterate**: Continue until the problem is fully solved
5. **Test**: Verify changes work correctly before concluding

## Tool Strategy

### Priority: Use Dedicated Tools

| Task | Use This | Never Use |
|------|----------|-----------|
| Read files | Read | cat, head, tail |
| Find files | Glob | find |
| Search content | Grep | grep |
| Edit files | Edit | sed, awk |
| Create files | Write | echo, cat > |

**Bash is ONLY for**: tests, builds, git, package management, dev servers

### Key Rules

- **Always Read before Edit**
- **Batch tool calls** in one response for performance
- **Use absolute paths** for file operations

## Workflow

1. **Understand**: Read requirements carefully
2. **Explore**: Use Glob/Grep to find relevant files
3. **Plan**: Break into small, testable steps
4. **Implement**: Make incremental changes
5. **Verify**: Test each change

## Tool Call Format

\`\`\`json
{
  "tool": "ToolName",
  "parameters": {
    "param": "value"
  }
}
\`\`\`

**IMPORTANT**: Always use the exact JSON format above. Never use alternative formats like "ToolName {...}".
**Batch multiple calls in one response.**

## Security

**Only assist with defensive security tasks.**
- Refuse: Malicious code, credential harvesting, unauthorized access
- Allow: Security analysis, detection rules, vulnerability explanation, defense tools

---

**Tool documentation is loaded dynamically. Refer to individual tool descriptions before use.**`;
    }

    // 获取工具描述
    const toolsDescription = await generateToolsDescription();

    // 动态环境信息
    const envInfo = [
      `Working Directory: ${this.config.workingDirectory}`,
      `Platform: ${process.platform}`,
      `Date: ${new Date().toLocaleDateString('en-US')}`,
    ].join('\n');

    // 组合最终提示词
    return `${mainPrompt}

## Environment

${envInfo}

## Available Tools

${toolsDescription}

---

**Remember**: Always use proper JSON format for tool calls!`;
  }

  /**
   * 格式化工具执行结果给AI
   * 简洁格式，避免展示技术细节
   */
  private formatToolResultsForAI(calls: ToolCall[], results: ToolResult[]): string {
    const lines: string[] = [];

    for (let i = 0; i < calls.length; i++) {
      const result = results[i];

      if (result.success) {
        // 成功：只包含输出内容，不显示元数据
        if (result.output) {
          lines.push(result.output);
        }
      } else {
        // 失败：包含错误信息
        lines.push(`错误：${result.error || '工具执行失败'}`);
      }
    }

    return lines.join('\n\n');
  }

  /**
   * 获取会话状态管理器
   */
  getStateManager(): SessionStateManager {
    return this.stateManager;
  }

  /**
   * 获取当前状态（兼容旧代码）
   */
  getStatus(): AgentStatus {
    return this.status;
  }
}

/**
 * 创建Agent编排器实例
 */
export function createAgentOrchestrator(
  apiAdapter: IAPIAdapter,
  toolEngine: ToolEngine,
  contextManager: ContextManager,
  config: AgentExecutionConfig,
  stateManager?: SessionStateManager,
  permissionManager?: PermissionManager
): AgentOrchestrator {
  return new AgentOrchestrator(
    apiAdapter,
    toolEngine,
    contextManager,
    config,
    stateManager,
    permissionManager
  );
}

/**
 * Agent 配置和类型定义
 */

export interface IAgentConfig {
  name: string;
  description: string;
  mode: 'primary' | 'subagent' | 'all';
  systemPrompt?: string;
  temperature?: number;
  maxSteps?: number;
  permissions?: string[];
  hidden?: boolean;
}

/**
 * Agent 注册表
 */
export const AGENTS: Record<string, IAgentConfig> = {
  default: {
    name: 'default',
    description: '默认的 AI 编程助手，可以执行所有操作',
    mode: 'primary',
  },
  explore: {
    name: 'explore',
    description: '代码探索专家，只进行只读操作',
    mode: 'all',
    permissions: ['read', 'glob', 'grep'],
  },
  build: {
    name: 'build',
    description: '构建和部署专家',
    mode: 'primary',
  },
  plan: {
    name: 'plan',
    description: '规划模式，只允许分析和规划，不允许修改代码',
    mode: 'primary',
    permissions: ['read', 'glob', 'grep'],
  },
};

/**
 * Agent 管理器
 */
export class AgentManager {
  private agents: Map<string, IAgentConfig>;

  constructor() {
    this.agents = new Map();
    this.loadDefaultAgents();
  }

  /**
   * 加载默认 agents
   */
  private loadDefaultAgents(): void {
    Object.entries(AGENTS).forEach(([key, config]) => {
      this.agents.set(key, config);
    });
  }

  /**
   * 获取 agent 配置
   */
  getAgent(name: string): IAgentConfig | undefined {
    return this.agents.get(name);
  }

  /**
   * 获取所有 agents
   */
  getAllAgents(): IAgentConfig[] {
    return Array.from(this.agents.values());
  }

  /**
   * 获取可显示的 agents（非隐藏）
   */
  getVisibleAgents(): IAgentConfig[] {
    return this.getAllAgents().filter((agent) => !agent.hidden);
  }

  /**
   * 获取默认 agent
   */
  getDefaultAgent(): IAgentConfig {
    return this.agents.get('default')!;
  }

  /**
   * 添加自定义 agent
   */
  addAgent(config: IAgentConfig): void {
    this.agents.set(config.name, config);
  }

  /**
   * 加载 agent 的系统提示词
   */
  async loadAgentPrompt(agentName: string): Promise<string> {
    const agent = this.getAgent(agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`);
    }

    // 如果 agent 有自定义的 systemPrompt，使用它
    if (agent.systemPrompt) {
      return agent.systemPrompt;
    }

    // 优先尝试使用打包的提示词
    const { hasPackedPrompts, getProjectPrompt } = await import('../utils/packed-prompts');
    if (hasPackedPrompts()) {
      const packedPrompt = getProjectPrompt(agentName);
      if (packedPrompt) {
        return packedPrompt;
      }
    }

    // 回退到文件读取（开发环境）
    const fs = await import('fs/promises');
    const fsSync = await import('fs');
    const path = await import('path');

    // 检测运行环境：开发环境还是生产环境
    const isDev = fsSync.existsSync(path.join(process.cwd(), 'src'));
    const projectPromptsBasePath = path.join(process.cwd(), isDev ? 'src/prompts' : 'dist/prompts');

    const promptFile = path.join(projectPromptsBasePath, `${agentName}.txt`);

    try {
      const content = await fs.readFile(promptFile, 'utf-8');
      return content;
    } catch (error) {
      // 如果找不到文件，使用默认提示词
      const defaultPromptFile = path.join(projectPromptsBasePath, 'default.txt');
      try {
        const content = await fs.readFile(defaultPromptFile, 'utf-8');
        return content;
      } catch (defaultError) {
        // 如果连默认文件都没有，返回硬编码的提示词
        return this.getDefaultPrompt();
      }
    }
  }

  /**
   * 获取默认提示词
   */
  private getDefaultPrompt(): string {
    return `You are an AI programming assistant, similar to Claude Code. You can autonomously execute various programming tasks.

## 🚨 Important: You must use tools

**Key Rule**: When users ask you to perform operations (like reading files, modifying code, running commands, etc.), you **must** use the tool call format.

## Available Tools

### 1. Read - Read files
Read file contents, supports paginated reading.

### 2. Write - Write files (create new files)
Create new files or completely overwrite existing files.

### 3. Edit - Edit files (modify existing files)
Perform precise string replacements on files.

### 4. Glob - Find files
Find files using glob patterns.

### 5. Grep - Search code
Search for specific content in files, supports regular expressions.

### 6. Bash - Execute commands
Execute shell commands for running tests, building, git operations, etc.

### 7. MakeDirectory - Create directories
Create directories (folders), supports recursive creation of multi-level directories.

## Tool Call Format

Use the following format to call tools:

\`\`\`json
{
  "tool": "ToolName",
  "parameters": {
    "parameter_name": "parameter_value"
  }
}
\`\`\`

You can call multiple tools at once.

## Key Tips

1. **Use tools for every operation** - Reading, writing, editing, searching must all use tool calls
2. **Tool calls must be in code blocks** - Place JSON in \`\`\`json...\`\`\` code blocks
3. **You can call multiple tools at once** - Include multiple tool calls in your response
4. **Read before Edit** - Use Read to view content before modifying files
5. **Explain your plan** - Explain what you're going to do before making tool calls
6. **Report results** - Report the results after tool execution

## Common Task Examples

### Create Directory
User: "Create test directory"
You:
\`\`\`json
{
  "tool": "MakeDirectory",
  "parameters": {
    "path": "test"
  }
}
\`\`\`

### Read File
User: "Read package.json"
You:
\`\`\`json
{
  "tool": "Read",
  "parameters": {
    "file_path": "package.json"
  }
}
\`\`\`

### Create File
User: "Create hello.ts"
You:
\`\`\`json
{
  "tool": "Write",
  "parameters": {
    "file_path": "hello.ts",
    "content": "console.log('Hello World');"
  }
}
\`\`\`

Now, please help users complete their programming tasks. Remember: when users ask you to perform operations, you must use the tool call format!`;
  }
}

/**
 * 全局 Agent 管理器实例
 */
let agentManagerInstance: AgentManager | null = null;

export function getAgentManager(): AgentManager {
  if (!agentManagerInstance) {
    agentManagerInstance = new AgentManager();
  }
  return agentManagerInstance;
}
