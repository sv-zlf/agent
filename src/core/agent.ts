import type { Message, ToolCall, ToolResult, AgentRuntimeConfig, AgentContext, AgentStatus } from '../types';
import { ToolEngine } from './tool-engine';
import { ChatAPIAdapter } from '../api';
import { ContextManager } from './context-manager';
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

  constructor(
    apiAdapter: ChatAPIAdapter,
    toolEngine: ToolEngine,
    contextManager: ContextManager,
    config: AgentExecutionConfig
  ) {
    this.apiAdapter = apiAdapter;
    this.toolEngine = toolEngine;
    this.contextManager = contextManager;
    this.config = config;
  }

  /**
   * 执行Agent任务
   */
  async execute(userQuery: string): Promise<AgentResult> {
    this.updateStatus('thinking', '正在分析任务...');

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

        this.updateStatus('running', `执行中 (第 ${context.iteration} 轮)...`);

        // 获取当前上下文
        const messages = this.contextManager.getContext();

        // 调用AI API
        const response = await this.apiAdapter.chat(messages);

        // 解析工具调用
        const toolCalls = this.toolEngine.parseToolCallsFromResponse(response);

        if (toolCalls.length === 0) {
          // 没有工具调用，任务完成
          this.updateStatus('completed', '任务完成');
          this.contextManager.addMessage('assistant', response);

          return {
            success: true,
            iterations: context.iteration,
            toolCallsExecuted: context.toolCalls.length,
            finalAnswer: response,
          };
        }

        // 执行工具调用
        this.updateStatus('running', `执行 ${toolCalls.length} 个工具调用...`);

        const toolResults = await this.executeToolCallsWithApproval(toolCalls);

        // 记录工具调用和结果
        context.toolCalls.push(...toolCalls);
        context.results.push(...toolResults);

        // 将AI的原始响应添加到上下文（包含工具调用请求）
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
      this.updateStatus('completed', `达到最大迭代次数 (${this.config.maxIterations})`);

      return {
        success: true,
        iterations: context.iteration,
        toolCallsExecuted: context.toolCalls.length,
        finalAnswer: '达到最大迭代次数，任务可能未完成',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.updateStatus('error', errorMsg);

      return {
        success: false,
        iterations: context.iteration,
        toolCallsExecuted: context.toolCalls.length,
        error: errorMsg,
      };
    } finally {
      this.updateStatus('idle');
    }
  }

  /**
   * 执行工具调用（带审批流程）
   */
  private async executeToolCallsWithApproval(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      // 检查是否需要审批
      let approved = this.config.autoApprove;

      if (!approved && this.config.onToolCall) {
        approved = await this.config.onToolCall(call);
      }

      if (!approved) {
        results.push({
          success: false,
          error: '工具调用被用户拒绝',
        });
        continue;
      }

      // 执行工具调用
      const result = await this.toolEngine.executeToolCall(call);
      results.push(result);
    }

    return results;
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(): string {
    const toolsDescription = this.toolEngine.generateToolsDescription();

    return `你是一个AI编程助手，可以帮助用户完成各种编程任务。你有以下工具可以使用：

${toolsDescription}

## 工具使用指南

1. **在阅读文件前，你应该先使用 Glob 工具查找文件位置**
2. **优先使用 Read 工具阅读文件，而不是 Write**
3. **只在需要修改现有文件时使用 Edit 工具**
4. **只在创建新文件或完全覆盖文件时使用 Write 工具**
5. **使用 Grep 工具在代码中搜索特定内容**
6. **使用 Bash 工具运行测试、构建项目、git操作等**

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

你可以一次性调用多个工具，每个工具调用使用一个JSON代码块。

## 工作流程

1. 理解用户的需求
2. 使用 Glob 工具查找相关文件
3. 使用 Read 工具阅读文件内容
4. 使用 Edit 工具修改文件（如果需要）
5. 使用 Bash 工具运行测试或构建（如果需要）
6. 向用户报告结果

## 重要注意事项

- 在修改文件之前，先阅读文件内容
- 确保你的修改是准确的，使用完整的字符串匹配
- 如果遇到错误，尝试分析原因并重新尝试
- 在完成任务后，向用户提供清晰的总结
- 工作目录: ${this.config.workingDirectory}

现在，请帮助用户完成他们的任务。`;
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
   */
  private formatToolResultsForAI(calls: ToolCall[], results: ToolResult[]): string {
    const lines: string[] = ['工具执行结果：\n'];

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const result = results[i];

      lines.push(`**${call.tool}**`);
      if (result.success) {
        // 如果输出太长，截断它
        let output = result.output || '';
        if (output.length > 2000) {
          output = output.substring(0, 2000) + '\n... (内容过长，已截断)';
        }
        lines.push(`✓ 成功`);
        if (output) {
          lines.push(`\n${output}`);
        }
        if (result.metadata) {
          const metadataStr = JSON.stringify(result.metadata, null, 2);
          if (metadataStr.length < 500) {
            lines.push(`\n元数据: ${metadataStr}`);
          }
        }
      } else {
        lines.push(`✗ 失败: ${result.error}`);
      }
      lines.push(''); // 空行分隔
    }

    return lines.join('\n');
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
   * 更新状态
   */
  private updateStatus(status: AgentStatus, message?: string): void {
    this.status = status;

    if (this.config.onStatusChange) {
      this.config.onStatusChange(status, message);
    }

    if (message) {
      logger.info(`[Agent ${status}] ${message}`);
    }
  }

  /**
   * 获取当前状态
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
  config: AgentExecutionConfig
): AgentOrchestrator {
  return new AgentOrchestrator(apiAdapter, toolEngine, contextManager, config);
}
