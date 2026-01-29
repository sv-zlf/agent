import { Command } from 'commander';
import * as fs from 'fs-extra';
import readline from 'readline';
import chalk from 'chalk';
import ora = require('ora');
import { getConfig } from '../config';
import { createAPIAdapter } from '../api';
import { createContextManager } from '../core';
import { createLogger } from '../utils';
import type { Message } from '../types';

const logger = createLogger();

/**
 * chat命令
 */
export const chatCommand = new Command('chat')
  .description('交互式对话模式')
  .option('-c, --context <file>', '添加文件上下文')
  .option('-s, --system <prompt>', '设置系统提示词')
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

    // 创建API适配器和上下文管理器
    const api = createAPIAdapter(config.getAPIConfig());
    const agentConfig = config.getAgentConfig();
    const context = createContextManager(
      agentConfig.max_history,
      agentConfig.max_context_tokens
    );

    // 加载历史记录
    if (options.history) {
      await context.loadHistory();
    }

    // 设置系统提示词
    if (options.system) {
      context.setSystemPrompt(options.system);
    } else {
      // 尝试从文件加载默认系统提示词
      const systemPromptPath = config.get('prompts').system;
      if (await fs.pathExists(systemPromptPath)) {
        const systemPrompt = await fs.readFile(systemPromptPath, 'utf-8');
        context.setSystemPrompt(systemPrompt);
      }
    }

    // 添加文件上下文
    if (options.context) {
      try {
        await context.addFileContext(options.context);
        logger.info(`已加载文件上下文: ${options.context}`);
      } catch (error) {
        logger.error(`加载文件失败: ${(error as Error).message}`);
        return;
      }
    }

    // 启动交互式对话
    logger.title('内网代码编辑助手');
    logger.info('输入 "exit" 或 "quit" 退出，输入 "clear" 清空上下文\n');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const chatLoop = async () => {
      rl.question(chalk.cyan('You: '), async (input) => {
        if (!input.trim()) {
          chatLoop();
          return;
        }

        // 处理特殊命令
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          if (options.history) {
            await context.saveHistory();
          }
          rl.close();
          logger.info('再见！');
          return;
        }

        if (input.toLowerCase() === 'clear') {
          context.clearContext();
          logger.success('上下文已清空');
          chatLoop();
          return;
        }

        try {
          // 添加用户消息
          context.addMessage('user', input);

          // 调用API
          const messages = context.getContext();
          const spinner = ora('思考中...').start();

          try {
            const response = await api.chat(messages);
            spinner.stop();

            // 显示AI回复
            console.log(chalk.green('AI:'), response);
            console.log();

            // 添加助手消息
            context.addMessage('assistant', response);
          } catch (error) {
            spinner.stop();
            throw error;
          }
        } catch (error) {
          logger.error(`错误: ${(error as Error).message}`);
        }

        chatLoop();
      });
    };

    chatLoop();
  });
