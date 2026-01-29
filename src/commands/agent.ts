import { Command } from 'commander';
import * as path from 'path';
import chalk from 'chalk';
import ora = require('ora');
import inquirer from 'inquirer';
import { getConfig } from '../config';
import { createAPIAdapter } from '../api';
import { createToolEngine, createAgentOrchestrator, createContextManager } from '../core';
import { builtinTools } from '../tools';
import { createLogger } from '../utils';
import type { ToolCall, AgentStatus } from '../types';

const logger = createLogger();

/**
 * agent命令 - 自主编程助手
 */
export const agentCommand = new Command('agent')
  .description('AI自主编程助手（类似Claude Code）')
  .option('-y, --yes', '自动批准所有工具调用', false)
  .option('-i, --iterations <number>', '最大迭代次数', '10')
  .option('--no-history', '不保存对话历史')
  .action(async (options) => {
    const config = getConfig();
    await config.load();

    const validation = config.validate();
    if (!validation.valid) {
      logger.error('配置无效:');
      validation.errors.forEach((err) => console.log(`  • ${err}`));
      return;
    }

    // 创建核心组件
    const apiAdapter = createAPIAdapter(config.getAPIConfig());
    const toolEngine = createToolEngine();

    // 注册所有内置工具
    toolEngine.registerTools(builtinTools);

    const agentConfig = config.getAgentConfig();
    const contextManager = createContextManager(
      agentConfig.max_history,
      agentConfig.max_context_tokens
    );

    // 加载历史记录
    if (options.history) {
      await contextManager.loadHistory();
    }

    // 显示标题
    logger.title('AI自主编程助手');
    logger.info('可以执行文件操作、代码搜索、命令执行等任务');
    logger.info('输入 "exit" 或 "quit" 退出\n');

    // 获取当前工作目录
    const workingDirectory = process.cwd();

    // 创建Agent编排器
    const orchestrator = createAgentOrchestrator(
      apiAdapter,
      toolEngine,
      contextManager,
      {
        maxIterations: parseInt(options.iterations, 10),
        autoApprove: options.yes,
        dangerousCommands: ['rm -rf', 'del /q', 'format'],
        workingDirectory,
        onToolCall: async (call: ToolCall) => {
          if (options.yes) {
            return true;
          }

          // 交互式审批
          console.log('\n' + chalk.yellow('📋 工具调用请求:'));
          console.log(chalk.cyan(`  工具: ${call.tool}`));
          console.log(chalk.gray(`  参数: ${JSON.stringify(call.parameters, null, 2)}`));

          const answer = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'approve',
              message: '是否批准此工具调用?',
              default: true,
            },
          ]);

          return answer.approve;
        },
        onStatusChange: (status: AgentStatus, message?: string) => {
          if (message) {
            switch (status) {
              case 'thinking':
                console.log(chalk.blue(`\n🤔 ${message}`));
                break;
              case 'running':
                console.log(chalk.gray(`⚙️  ${message}`));
                break;
              case 'completed':
                console.log(chalk.green(`\n✅ ${message}`));
                break;
              case 'error':
                console.log(chalk.red(`\n❌ ${message}`));
                break;
            }
          }
        },
      }
    );

    // 启动交互式循环
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // 设置系统提示词（只设置一次）
    const systemPrompt = `
你是一个AI编程助手，类似于Claude Code。你可以自主执行各种编程任务。

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

现在，请帮助用户完成他们的编程任务。记住：当用户要求你执行操作时，必须使用工具调用格式！
`;

    contextManager.setSystemPrompt(systemPrompt);

    const chatLoop = async () => {
      rl.question(chalk.cyan('You: '), async (input: string) => {
        if (!input.trim()) {
          chatLoop();
          return;
        }

        // 处理特殊命令
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          if (options.history) {
            await contextManager.saveHistory();
          }
          rl.close();
          logger.info('再见！');
          process.exit(0);
          return;
        }

        if (input.toLowerCase() === 'clear') {
          contextManager.clearContext();
          contextManager.setSystemPrompt(systemPrompt); // 重新设置系统提示词
          logger.success('上下文已清空\n');
          chatLoop();
          return;
        }

        // 显示工具列表命令
        if (input.toLowerCase() === 'tools') {
          console.log(chalk.yellow('\n📦 可用工具列表:\n'));
          const tools = toolEngine.getAllTools();
          tools.forEach((tool) => {
            console.log(chalk.cyan(`  ${tool.name}`));
            console.log(chalk.gray(`    ${tool.description}`));
            console.log();
          });
          chatLoop();
          return;
        }

        try {
          // 添加用户消息到上下文
          contextManager.addMessage('user', input);

          // 持续对话循环：AI响应 -> 检查工具调用 -> 执行工具 -> 继续对话
          let maxToolRounds = parseInt(options.iterations, 10);
          let currentRound = 0;

          while (currentRound < maxToolRounds) {
            currentRound++;

            try {
              // 获取当前上下文并调用AI
              const messages = contextManager.getContext();
              const spinner = ora('AI思考中...').start();

              const response = await apiAdapter.chat(messages);
              spinner.stop();

              // 解析工具调用
              const toolCalls = toolEngine.parseToolCallsFromResponse(response);

              if (toolCalls.length === 0) {
                // 没有工具调用，这是最终答案
                contextManager.addMessage('assistant', response);
                console.log(chalk.green('AI:'), response);
                console.log();
                break; // 退出工具调用循环，等待用户输入
              }

              // 有工具调用，显示AI的响应
              console.log(chalk.green('AI:'), response);
              console.log();

              // 执行工具调用
              console.log(chalk.gray(`⚙️  执行 ${toolCalls.length} 个工具调用...`));

              const toolResults: any[] = [];
              for (const call of toolCalls) {
                try {
                  // 显示工具调用
                  console.log(chalk.yellow(`\n📋 工具调用:`));
                  console.log(chalk.cyan(`  工具: ${call.tool}`));
                  console.log(chalk.gray(`  参数: ${JSON.stringify(call.parameters, null, 2)}`));

                  // 询问是否批准（如果不是自动批准模式）
                  let approved = options.yes;
                  if (!approved) {
                    const answer = await inquirer.prompt([
                      {
                        type: 'confirm',
                        name: 'approve',
                        message: '是否批准此工具调用?',
                        default: true,
                      },
                    ]);
                    approved = answer.approve;
                  }

                  if (!approved) {
                    toolResults.push({
                      success: false,
                      error: '用户拒绝了工具调用',
                    });
                    console.log(chalk.red('  ✗ 已拒绝'));
                    continue;
                  }

                  // 执行工具
                  const result = await toolEngine.executeToolCall(call);
                  toolResults.push(result);

                  if (result.success) {
                    console.log(chalk.green('  ✓ 成功'));
                    if (result.output && result.output.length < 500) {
                      console.log(chalk.gray(`  输出: ${result.output.substring(0, 200)}${result.output.length > 200 ? '...' : ''}`));
                    }
                  } else {
                    console.log(chalk.red(`  ✗ 失败: ${result.error}`));
                  }
                } catch (toolError) {
                  // 单个工具执行失败，继续其他工具
                  toolResults.push({
                    success: false,
                    error: `工具执行异常: ${(toolError as Error).message}`,
                  });
                  console.log(chalk.red(`  ✗ 异常: ${(toolError as Error).message}`));
                }
              }

              // 将AI的原始响应添加到上下文
              contextManager.addMessage('assistant', response);

              // 将工具执行结果作为用户反馈添加到上下文
              const toolResultMessage = formatToolResults(toolCalls, toolResults);
              contextManager.addMessage('user', toolResultMessage);

              // 检查是否所有工具都成功
              const allSuccess = toolResults.every((r) => r.success);
              if (!allSuccess) {
                // 如果有错误，添加额外的错误提示
                contextManager.addMessage('user', '\n\n请分析上述错误，修正后重试。');
              }

              console.log(); // 空行分隔
            } catch (roundError) {
              // 单轮工具调用出错，记录错误并继续
              console.log(chalk.red(`\n❌ 工具调用轮次错误: ${(roundError as Error).message}`));
              console.log();

              // 将错误信息添加到上下文，让AI知道发生了什么
              contextManager.addMessage('user', `\n\n执行过程中发生错误: ${(roundError as Error).message}`);
              break; // 出错后退出工具调用循环
            }
          }

          // 显示本轮对话的统计
          if (currentRound > 0) {
            console.log(chalk.gray(`📊 本轮执行了 ${currentRound} 轮工具调用\n`));
          }
        } catch (error) {
          console.log(chalk.red(`\n❌ 错误: ${(error as Error).message}`));
          console.log(chalk.gray(`\nStack: ${(error as Error).stack}`));
          console.log();
        }

        // 继续下一轮对话
        chatLoop();
      });
    };

    // 辅助函数：格式化工具结果
    const formatToolResults = (calls: any[], results: any[]): string => {
      const lines: string[] = ['\n工具执行结果：\n'];

      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        const result = results[i];

        lines.push(`**${call.tool}**`);
        if (result.success) {
          let output = result.output || '';
          if (output.length > 2000) {
            output = output.substring(0, 2000) + '\n... (内容过长，已截断)';
          }
          lines.push(`✓ 成功`);
          if (output) {
            lines.push(`\n${output}`);
          }
        } else {
          lines.push(`✗ 失败: ${result.error}`);
        }
        lines.push(''); // 空行分隔
      }

      return lines.join('\n');
    };

    chatLoop();
  });
