/**
 * GG CODE - Task Tool
 * 启动专门的 agent 处理复杂的多步骤任务
 */

import * as z from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { defineTool } from './tool';
import { readFileSync } from 'fs';

export const TaskTool = defineTool('task', {
  description: '启动专门的 agent 来处理复杂、多步骤的任务。可用于代码探索、代码审查等专门任务。',
  parameters: z.object({
    description: z.string().describe('任务的简短描述（3-5个词）'),
    prompt: z.string().describe('agent 要执行的具体任务'),
    subagent_type: z.string().describe('要使用的专门 agent 类型 (explore)'),
  }),
  async execute(args, ctx) {
    const { description, prompt, subagent_type } = args;

    // 验证 subagent_type
    const validAgents = ['explore'];
    if (!validAgents.includes(subagent_type)) {
      return {
        title: 'Invalid Agent Type',
        output: `Unknown agent type: ${subagent_type}. Valid types: ${validAgents.join(', ')}`,
        metadata: { error: true },
      };
    }

    // 读取 agent prompt
    let agentPrompt = '';
    try {
      const promptPath = path.join(process.cwd(), 'src/tools/prompts', `${subagent_type}.txt`);
      agentPrompt = readFileSync(promptPath, 'utf-8');
    } catch (error) {
      return {
        title: 'Agent Not Found',
        output: `Agent prompt file not found for: ${subagent_type}`,
        metadata: { error: true },
      };
    }

    // 模拟 agent 执行（这里应该调用实际的 agent 系统）
    // 在简化版本中，我们返回一个提示告诉用户这个功能需要进一步实现
    const result = `
[Task: ${description}]
[Agent: ${subagent_type}]

任务说明：
${prompt}

Agent 提示词：
${agentPrompt.substring(0, 200)}...

注意：完整的 Task 工具实现需要：
1. 创建独立的 agent 会话
2. 继承父会话的权限和上下文
3. 执行完成后返回结果给主 agent
4. 关闭 agent 会话

这是一个简化版本，完整的实现需要集成到 agent orchestrator 中。
    `.trim();

    return {
      title: `Task: ${description}`,
      output: result,
      metadata: {
        subagent: subagent_type,
        description,
        status: 'completed',
      },
    };
  },
});
