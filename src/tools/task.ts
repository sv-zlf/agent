/**
 * GG CODE - Task Tool
 * 启动专门的 agent 处理复杂的多步骤任务
 * 当前主要支持 explore（代码探索）子 agent
 */

import * as z from 'zod';
import { defineTool, type ToolExecuteResult } from './tool';
import { getAgentManager } from '../core/agent';
import { createSessionManager, type Session } from '../core/session-manager';
import { createContextManager, type ContextManager } from '../core/context-manager';
import { createAPIAdapter } from '../api';
import { createToolEngine, ToolEngine } from '../core/tool-engine';
import { createAgentOrchestrator, type AgentExecutionConfig } from '../core/agent';
import { getConfig } from '../config';
import { PermissionManager, PermissionAction, PermissionPresets } from '../core/permissions';
import { getBuiltinTools } from './index';

export interface TaskMetadata {
  sessionId: string;
  subagentType: string;
  description: string;
  summary?: Array<{
    id: string;
    tool: string;
    state: {
      status: string;
      title?: string;
    };
  }>;
}

const TaskParameters = z.object({
  description: z.string().describe('任务的简短描述（3-5个词）'),
  prompt: z.string().describe('agent 要执行的具体任务'),
  subagent_type: z.string().describe('子 agent 类型').default('explore'),
  session_id: z.string().describe('继续现有任务会话').optional(),
});

async function registerSubagentTools(toolEngine: ToolEngine, subagentType: string): Promise<void> {
  const tools = await getBuiltinTools();

  const allowedTools = getAllowedToolsForAgent(subagentType);

  const filteredTools = tools.filter((tool) => {
    const toolName = tool.name
      .toLowerCase()
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase();
    return allowedTools.includes(toolName) || allowedTools.includes('*');
  });

  toolEngine.registerTools(filteredTools);
}

function getAllowedToolsForAgent(agentType: string): string[] {
  const agentConfigs: Record<string, string[]> = {
    explore: ['read', 'glob', 'grep', 'bash'],
    default: [
      'read',
      'write',
      'edit',
      'glob',
      'grep',
      'bash',
      'task',
      'todowrite',
      'todoread',
      'batch',
      'multiedit',
    ],
    build: ['read', 'write', 'edit', 'bash', 'todowrite', 'todoread'],
    plan: ['read', 'glob', 'grep'],
  };

  return agentConfigs[agentType] || agentConfigs['default'];
}

function configureSubagentPermissions(
  permissionManager: PermissionManager,
  subagentType: string
): void {
  switch (subagentType) {
    case 'explore':
      permissionManager.addRules(PermissionPresets.explore);
      break;
    case 'plan':
      permissionManager.addRules([
        { tool: 'Read', pattern: '*', action: PermissionAction.ALLOW },
        { tool: 'Glob', pattern: '*', action: PermissionAction.ALLOW },
        { tool: 'Grep', pattern: '*', action: PermissionAction.ALLOW },
        { tool: '*', pattern: '*', action: PermissionAction.DENY },
      ]);
      break;
    default:
      permissionManager.setDefaultAction(PermissionAction.ALLOW);
  }
}

export const TaskTool = defineTool('task', {
  description: `启动专门的 agent 来处理复杂、多步骤的任务。

**主要用途**：代码探索和搜索

子 agent 类型:
- \`explore\`: 代码探索专家，只进行只读操作（读取、搜索、分析）

使用场景:
- 深入探索代码库结构
- 系统性地审查代码
- 查找特定功能或模式

**说明**: GG CODE 当前仅支持 \`explore\` 子 agent（参考 OpenCode 实现）。未来可扩展支持 \`general\`（通用研究）等更多类型。`,
  parameters: TaskParameters,
  async execute(args, ctx): Promise<ToolExecuteResult<TaskMetadata>> {
    const { description, prompt, subagent_type, session_id } = args;

    const agentManager = getAgentManager();
    const config = getConfig();
    const apiConfig = config.getAPIConfig();
    const agentConfig = config.getAgentConfig();

    const agent = agentManager.getAgent(subagent_type);
    if (!agent) {
      return {
        title: 'Unknown Agent Type',
        output: `Unknown agent type: ${subagent_type}. Currently only 'explore' is supported.`,
        metadata: {
          sessionId: '',
          subagentType: subagent_type,
          description,
        },
      };
    }

    const sessionManager = createSessionManager();
    await sessionManager.initialize();

    let session: Session;
    let subagentContextManager: ContextManager;

    if (session_id) {
      const existingSession = Array.from(sessionManager.getAllSessions()).find(
        (s) => s.id === session_id
      );
      if (existingSession) {
        session = existingSession;
        subagentContextManager = createContextManager(
          agentConfig.max_history,
          agentConfig.max_context_tokens,
          session.contextFile
        );
        await subagentContextManager.loadHistory();
      } else {
        session = await sessionManager.createSession(
          `${description} (@${subagent_type})`,
          subagent_type
        );
        subagentContextManager = createContextManager(
          agentConfig.max_history,
          agentConfig.max_context_tokens,
          session.contextFile
        );
      }
    } else {
      session = await sessionManager.createSession(
        `${description} (@${subagent_type})`,
        subagent_type
      );
      subagentContextManager = createContextManager(
        agentConfig.max_history,
        agentConfig.max_context_tokens,
        session.contextFile
      );
    }

    ctx.metadata({
      title: description,
      metadata: {
        sessionId: session.id,
        subagentType: subagent_type,
        description,
      },
    });

    const parentContext = subagentContextManager.getRawMessages();
    const lastMessages = parentContext.slice(-20);
    const systemPrompt = await agentManager.loadAgentPrompt(subagent_type);

    subagentContextManager.clearContext();
    subagentContextManager.setSystemPrompt(systemPrompt);

    for (const msg of lastMessages) {
      if (msg.role === 'system') continue;
      subagentContextManager.addMessage(
        msg.role as 'user' | 'assistant',
        'content' in msg ? msg.content : ''
      );
    }

    const userPrompt = `## 主任务\n${prompt}\n\n## 背景信息\n这是从主会话传递过来的任务。请完成上述任务，并在最后提供清晰的总结。`;

    subagentContextManager.addMessage('user', userPrompt);

    const apiAdapter = createAPIAdapter(apiConfig);
    const toolEngine = createToolEngine();

    await registerSubagentTools(toolEngine, subagent_type);

    const permissionManager = new PermissionManager();
    configureSubagentPermissions(permissionManager, subagent_type);

    const execConfig: AgentExecutionConfig = {
      workingDirectory: process.cwd(),
      maxIterations: agent.maxSteps || 20,
      autoApprove: true,
      dangerousCommands: [],
    };

    const orchestrator = createAgentOrchestrator(
      apiAdapter,
      toolEngine,
      subagentContextManager,
      execConfig,
      undefined,
      permissionManager
    );

    let subagentResult: Awaited<ReturnType<typeof orchestrator.execute>>;
    try {
      subagentResult = await orchestrator.execute(prompt);
    } finally {
      await subagentContextManager.saveHistory();
    }

    const messages = subagentContextManager.getRawMessages();
    const assistantMessages = messages.filter((m) => m.role === 'assistant');

    const summary = assistantMessages.flatMap((msg: any) => {
      if ('parts' in msg) {
        return msg.parts
          .filter((p: any) => p.type === 'tool')
          .map((p: any) => ({
            id: p.id,
            tool: p.tool,
            state: {
              status: p.state?.status || 'completed',
              title: p.state?.status === 'completed' ? p.state?.title : undefined,
            },
          }));
      }
      return [];
    });

    const finalOutput = subagentResult.finalAnswer || subagentResult.error || '任务执行完成';

    return {
      title: description,
      output: `${finalOutput}\n\n<task_metadata>\nsession_id: ${session.id}\n</task_metadata>`,
      metadata: {
        sessionId: session.id,
        subagentType: subagent_type,
        description,
        summary,
      },
    };
  },
});
