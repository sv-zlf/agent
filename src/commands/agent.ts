import { Command } from 'commander';
import * as path from 'path';
import chalk from 'chalk';
import ora = require('ora');
import { getConfig } from '../config';
import { createAPIAdapter } from '../api';
import { createToolEngine, createContextManager } from '../core';
import { getInterruptManager } from '../core/interrupt';
import { getAgentManager } from '../core/agent';
import { builtinTools, enhancedBuiltinTools } from '../tools';
import { createLogger } from '../utils';
import { displayBanner } from '../utils/logo';
import { createCommandManager } from './slash-commands';
import { CommandCompleter } from './command-completer';
import type { ToolCall } from '../types';
import { readFileSync } from 'fs';

const logger = createLogger();

/**
 * agent命令 - GG CODE AI编程助手
 */
export const agentCommand = new Command('agent')
  .description('GG CODE - AI-Powered Code Editor (类似Claude Code)')
  .option('-y, --yes', '自动批准所有工具调用', false)
  .option('-i, --iterations <number>', '最大迭代次数', '10')
  .option('-a, --agent <name>', '使用的 Agent (default, explore, build, plan)', 'default')
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

    // 注册所有内置工具（使用增强版本）
    // 增强版本包含：
    // - Read: 智能文件检测、二进制文件拦截、相似文件建议
    // - Edit: 参数验证、相似字符串提示、替换次数统计
    // - Bash: 危险命令拦截、退出码记录
    toolEngine.registerTools(enhancedBuiltinTools);

    const agentConfig = config.getAgentConfig();
    const contextManager = createContextManager(
      agentConfig.max_history,
      agentConfig.max_context_tokens
    );

    // 加载历史记录
    if (options.history) {
      await contextManager.loadHistory();
    }

    // 读取版本号
    const packagePath = path.join(__dirname, '../../package.json');
    const version = JSON.parse(readFileSync(packagePath, 'utf-8')).version;

    // 显示 GG CODE 启动横幅
    displayBanner(version);

    // 获取当前工作目录
    const workingDirectory = process.cwd();

    // 获取中断管理器
    const interruptManager = getInterruptManager();

    // 启动交互式循环
    const readline = require('readline');
    let rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // 设置raw模式，用于监听单个按键
    rl.input.setRawMode(true);

    // 辅助函数：重新创建 readline 接口（在中断后）
    const recreateReadline = () => {
      try {
        if (rl && !(rl as any)._closed) {
          rl.close();
        }
      } catch (e) {
        // 忽略关闭错误
      }

      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.input.setRawMode(true);
    };

    // 按键监听器变量
    let keyListener: any = null;
    let interruptKeyListener: any = null;

    // 设置 P 键中断监听
    const setupInterruptKey = () => {
      // 移除旧的中断监听器
      if (interruptKeyListener) {
        rl.input.removeListener('data', interruptKeyListener);
      }

      // 创建新的中断监听器
      interruptKeyListener = (data: Buffer) => {
        const key = data.toString('utf8');

        // P 键或 p 键中断操作
        if (key === 'p' || key === 'P') {
          if (interruptManager.currentState.isAIThinking || interruptManager.currentState.isExecutingTool) {
            interruptManager.requestInterrupt();

            // 清空输入缓冲区 - 延迟执行，避免在监听器内部操作
            setImmediate(() => {
              try {
                recreateReadline();
                setupInterruptKey();
              } catch (e) {
                // 忽略错误
              }
            });
          }
        }
      };

      rl.input.on('data', interruptKeyListener);
    };

    // 移除中断按键监听
    const removeInterruptKey = () => {
      if (interruptKeyListener) {
        rl.input.removeListener('data', interruptKeyListener);
        interruptKeyListener = null;
      }
    };

    // 设置 SIGINT 处理 - 只用于退出程序
    process.on('SIGINT', () => {
      console.log();
      cleanupAndExit();
    });

    // 清理并退出
    const cleanupAndExit = () => {
      // 防止重复调用
      if ((rl as any)._closed) {
        process.exit(0);
      }

      // 清理中断管理器
      interruptManager.cleanup();

      // 移除所有监听器
      if (keyListener) {
        rl.input.removeListener('data', keyListener);
      }
      if (interruptKeyListener) {
        rl.input.removeListener('data', interruptKeyListener);
      }
      try {
        rl.input.setRawMode(false);
      } catch (e) {
        // 忽略错误
      }

      if (options.history) {
        contextManager.saveHistory().then(() => {
          try {
            rl.close();
          } catch (e) {
            // readline 可能已经关闭
          }
          logger.info('再见！');
          process.exit(0);
        }).catch(() => {
          // history 保存失败也继续退出
          try {
            rl.close();
          } catch (e) {
            // readline 可能已经关闭
          }
          logger.info('再见！');
          process.exit(0);
        });
      } else {
        try {
          rl.close();
        } catch (e) {
          // readline 可能已经关闭
        }
        logger.info('再见！');
        process.exit(0);
      }
    };

    // 添加工具批准的按键监听
    const setupKeyListener = (resolve: (choice: 'yes-once' | 'yes-all' | 'no') => void): void => {
      // 移除旧的监听器（如果有）
      if (keyListener) {
        rl.input.removeListener('data', keyListener);
      }

      // 创建新的监听器
      keyListener = (data: Buffer) => {
        const key = data.toString('utf8');

        if (key === '1') {
          // 移除监听器
          rl.input.removeListener('data', keyListener);
          keyListener = null;
          resolve('yes-once');
        } else if (key === '2' || key.toLowerCase() === 'a') {
          // 移除监听器
          rl.input.removeListener('data', keyListener);
          keyListener = null;
          resolve('yes-all');
        } else if (key === '3' || key.toLowerCase() === 'n') {
          // 移除监听器
          rl.input.removeListener('data', keyListener);
          keyListener = null;
          resolve('no');
        }
        // 忽略其他按键
      };

      rl.input.on('data', keyListener);
      rl.input.resume();
    };

    // 移除按键监听器的辅助函数
    const removeKeyListener = (): void => {
      if (keyListener) {
        rl.input.removeListener('data', keyListener);
        keyListener = null;
      }
      rl.input.setRawMode(false);
    };

    // 设置系统提示词（只设置一次）
    // 使用 AgentManager 加载对应的 agent 提示词
    const agentManager = getAgentManager();
    const agentName = options.agent || 'default';

    let systemPrompt: string;
    try {
      systemPrompt = await agentManager.loadAgentPrompt(agentName);
    } catch (error) {
      console.warn(chalk.yellow(`警告: 无法加载 agent "${agentName}" 的提示词，使用默认提示词`));
      console.warn(chalk.gray(`  错误: ${(error as Error).message}`));
      systemPrompt = await agentManager.loadAgentPrompt('default');
    }

    contextManager.setSystemPrompt(systemPrompt);

    // 创建命令管理器和补全器
    const commandManager = createCommandManager();
    const commandCompleter = new CommandCompleter(commandManager);

    // 记录用户是否已经批准了所有工具调用
    let autoApproveAll = false;

    // 定义一个获取当前 readline 接口的函数
    const getReadline = () => rl;

    const chatLoop = async () => {
      // 每次调用 chatLoop 时都重新获取 rl
      const currentRl = getReadline();

      currentRl.question(chalk.cyan('> '), async (input: string) => {
        if (!input.trim()) {
          chatLoop();
          return;
        }

        // 特殊处理：只输入 "/" 时显示命令列表
        if (input.trim() === '/') {
          console.log(commandCompleter.formatCommandList());
          chatLoop();
          return;
        }

        // 检测是否是斜杠命令
        if (commandManager.isCommand(input)) {
          const result = await commandManager.executeCommand(input, {
            workingDirectory: workingDirectory,
            config: config,
            messages: contextManager.getContext(),
          });

          // 根据命令结果决定是否继续
          if (!result.shouldContinue) {
            // 命令已处理，继续等待下一个输入
            chatLoop();
            return;
          }

          // 如果命令有返回消息，显示它
          if (result.message) {
            console.log(chalk.gray(result.message));
          }
        }

        // 处理特殊命令（如果不是斜杠命令）
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          const rlToClose = getReadline(); // 获取当前的 rl
          cleanupAndExit();
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

          // 每次新的用户输入时，重置所有状态
          if (!options.yes) {
            autoApproveAll = false;
          }

          // 重置中断管理器状态
          interruptManager.fullReset();

          // 持续对话循环：AI响应 -> 检查工具调用 -> 执行工具 -> 继续对话
          let maxToolRounds = parseInt(options.iterations, 10);
          let currentRound = 0;

          while (currentRound < maxToolRounds) {
            currentRound++;

            // 检查是否在循环开始时就被中断
            if (interruptManager.isAborted()) {
              console.log();
              console.log(chalk.yellow('🛑 操作已被用户中断\n'));
              break;
            }

            try {
              // 获取当前上下文并调用AI
              const messages = contextManager.getContext();

              // 开始新操作，获取 abort signal
              const abortSignal = interruptManager.startOperation();
              interruptManager.setAIThinking(true);

              const spinner = ora('AI思考中... (按 P 键可中断)').start();

              let response: string | undefined;
              let wasInterrupted = false;

              try {
                // API 调用（使用中断管理器的 signal）
                response = await apiAdapter.chat(messages, {
                  abortSignal: abortSignal,
                });

                // 正常完成，停止 spinner
                spinner.stop();
              } catch (apiError: any) {
                spinner.stop();

                // 检查是否是用户中断
                if (apiError.code === 'ABORTED' || interruptManager.isAborted()) {
                  console.log();
                  console.log(chalk.yellow('🛑 AI思考已被用户中断'));
                  console.log();
                  wasInterrupted = true;

                  // 添加中断消息到上下文
                  contextManager.addMessage('user', '\n\n用户中断了AI思考。请重新开始或询问其他问题。');
                } else {
                  // 其他错误继续抛出
                  throw apiError;
                }
              } finally {
                interruptManager.setAIThinking(false);
              }

              // 如果被中断，直接退出循环（理论上不会执行到这里，因为中断已经退出程序了）
              if (wasInterrupted || !response) {
                break;
              }

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
              console.log(chalk.gray('💡 提示: 按 P 键可中断当前工具执行\n'));

              const toolResults: any[] = [];
              for (const call of toolCalls) {
                // 检查是否已中断
                if (interruptManager.isAborted()) {
                  console.log();
                  console.log(chalk.yellow('🛑 工具执行已被用户中断\n'));
                  toolResults.push({
                    success: false,
                    error: '用户中断了工具执行 (Ctrl+C)',
                  });
                  break;
                }

                try {
                  // 获取工具定义以检查权限级别
                  const tool = toolEngine.getTool(call.tool);
                  if (!tool) {
                    toolResults.push({
                      success: false,
                      error: `未知工具: ${call.tool}`,
                    });
                    continue;
                  }

                  // 格式化工具参数显示
                  const paramsStr = Object.entries(call.parameters)
                    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                    .join(' ');

                  // 根据权限级别决定是否需要确认
                  let needsApproval = false;
                  switch (tool.permission) {
                    case 'safe':
                      // 安全操作（只读），不需要确认
                      needsApproval = false;
                      break;
                    case 'local-modify':
                      // 本地文件修改，需要确认
                      needsApproval = true;
                      break;
                    case 'network':
                      // 网络操作，需要确认
                      needsApproval = true;
                      break;
                    case 'dangerous':
                      // 危险操作（执行命令等），必须确认
                      needsApproval = true;
                      break;
                    default:
                      // 未知权限级别，默认需要确认
                      needsApproval = true;
                  }

                  // 询问是否批准（根据权限级别和全局设置）
                  let approved = !needsApproval || options.yes || autoApproveAll;
                  if (needsApproval && !approved) {
                    // 显示工具调用和权限提示
                    console.log(`\n${chalk.yellow('○')} ${chalk.cyan(call.tool)}(${paramsStr})`);
                    const permissionLabel: Record<string, string> = {
                      'local-modify': '文件修改',
                      'network': '网络操作',
                      'dangerous': '危险操作',
                    };
                    console.log(chalk.gray(`  [${permissionLabel[tool.permission] || '需要确认'}]`));
                    const choice = await askForApproval();

                    if (choice === 'no') {
                      // 拒绝当前工具，停止当前操作
                      toolResults.push({
                        success: false,
                        error: '用户拒绝了工具调用',
                      });
                      console.log(chalk.red('✗ 已拒绝\n'));
                      break; // 退出工具循环
                    } else if (choice === 'yes-all') {
                      // 批准当前及后续所有工具
                      approved = true;
                      autoApproveAll = true;
                    }
                  }

                  // 显示工具调用（同一行）
                  process.stdout.write(`\n${chalk.yellow('○')} ${chalk.cyan(call.tool)}(${paramsStr})`);

                  // 记录开始时间
                  const startTime = Date.now();

                  // 标记正在执行工具
                  interruptManager.setExecutingTool(true);

                  // 执行工具（传递 abort signal）
                  const result = await toolEngine.executeToolCall(call, abortSignal);

                  // 执行完成，重置标志
                  interruptManager.setExecutingTool(false);

                  // 计算执行时间
                  const duration = Date.now() - startTime;

                  toolResults.push(result);

                  // 更新同一行显示结果
                  const timeStr = `${duration}ms`;
                  if (result.success) {
                    // 成功：绿色实心圆 + 执行时间
                    // 使用 \r 回到行首，然后用空格清除行尾，再写入新内容
                    process.stdout.write(`\r${chalk.green('●')} ${chalk.cyan(call.tool)}(${paramsStr}) ${chalk.gray(`(${timeStr})`)}   `);
                  } else {
                    // 失败：红色叉号 + 执行时间
                    process.stdout.write(`\r${chalk.red('✗')} ${chalk.cyan(call.tool)}(${paramsStr}) ${chalk.gray(`(${timeStr})`)}   `);
                    // 失败时在下一行显示错误信息
                    process.stdout.write(`\n  ${chalk.red(`错误: ${result.error}`)}`);
                  }

                  // 如果工具失败且不是因为中断，停止后续工具
                  if (!result.success && !result.error?.includes('中断')) {
                    break;
                  }
                } catch (toolError: any) {
                  // 执行完成（即使出错），重置标志
                  interruptManager.setExecutingTool(false);

                  // 单个工具执行失败，检查是否是中断
                  if (toolError.message?.includes('中断') || interruptManager.isAborted()) {
                    toolResults.push({
                      success: false,
                      error: '用户中断了工具执行 (Ctrl+C)',
                    });
                    console.log(chalk.red(`  ✗ 已中断`));
                    break;
                  }

                  // 其他错误
                  toolResults.push({
                    success: false,
                    error: `工具执行异常: ${toolError.message}`,
                  });
                  console.log(chalk.red(`  ✗ 异常: ${toolError.message}`));
                  break;
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
        setImmediate(() => chatLoop());
      });
    };

    // 辅助函数：询问是否批准（使用按键监听）
    const askForApproval = (): Promise<'yes-once' | 'yes-all' | 'no'> => {
      return new Promise((resolve) => {
        console.log(chalk.gray('    按键选择:\n'));
        console.log(chalk.green('      1     - 仅同意当前操作 (yes)\n'));
        console.log(chalk.yellow('      2     - 同意当前及后续所有操作 (all)\n'));
        console.log(chalk.red('      3     - 拒绝，停止当前操作 (no)\n'));
        console.log(chalk.cyan('    [按 1/2/3 键快速选择]\n'));

        // 设置按键监听
        setupKeyListener(resolve);
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

    // 在整个运行期间激活 P 键中断监听
    setupInterruptKey();

    chatLoop();
  });
