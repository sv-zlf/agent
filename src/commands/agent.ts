import { Command } from 'commander';
import * as path from 'path';
import chalk from 'chalk';
import ora = require('ora');
import inquirer from 'inquirer';
import { getConfig } from '../config';
import { createAPIAdapter, createToolEngine, createAgentOrchestrator, createContextManager, builtinTools } from '../core';
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

    const agentLoop = async () => {
      rl.question(chalk.cyan('You: '), async (input: string) => {
        if (!input.trim()) {
          agentLoop();
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
          logger.success('上下文已清空\n');
          agentLoop();
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
          agentLoop();
          return;
        }

        try {
          const spinner = ora('');

          // 执行Agent任务
          const result = await orchestrator.execute(input);

          if (result.success) {
            spinner.stop();

            // 显示最终结果
            if (result.finalAnswer) {
              console.log(chalk.green('\nAI:'), result.finalAnswer);
              console.log();
            }

            // 显示统计信息
            console.log(chalk.gray(
              `\n📊 执行统计: ${result.iterations} 轮迭代, ${result.toolCallsExecuted} 个工具调用`
            ));
            console.log();
          } else {
            spinner.stop();
            console.log(chalk.red(`\n❌ 执行失败: ${result.error}`));
            console.log();
          }
        } catch (error) {
          console.log(chalk.red(`\n❌ 错误: ${(error as Error).message}`));
          console.log();
        }

        agentLoop();
      });
    };

    agentLoop();
  });
