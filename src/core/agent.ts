import type { Message, ToolCall, ToolResult, AgentRuntimeConfig, AgentContext, AgentStatus } from '../types';
import { PartType, createMessage, createToolCallPart, createToolResultPart, messageToText } from '../types/message';
import { ToolEngine } from './tool-engine';
import { ChatAPIAdapter } from '../api';
import { ContextManager } from './context-manager';
import { SessionStateManager, SessionState } from './session-state';
import { PermissionManager, PermissionAction, type PermissionRequest } from './permissions';
import { createLogger } from '../utils';

const logger = createLogger(true);

/**
 * Agent执行配置
 */
interface AgentExecutionConfig extends AgentRuntimeConfig {
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
  private apiAdapter: ChatAPIAdapter;
  private toolEngine: ToolEngine;
  private contextManager: ContextManager;
  private config: AgentExecutionConfig;
  private status: AgentStatus = 'idle';
  private toolCallStartTime: Map<string, number> = new Map(); // 跟踪工具调用开始时间
  private stateManager: SessionStateManager; // 会话状态管理器
  private permissionManager: PermissionManager; // 权限管理器

  constructor(
    apiAdapter: ChatAPIAdapter,
    toolEngine: ToolEngine,
    contextManager: ContextManager,
    config: AgentExecutionConfig,
    stateManager?: SessionStateManager,
    permissionManager?: PermissionManager
  ) {
    this.apiAdapter = apiAdapter;
    this.toolEngine = toolEngine;
    this.contextManager = contextManager;
    this.config = config;
    this.stateManager = stateManager || new SessionStateManager();
    this.permissionManager = permissionManager || new PermissionManager();

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
        const systemPrompt = this.buildSystemPrompt();
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
        this.stateManager.setState(SessionState.EXECUTING, `执行 ${toolCalls.length} 个工具调用...`);

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

      // 达到最大迭代次数
      this.stateManager.setState(SessionState.COMPLETED, `达到最大迭代次数 (${this.config.maxIterations})`);

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
  private extractPathFromParams(tool: string, params: Record<string, unknown>): string | undefined {
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

    const hasCompletionSignal = completionPatterns.some(pattern => pattern.test(response));
    if (hasCompletionSignal) {
      return true;
    }

    // 3. 检测明确的结束信号（如总结性陈述）
    const endingPatterns = [
      /总结：?/g,
      /综上所述/g,
      /以上就是/g,
      /简而言之/g,
    ];

    const hasEndingSignal = endingPatterns.some(pattern => pattern.test(response));

    // 4. 检测是否在等待用户输入
    const waitingPatterns = [
      /需要.*信息/g,
      /请提供/g,
      /需要.*确认/g,
      /是否.*继续/g,
    ];

    const hasWaitingSignal = waitingPatterns.some(pattern => pattern.test(response));

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
   * 使用简洁格式，避免硬编码
   */
  private buildSystemPrompt(): string {
    const toolsDescription = this.toolEngine.generateToolsDescription();

    // 动态环境信息
    const envInfo = [
      `工作目录: ${this.config.workingDirectory}`,
      `平台: ${process.platform}`,
      `日期: ${new Date().toLocaleDateString('zh-CN')}`,
    ].join('\n');

    return `# GG CODE - AI编程助手

你是一个AI编程助手，可以帮助用户完成各种编程任务。

## 环境信息

${envInfo}

## 可用工具

${toolsDescription}

## 工具调用格式

当你需要使用工具时，请使用以下JSON格式：

\`\`\`json
{
  "tool": "工具名称",
  "parameters": {
    "参数名": "参数值"
  }
}
\`\`\`

## 重要提示

1. **优先使用工具** - 读取、写入、编辑、搜索文件时必须使用对应的工具
2. **工具调用用代码块** - 将工具调用JSON放在\`\`\`json...\`\`\`代码块中
3. **可并行调用** - 可以在一次响应中调用多个工具
4. **先读后改** - 修改文件前先用 Read 工具查看内容
5. **说明计划** - 在工具调用前简要说明要做什么
6. **报告结果** - 工具执行后向用户说明结果

现在，请帮助用户完成任务。`;
  }

  /**
   * 格式化工具调用结果用于上下文
   */
  private formatToolCallsForContext(calls: ToolCall[], results: ToolResult[]): string {
    const lines: string[] = ['我执行了以下工具调用：'];

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const result = results[i];

      lines.push(`\n工具: ${call.tool}`);
      lines.push(`参数: ${JSON.stringify(call.parameters)}`);

      if (result.success) {
        lines.push(`结果: ${result.output || '成功'}`);
        if (result.metadata) {
          lines.push(`元数据: ${JSON.stringify(result.metadata)}`);
        }
      } else {
        lines.push(`错误: ${result.error}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 格式化工具执行结果给AI
   * 简洁格式，避免展示技术细节
   */
  private formatToolResultsForAI(calls: ToolCall[], results: ToolResult[]): string {
    const lines: string[] = [];

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
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
   * 格式化工具错误
   */
  private formatToolErrors(results: ToolResult[]): string {
    const errors = results.filter((r) => !r.success);

    if (errors.length === 0) {
      return '所有工具调用成功。请继续完成任务。';
    }

    const lines: string[] = ['以下工具调用失败：'];

    errors.forEach((result, i) => {
      lines.push(`${i + 1}. ${result.error}`);
    });

    lines.push('\n请分析错误原因，并尝试修正后重新执行。');

    return lines.join('\n');
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
  apiAdapter: ChatAPIAdapter,
  toolEngine: ToolEngine,
  contextManager: ContextManager,
  config: AgentExecutionConfig,
  stateManager?: SessionStateManager,
  permissionManager?: PermissionManager
): AgentOrchestrator {
  return new AgentOrchestrator(apiAdapter, toolEngine, contextManager, config, stateManager, permissionManager);
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
    return this.getAllAgents().filter(agent => !agent.hidden);
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

    // 否则尝试从 prompts 目录加载
    const fs = await import('fs/promises');
    const path = await import('path');

    const promptFile = path.join(process.cwd(), 'prompts', `${agentName}.txt`);

    try {
      const content = await fs.readFile(promptFile, 'utf-8');
      return content;
    } catch (error) {
      // 如果找不到文件，使用默认提示词
      const defaultPromptFile = path.join(process.cwd(), 'prompts', 'default.txt');
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
    return `你是一个AI编程助手，类似于Claude Code。你可以自主执行各种编程任务。

## 🚨 重要：你必须使用工具

**关键规则**：当用户要求你执行操作（如读取文件、修改代码、运行命令等）时，你**必须**使用工具调用格式。

## 可用工具

### 1. Read - 读取文件
读取文件内容，支持分页读取。

### 2. Write - 写入文件（创建新文件）
创建新文件或完全覆盖现有文件。

### 3. Edit - 编辑文件（修改现有文件）
对文件执行精确的字符串替换。

### 4. Glob - 查找文件
使用glob模式查找文件。

### 5. Grep - 搜索代码
在文件中搜索特定内容，支持正则表达式。

### 6. Bash - 执行命令
执行shell命令，用于运行测试、构建、git操作等。

### 7. MakeDirectory - 创建目录
创建目录（文件夹），支持递归创建多级目录。

## 工具调用格式

使用以下格式调用工具：

\`\`\`json
{
  "tool": "工具名称",
  "parameters": {
    "参数名": "参数值"
  }
}
\`\`\`

可以一次调用多个工具。

## 关键提示

1. **每次操作都要用工具** - 读取、写入、编辑、搜索都必须用工具调用
2. **工具调用必须用代码块** - 将JSON放在\`\`\`json...\`\`\`代码块中
3. **可以一次调用多个工具** - 在响应中包含多个工具调用
4. **先Read再Edit** - 修改文件前先用Read查看内容
5. **说明你的计划** - 在工具调用前解释你要做什么
6. **报告结果** - 工具执行后说明结果

## 常见任务示例

### 创建目录
用户: "创建test目录"
你:
\`\`\`json
{
  "tool": "MakeDirectory",
  "parameters": {
    "path": "test"
  }
}
\`\`\`

### 读取文件
用户: "读取package.json"
你:
\`\`\`json
{
  "tool": "Read",
  "parameters": {
    "file_path": "package.json"
  }
}
\`\`\`

### 创建文件
用户: "创建hello.ts"
你:
\`\`\`json
{
  "tool": "Write",
  "parameters": {
    "file_path": "hello.ts",
    "content": "console.log('Hello World');"
  }
}
\`\`\`

现在，请帮助用户完成他们的编程任务。记住：当用户要求你执行操作时，必须使用工具调用格式！`;
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
