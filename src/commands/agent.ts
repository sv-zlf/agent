import { Command } from 'commander';
import * as path from 'path';
import chalk from 'chalk';
import ora = require('ora');

import { getConfig } from '../config';
import { createAPIAdapterFactory } from '../api';
import {
  createToolEngine,
  createContextManager,
  createSessionManager,
  createFunctionalAgentManager,
  getInterruptManager,
  getAgentManager,
} from '../core';

import { executeAPIRequest, API_PRIORITY } from '../core/api-concurrency';
import { getBuiltinTools } from '../tools';
import { PermissionManager, PermissionAction } from '../core/permissions';
import { createLogger, getSessionsDir, getCurrentSessionFile } from '../utils';
import { displayBanner } from '../utils/logo';
import { createCommandManager, type CommandResult } from './slash-commands';
import { readFileSync } from 'fs';
import { renderMarkdown } from '../utils/markdown';
import { ToolParameterHelper } from '../utils/tool-params';

const logger = createLogger();

/**
 * 过滤流式输出中的工具调用 JSON 代码块
 */
interface StreamFilterState {
  inCodeBlock: boolean;
  buffer: string;
}

function createStreamFilter(): {
  filter: (chunk: string) => string;
} {
  const state: StreamFilterState = {
    inCodeBlock: false,
    buffer: '',
  };

  return {
    filter: (chunk: string): string => {
      let remaining = state.buffer + chunk;
      state.buffer = '';
      let result = '';

      while (remaining.length > 0) {
        if (!state.inCodeBlock) {
          const codeBlockStart = remaining.match(/```(json|tool)?\s*\n?/);
          if (codeBlockStart) {
            const index = codeBlockStart.index!;
            result += remaining.slice(0, index);
            state.inCodeBlock = true;
            remaining = remaining.slice(index + codeBlockStart[0].length);
          } else {
            result += remaining;
            remaining = '';
          }
        } else {
          const codeBlockEnd = remaining.indexOf('```');
          if (codeBlockEnd !== -1) {
            state.inCodeBlock = false;
            remaining = remaining.slice(codeBlockEnd + 3);
          } else {
            state.buffer = remaining;
            break;
          }
        }
      }

      return result;
    },
  };
}

/**
 * 清理 AI 响应文本，移除工具调用的 JSON 代码块
 */
function cleanResponse(response: string): string {
  let cleaned = response;

  cleaned = cleaned.replace(/```json\s*\n?\s*\{[\s\S]*?\}\s*\n?```/g, '');
  cleaned = cleaned.replace(/```\s*\n?\s*\{[\s\S]*?\}\s*\n?```/g, '');
  cleaned = cleaned.replace(
    /\{[\s]*"tool"[\s]*:[\s]*"[\w]+"[\s]*,[\s]*"parameters"[\s]*:[\s]*\{[\s\S]*?\}\s*\}/g,
    ''
  );
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * 检测工具结果中的文件修改信息
 * 返回修改的文件列表和代码行数变化
 */
function detectFileChanges(
  toolName: string,
  result: any
): { modifiedFiles: string[]; additions: number; deletions: number } {
  const modifiedFiles: string[] = [];
  let additions = 0;
  let deletions = 0;

  // 只检测编辑类工具
  if (toolName === 'edit' || toolName === 'multiedit' || toolName === 'write') {
    const params = result.input?.parameters || {};

    // 获取修改的文件路径
    if (params.filePath) {
      modifiedFiles.push(params.filePath);
    }

    // 简单估算行数变化（基于 oldString 和 newString 的长度差）
    // 这是一个近似值，OpenCode 使用实际的 git diff
    if (params.oldString && params.newString) {
      const oldLines = params.oldString.split('\n').length;
      const newLines = params.newString.split('\n').length;
      const diff = newLines - oldLines;

      if (diff > 0) {
        additions += diff;
      } else {
        deletions -= diff;
      }
    } else if (params.content && toolName === 'write') {
      // 写入文件，估算所有行都是新增的
      additions += params.content.split('\n').length;
    }
  }

  return { modifiedFiles, additions, deletions };
}

function printAssistantMessage(message: string): void {
  if (!message || !message.trim()) {
    return; // 不打印空消息
  }
  // 渲染 Markdown 格式
  const rendered = renderMarkdown(message, { colors: true });
  console.log(chalk.cyan('● ') + rendered);
}

function printCompactAssistant(response: string): void {
  const cleaned = cleanResponse(response);

  // 如果清理后为空（只有工具调用），显示默认提示
  if (!cleaned || cleaned.trim().length === 0) {
    console.log(chalk.cyan('● 准备执行操作...'));
    return;
  }

  const brief = cleaned.split('\n')[0].substring(0, 80) + (cleaned.length > 80 ? '...' : '');
  console.log(chalk.cyan('● ') + brief);
}

/**
 * Print enhanced tool call with detailed information
 */
function printCompactToolCall(
  tool: string,
  params: Record<string, unknown>,
  _toolEngine: any
): void {
  const paramsStr = Object.entries(params)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
  console.log(chalk.yellow('● ') + chalk.cyan(tool) + (paramsStr ? `(${paramsStr})` : ''));
}

function printToolCompactResult(
  success: boolean,
  result: { output?: string; error?: string }
): void {
  if (result.output) {
    const lines = result.output.split('\n');
    const brief = lines.slice(0, 2).join(' | ');
    const truncated = lines.length > 2 || result.output.length > 150;
    const display = success
      ? chalk.gray(`  ⎿  ${brief}${truncated ? '...' : ''}`)
      : chalk.red(`  ⎿  ✗ ${brief}${truncated ? '...' : ''}`);
    console.log(display);
  } else if (!success && result.error) {
    console.log(chalk.red(`  ⎿  ✗ ${result.error.substring(0, 100)}`));
  } else {
    console.log(chalk.gray('  ⎿  ✓'));
  }
}
/**
 * agent命令 - GG CODE AI编程助手
 */
export const agentCommand = new Command('agent')
  .description('GG CODE - AI-Powered Code Editor (类似Claude Code)')
  .option('-y, --yes', '自动批准所有工具调用', false)
  .option('-i, --iterations <number>', '最大迭代次数')
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
    const apiFactory = createAPIAdapterFactory(config.getAPIConfig());
    const apiAdapter = apiFactory.create();
    const toolEngine = createToolEngine();
    const functionalAgentManager = createFunctionalAgentManager(apiAdapter);
    const permissionManager = new PermissionManager();

    // 注册所有内置工具
    // 使用新工具系统（Zod schema + 智能截断）
    const tools = await getBuiltinTools();
    toolEngine.registerTools(tools);

    // 初始化权限规则：根据工具的 permission 属性设置默认规则
    tools.forEach((tool) => {
      let action: PermissionAction;
      switch (tool.permission) {
        case 'safe':
          action = PermissionAction.ALLOW;
          break;
        case 'local-modify':
        case 'network':
          action = PermissionAction.ASK;
          break;
        case 'dangerous':
          action = PermissionAction.ASK;
          break;
        default:
          action = PermissionAction.ASK;
      }
      permissionManager.addRule({
        tool: tool.name,
        pattern: '*',
        action,
      });
    });

    // 创建会话管理器
    const sessionManager = createSessionManager({
      sessionsDir: getSessionsDir(),
      currentSessionFile: getCurrentSessionFile(),
      sessionLimits: config.get().sessions,
    });
    await sessionManager.initialize();

    // 始终创建新会话（用户需求：每次启动新会话，旧会话通过切换选择）
    const currentSession = await sessionManager.createSession('New Session', 'default');

    // 跟踪是否是第一条用户消息（用于生成标题）
    let isFirstUserMessage = true;

    // 跟踪会话统计
    let stats = {
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      tokensUsed: 0,
    };

    const agentConfig = config.getAgentConfig();
    const contextManager = createContextManager(
      agentConfig.max_history,
      agentConfig.max_context_tokens,
      currentSession.historyFile
    );

    // 加载历史记录（可选）
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

    // 添加全局未捕获异常处理器，防止进程意外退出
    process.on('unhandledRejection', (reason: any) => {
      console.error(chalk.red('未捕获的 Promise 错误:'), reason);
      // 不退出，让对话继续
    });

    process.on('uncaughtException', (error: Error) => {
      console.error(chalk.red('未捕获的异常:'), error.message);
      // 不退出，让对话继续
    });

    // 启动交互式循环
    const readline = require('readline');
    let rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // 不默认开启 raw mode，只在需要时（如 P 键监听）才开启
    // raw mode 会干扰正常的行输入

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
    };

    // 清空输入缓冲区
    const flushInput = () => {
      try {
        if (process.stdin.isRaw) {
          process.stdin.setRawMode(false);
        }
        while (process.stdin.readableLength > 0) {
          process.stdin.read();
        }
      } catch (e) {
        // 忽略错误
      }
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

      // 开启 raw mode 以监听单个按键
      try {
        rl.input.setRawMode(true);
      } catch (e) {
        // 某些 Node.js 版本可能不支持 setRawMode
        console.debug('setRawMode not supported, using alternative');
      }
      rl.input.resume();

      // 创建新的中断监听器
      interruptKeyListener = (data: Buffer) => {
        const key = data.toString('utf8');

        // P 键中断操作
        if (key === 'p' || key === 'P') {
          if (
            interruptManager.currentState.isAIThinking ||
            interruptManager.currentState.isExecutingTool
          ) {
            interruptManager.requestInterrupt();

            // 清空输入缓冲区 - 延迟执行，避免在监听器内部操作
            setImmediate(() => {
              try {
                flushInput();
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

    // 设置 SIGINT 处理 - 只用于退出程序
    process.on('SIGINT', () => {
      cleanupAndExit();
    });

    // 清理并退出
    const cleanupAndExit = async () => {
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
      } catch {
        // 忽略错误
      }

      // 立即保存历史和会话（同步操作）
      if (options.history) {
        try {
          await contextManager.saveHistory();
          // 保存成功后，更新会话的统计信息
          await sessionManager.updateSessionActivity(contextManager.getMessageCount());
          await sessionManager.updateSessionStats(stats);
        } catch {
          // 历史保存失败不影响退出
        }
      }

      // 关闭 readline
      try {
        rl.close();
      } catch (e) {
        // readline 可能已经关闭
      }

      logger.info('再见！');
      process.exit(0);
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

    // 🔑 修复：验证系统消息确实存在（如果加载了历史）
    if (options.history) {
      const messages = contextManager.getContext();
      const hasSystemMessage = messages.some((m) => m.role === 'system');
      if (!hasSystemMessage) {
        logger.debug('[启动] 加载历史后发现没有系统消息，重新设置');
        contextManager.setSystemPrompt(systemPrompt);
      }
    }

    // 创建命令管理器
    const commandManager = createCommandManager();

    // 记录用户是否已经批准了所有工具调用
    let autoApproveAll = false;

    // 定义一个获取当前 readline 接口的函数
    const getReadline = () => rl;

    const chatLoop = async () => {
      // 每次调用 chatLoop 时都重新获取 rl
      const currentRl = getReadline();

      // 关键修复：等待用户输入时需要关闭 raw mode
      // raw mode 会阻止 readline 的 line 事件正常触发
      // 只在 AI 思考或工具执行时才开启 raw mode 以支持 P 键中断
      if (currentRl.input.isRaw) {
        currentRl.input.setRawMode(false);
      }

      // 移除 P 键监听器（等待用户输入时不需要）
      if (interruptKeyListener) {
        currentRl.input.removeListener('data', interruptKeyListener);
        interruptKeyListener = null;
      }

      // 显示提示符
      process.stdout.write(chalk.cyan('> '));

      // 使用 line 事件而不是 question，这样可以更好地控制
      const onLine = async (input: string) => {
        // 移除监听器，避免重复触发
        currentRl.removeListener('line', onLine);

        if (!input.trim()) {
          setImmediate(() => chatLoop());
          return;
        }

        // 特殊处理：只输入 "/" 时显示交互式命令选择器
        if (input.trim() === '/') {
          const commands = commandManager.getCommands();
          const { select } = require('../utils/prompt');

          // 暂时关闭当前的 readline 接口
          // 这样 select() 才能完全接管 stdin
          try {
            currentRl.close();
          } catch (e) {
            // readline 可能已经关闭，忽略错误
          }

          // 移除 P 键监听器
          if (interruptKeyListener) {
            process.stdin.removeListener('data', interruptKeyListener);
          }

          try {
            const selected = await select({
              message: '选择命令:',
              options: commands.map((cmd: any) => ({
                label: `/${cmd.name}`,
                value: `/${cmd.name}`,
                description: cmd.description,
              })),
            });

            input = selected.value;
          } finally {
            // 重新创建 readline 接口
            rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });

            // 重新设置 P 键监听
            setupInterruptKey();
          }
        }

        // 检测是否是斜杠命令
        if (commandManager.isCommand(input)) {
          const result = await commandManager.executeCommand(input, {
            workingDirectory: workingDirectory,
            config: config,
            messages: contextManager.getContext(),
            sessionManager: sessionManager,
            contextManager: contextManager,
            apiAdapter: apiAdapter, // 传递 API 适配器
            onExit: cleanupAndExit, // 传递退出回调
            pauseKeyListener: () => {
              // 临时移除主程序的按键监听器
              const currentRl = getReadline();
              const savedKeyListener = keyListener;
              const savedInterruptKeyListener = interruptKeyListener;

              // 移除所有按键监听
              if (keyListener) {
                currentRl.input.removeListener('data', keyListener);
                keyListener = null;
              }
              if (interruptKeyListener) {
                currentRl.input.removeListener('data', interruptKeyListener);
              }

              // 返回恢复函数
              return () => {
                // 恢复按键监听器
                if (savedKeyListener) {
                  keyListener = savedKeyListener;
                  currentRl.input.on('data', keyListener);
                }
                if (savedInterruptKeyListener) {
                  interruptKeyListener = savedInterruptKeyListener;
                  currentRl.input.on('data', savedInterruptKeyListener);
                }
              };
            },
          });

          // 根据命令结果决定是否继续
          const cmdResult = result as CommandResult & {
            sessionSwitched?: { sessionId: string; historyFile: string };
          };
          if (!cmdResult.shouldContinue) {
            // 处理会话切换
            if (cmdResult.sessionSwitched) {
              const { historyFile } = cmdResult.sessionSwitched;
              // 更新 contextManager 的历史文件路径并加载历史
              contextManager.updateHistoryFile(historyFile);
              await contextManager.loadHistory();
              logger.debug(
                `[会话切换] 加载历史: ${historyFile}, 系统提示词已设置: ${contextManager.isSystemPromptSet()}`
              );
            }

            // 如果系统提示词未设置（比如切换会话后），重新设置
            if (!contextManager.isSystemPromptSet()) {
              logger.debug('[会话切换] 重新设置系统提示词');
              contextManager.setSystemPrompt(systemPrompt);
            }
            // 使用 setImmediate 避免在 line 回调中立即调用 chatLoop
            setImmediate(() => chatLoop());
            return;
          }

          // 如果命令有返回消息，显示它
          if (result.message) {
            console.log(chalk.gray(result.message));
          }
        }

        // 处理特殊命令（如果不是斜杠命令）
        if (input.toLowerCase() === 'clear') {
          contextManager.clearContext();
          contextManager.setSystemPrompt(systemPrompt); // 重新设置系统提示词
          logger.success('上下文已清空\n');
          setImmediate(() => chatLoop());
          return;
        }

        // 显示工具列表命令
        if (input.toLowerCase() === 'tools') {
          console.log(chalk.yellow('\n📦 可用工具列表:\n'));
          const tools = toolEngine.getAllTools();
          tools.forEach((tool) => {
            console.log(chalk.cyan(`  ${tool.name}`));
            console.log(chalk.gray(`    ${tool.description}`));
          });
          setImmediate(() => chatLoop());
          return;
        }

        try {
          // 添加用户消息到上下文
          contextManager.addMessage('user', input);

          // 更新统计
          stats.userMessages++;

          // 每次新的用户输入时，重置所有状态
          autoApproveAll = options.yes || agentConfig.auto_approve || false;

          // 重置中断管理器状态
          interruptManager.fullReset();

          // 持续对话循环：AI响应 -> 检查工具调用 -> 执行工具 -> 继续对话
          let maxToolRounds;
          if (options.iterations) {
            maxToolRounds = parseInt(options.iterations, 10);
          } else {
            maxToolRounds = agentConfig.max_iterations || 10;
          }
          let currentRound = 0;

          while (currentRound < maxToolRounds) {
            currentRound++;

            // 检查是否在循环开始时就被中断
            if (interruptManager.isAborted()) {
              console.log(chalk.yellow('🛑 操作已被用户中断\n'));
              break;
            }

            try {
              // 获取当前上下文并调用AI
              let messages = contextManager.getContext();

              // 调试：检查获取的消息
              const systemMsgsInContext = messages.filter((m) => m.role === 'system');
              if (systemMsgsInContext.length === 0) {
                console.log(chalk.yellow('[getContext] ⚠️  getContext 返回的消息中没有系统消息！'));
                console.log(chalk.yellow(`[getContext] systemPromptSet: ${contextManager.isSystemPromptSet()}`));
                console.log(chalk.yellow(`[getContext] 总消息数: ${messages.length}`));
              }

              // 检查上下文大小，如果过大则触发压缩（仅在启用自动压缩时）
              // 优化：只在特定轮次检查，避免每次都调用 estimateTokens() 影响性能
              const agentConfig = config.getAgentConfig();
              const autoCompressEnabled = agentConfig.auto_compress !== false;

              if (autoCompressEnabled && currentRound % 3 === 0) {
                const maxTokens = agentConfig.max_context_tokens;
                const compressThreshold = agentConfig.compress_threshold || 0.85; // 默认 85%
                const estimatedTokens = contextManager.estimateTokens();

                // 如果上下文超过阈值，触发压缩
                if (estimatedTokens > maxTokens * compressThreshold) {
                  console.log(
                    chalk.yellow(
                      `\n⚠️  上下文过大 (${estimatedTokens}/${maxTokens} tokens)，触发压缩...\n`
                    )
                  );

                  try {
                    let summaryContent = '';

                    // 优先使用已保存的会话摘要
                    const existingSummary = sessionManager.getSessionSummary(currentSession.id);
                    if (existingSummary && existingSummary.files > 0) {
                      // 使用代码统计摘要
                      const parts = [];
                      if (existingSummary.title) {
                        parts.push(`标题: ${existingSummary.title}`);
                      }
                      parts.push(`修改了 ${existingSummary.files} 个文件`);
                      parts.push(
                        `新增 ${existingSummary.additions} 行，删除 ${existingSummary.deletions} 行`
                      );
                      if (existingSummary.modifiedFiles.length > 0) {
                        parts.push(
                          `修改的文件: ${existingSummary.modifiedFiles.slice(0, 5).join(', ')}${existingSummary.modifiedFiles.length > 5 ? '...' : ''}`
                        );
                      }
                      summaryContent = parts.join('\n');
                      console.log(
                        chalk.blue(
                          `📋 使用已保存的代码统计摘要 (+${existingSummary.additions}/-${existingSummary.deletions}, ${existingSummary.files} 文件)\n`
                        )
                      );
                    } else {
                      // 没有已保存摘要，则生成新的压缩摘要
                      const compactResult = await functionalAgentManager.compact(messages);
                      if (compactResult.success && compactResult.output) {
                        summaryContent = compactResult.output;
                      }
                    }

                    if (summaryContent) {
                      // 清空上下文并添加摘要
                      contextManager.clearContext();

                      // 将摘要添加到系统提示词
                      const currentSystemPrompt = systemPrompt || '你是一个 AI 编程助手。';
                      const newSystemPrompt = `${currentSystemPrompt}\n\n## 对话摘要\n${summaryContent}`;
                      contextManager.setSystemPrompt(newSystemPrompt);

                      console.log(
                        chalk.green(
                          `✓ 上下文已压缩 (系统提示词长度: ${newSystemPrompt.length} 字符)\n`
                        )
                      );

                      // 重新获取消息
                      messages = contextManager.getContext();
                    }
                  } catch (compactError) {
                    console.log(
                      chalk.yellow(
                        `压缩失败，继续使用原上下文: ${(compactError as Error).message}\n`
                      )
                    );
                  }
                }
              }

              // 开启 raw mode 以支持 P 键中断
              if (!currentRl.input.isRaw) {
                currentRl.input.setRawMode(true);
              }
              setupInterruptKey();

              // 开始新操作，获取 abort signal
              const abortSignal = interruptManager.startOperation();
              interruptManager.setAIThinking(true);

              const spinner = ora('AI思考中... (按 P 键可中断)').start();

              let response: string | undefined;
              let wasInterrupted = false;
              let fullResponse = ''; // 累积流式响应
              let isFirstChunk = true; // 标记是否是第一个 chunk
              let streamBuffer = ''; // 流式输出缓冲区
              const { filter: streamFilter } = createStreamFilter(); // 工具调用过滤器
              let hasStreamed = false; // 标记是否已经流式输出过

              try {
                // API 调用（使用中断管理器的 signal，通过并发控制）
                // 调试：检查系统消息
                const systemMsgs = messages.filter((m) => m.role === 'system');
                if (systemMsgs.length > 0) {
                  logger.debug(
                    `[API调用] 系统消息数量: ${systemMsgs.length}, 长度: ${systemMsgs[0].content.length}`
                  );
                } else {
                  console.log(chalk.yellow('[API调用] ⚠️  没有系统消息！AI可能丢失身份'));
                }

                response = await executeAPIRequest(
                  async () => {
                    return apiAdapter.chat(messages, {
                      abortSignal: abortSignal,
                      stream: true, // 启用流式输出
                      onChunk: (chunk: string) => {
                        // 累积完整响应
                        fullResponse += chunk;

                        // 过滤工具调用代码块
                        const filteredChunk = streamFilter(chunk);
                        if (!filteredChunk) return;

                        // 累积过滤后的内容
                        streamBuffer += filteredChunk;

                        // 查找完整段落（句末或换行）
                        const match = streamBuffer.match(/[^.!?\n]*[.!?\n]|[^.!?\n]+$/);
                        if (!match) return;

                        // 取完整段落
                        const completeText = streamBuffer.slice(0, match[0].length);
                        if (completeText) {
                          if (isFirstChunk) {
                            spinner.stop();
                            process.stdout.write(chalk.cyan('● '));
                            isFirstChunk = false;
                          }
                          // 渲染 markdown
                          const rendered = renderMarkdown(completeText, { colors: true });
                          process.stdout.write(rendered);
                          // 移除已渲染内容
                          streamBuffer = streamBuffer.slice(completeText.length);
                        }
                      },
                    });
                  },
                  API_PRIORITY.HIGH // 用户直接对话使用高优先级
                );

                // 如果没有流式输出（空响应），停止 spinner
                if (isFirstChunk) {
                  spinner.stop();
                }

                // 使用累积的完整响应
                response = fullResponse || response;

                // 标记是否已经流式输出过（用于避免重复输出）
                hasStreamed = !isFirstChunk;
                if (hasStreamed) {
                  // 流式输出已完成，打印换行
                  console.log();
                }
              } catch (apiError: any) {
                spinner.stop();

                // 检查是否是用户中断
                if (apiError.code === 'ABORTED' || interruptManager.isAborted()) {
                  wasInterrupted = true;

                  // 添加中断消息到上下文
                  contextManager.addMessage(
                    'user',
                    '\n\n用户中断了AI思考。请重新开始或询问其他问题。'
                  );
                } else {
                  console.log(chalk.red(`\n❌ ${apiError.message || apiError.toString()}`));
                  contextManager.addMessage(
                    'user',
                    `\n\n执行过程中发生错误: ${apiError.message || apiError.toString()}`
                  );
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
                const cleanedResponse = cleanResponse(response);
                contextManager.addMessage('assistant', cleanedResponse);

                // 更新统计
                stats.assistantMessages++;

                // 只有在没有流式输出的情况下才重新输出
                if (!hasStreamed) {
                  printAssistantMessage(cleanedResponse);
                }
                break; // 退出工具调用循环，等待用户输入
              }

              // 调试日志：显示检测到的工具调用
              logger.debug(`检测到 ${toolCalls.length} 个工具调用`);
              toolCalls.forEach((call, index) => {
                logger.debug(`  [${index + 1}] ${call.tool}`);
              });

              // 开启 raw mode 以支持 P 键中断（工具执行期间）
              if (!currentRl.input.isRaw) {
                currentRl.input.setRawMode(true);
              }
              setupInterruptKey();

              // 有工具调用，使用紧凑格式显示
              printCompactAssistant(response);

              // 显示工具调用（紧凑格式）
              for (const call of toolCalls) {
                printCompactToolCall(call.tool, call.parameters, toolEngine);
              }

              const toolResults: any[] = [];
              for (const call of toolCalls) {
                // 检查是否已中断
                if (interruptManager.isAborted()) {
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

                  // 从工具参数中提取路径（用于细粒度权限检查）
                  const toolPath = ToolParameterHelper.extractPath(call.parameters);

                  // 使用 PermissionManager 检查权限
                  const permissionRequest = {
                    tool: call.tool,
                    path: toolPath,
                    params: call.parameters,
                  };
                  const permissionResult = permissionManager.checkPermission(permissionRequest);

                  // 判断是否需要批准
                  const isAllowed = permissionResult.action === PermissionAction.ALLOW;
                  const needsApproval = permissionResult.action === PermissionAction.ASK;

                  let approved = isAllowed || options.yes || autoApproveAll;

                  // 如果需要确认但未自动批准
                  if (needsApproval && !approved) {
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

                  // 如果权限被拒绝
                  if (permissionResult.action === PermissionAction.DENY) {
                    const errorMsg = permissionResult.reason || '权限拒绝';
                    toolResults.push({
                      success: false,
                      error: errorMsg,
                    });
                    console.log(chalk.red(`\n✗ ${errorMsg}\n`));
                    break; // 退出工具循环
                  }

                  // 显示工具调用（同一行）
                  process.stdout.write(
                    `\n${chalk.yellow('○')} ${chalk.cyan(call.tool)}(${paramsStr})`
                  );

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

                  // 检测文件修改并更新会话摘要（如果工具成功）
                  if (result.success && options.history) {
                    const changes = detectFileChanges(call.tool, result);
                    if (
                      changes.modifiedFiles.length > 0 ||
                      changes.additions > 0 ||
                      changes.deletions > 0
                    ) {
                      // 异步更新摘要（不阻塞工具执行）
                      (async () => {
                        try {
                          await sessionManager.updateSessionSummary(currentSession.id, changes);
                        } catch (error) {
                          // 静默失败，不影响对话
                          logger.debug(`更新会话摘要失败: ${(error as Error).message}`);
                        }
                      })();
                    }
                  }

                  // 更新统计（工具调用成功）
                  if (result.success) {
                    stats.toolCalls++;
                  }

                  // 更新同一行显示结果
                  const timeStr = `${duration}ms`;
                  if (result.success) {
                    // 成功：绿色实心圆 + 工具名 + 时间
                    process.stdout.write(
                      `\r${chalk.green('●')} ${chalk.cyan(call.tool)}(${paramsStr}) ${chalk.gray(`(${timeStr})`)}   \n`
                    );
                    // 在下行显示简要结果
                    printToolCompactResult(true, result);
                  } else {
                    // 失败：红色叉号 + 工具名 + 时间
                    process.stdout.write(
                      `\r${chalk.red('✗')} ${chalk.cyan(call.tool)}(${paramsStr}) ${chalk.gray(`(${timeStr})`)}   \n`
                    );
                    // 在下行显示错误信息
                    printToolCompactResult(false, result);
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

              // 将AI的响应添加到上下文（清理后的版本）
              const cleanedResponse = cleanResponse(response);
              contextManager.addMessage('assistant', cleanedResponse);

              // 更新统计
              stats.assistantMessages++;

              // 将工具执行结果作为用户反馈添加到上下文
              const toolResultMessage = formatToolResults(toolCalls, toolResults);
              contextManager.addMessage('user', toolResultMessage);

              // 检查是否所有工具都成功
              const allSuccess = toolResults.every((r) => r.success);
              if (!allSuccess) {
                // 如果有错误，添加额外的错误提示
                contextManager.addMessage('user', '\n\n请分析上述错误，修正后重试。');
              }

              // 工具执行完成，显示分隔线
            } catch (roundError) {
              console.log(chalk.red(`\n❌ ${(roundError as Error).message}`));
              contextManager.addMessage(
                'user',
                `\n\n执行过程中发生错误: ${(roundError as Error).message}`
              );
              break;
            }
          }

          // 达到最大迭代次数 - 添加 max-steps 警告
          if (currentRound >= maxToolRounds) {
            console.log(chalk.yellow(`\n⚠️  已达到最大迭代次数 (${maxToolRounds})`));

            // 添加 max-steps 警告到上下文
            try {
              const maxStepsWarning = await functionalAgentManager.getMaxStepsWarning();

              // 将 max-steps 警告作为用户消息添加
              contextManager.addMessage('user', maxStepsWarning);

              // 进行最后一次 API 调用，让 AI 生成总结
              console.log(chalk.gray('📝 正在生成任务总结...\n'));

              const finalMessages = contextManager.getContext();
              let fullFinalResponse = '';
              let isFirstFinalChunk = true;
              const finalSpinner = ora('正在生成总结...').start();

              const finalResponse = await executeAPIRequest(async () => {
                return apiAdapter.chat(finalMessages, {
                  stream: true, // 启用流式输出
                  onChunk: (chunk: string) => {
                    // 第一个 chunk 到达时，停止 spinner
                    if (isFirstFinalChunk) {
                      finalSpinner.stop();
                      isFirstFinalChunk = false;
                    }
                    // 过滤工具调用JSON代码块，只输出文本内容
                    const cleanedChunk = cleanResponse(chunk);
                    if (cleanedChunk) {
                      // 实时输出流式内容
                      process.stdout.write(cleanedChunk);
                    }
                    // 累积完整响应（包含工具调用）
                    fullFinalResponse += chunk;
                  },
                });
              }, API_PRIORITY.HIGH);

              // 如果没有流式输出，停止 spinner
              if (isFirstFinalChunk) {
                finalSpinner.stop();
              }

              // 使用累积的完整响应
              const finalResponseContent = fullFinalResponse || finalResponse;
              const cleanedFinalResponse = cleanResponse(finalResponseContent);
              contextManager.addMessage('assistant', cleanedFinalResponse);
              printAssistantMessage(cleanedFinalResponse);
            } catch (error) {
              console.log(chalk.red(`生成总结失败: ${(error as Error).message}\n`));
            }
          }

          // 第一条用户消息的AI回复完成后，等待生成会话标题
          if (isFirstUserMessage && options.history) {
            isFirstUserMessage = false;

            try {
              const titleResult = await functionalAgentManager.generateTitle(input);

              if (titleResult.success && titleResult.output) {
                const newTitle = titleResult.output.trim();
                await sessionManager.setCurrentSessionTitle(newTitle);
              }
            } catch (error) {
              // 静默失败，只记录到日志
              logger.debug(`生成标题失败: ${(error as Error).message}`);
            }
          }
        } catch (error) {
          const err = error as any;

          // 原样输出 API 返回的错误信息
          if (err.message) {
            if (err.message.includes('{')) {
              console.log(chalk.red(`\n❌ ${err.message}\n`));
            } else {
              console.log(chalk.red(`\n❌ ${err.message}\n`));
            }
          } else {
            console.log(chalk.red(`\n❌ 未知错误\n`));
          }
        }

        // 继续下一轮对话
        setImmediate(() => chatLoop());
      };

      // 添加 line 监听器
      currentRl.on('line', onLine);
    };

    // 辅助函数：询问是否批准（使用按键监听）
    const askForApproval = (): Promise<'yes-once' | 'yes-all' | 'no'> => {
      return new Promise((resolve) => {
        console.log(chalk.green('1. 同意当前操作'));
        console.log(chalk.yellow('2. 同意所有后续操作'));
        console.log(chalk.red('3. 拒绝操作'));
        console.log(chalk.dim('\n按 1/2/3 键选择...\n'));

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
          // 不再二次截断 - 工具已经处理了截断
          const output = result.output || '';
          lines.push(`✓ 成功`);
          if (output) {
            lines.push(`\n${output}`);
          }
        } else {
          lines.push(`✗ 失败: ${result.error}`);

          // Add helpful hints for common errors
          if (result.error?.includes('Unknown tool')) {
            lines.push(
              `\nHint: Tool names are case-sensitive. Available tools: ${Array.from(toolEngine.getAllTools().map((t) => t.name)).join(', ')}`
            );
          } else if (result.error?.includes('Missing required parameter')) {
            lines.push(
              `\nHint: Check that all required parameters are provided in snake_case format (e.g., file_path not filePath)`
            );
          } else if (
            result.error?.includes('tool call format') ||
            result.error?.includes('parse')
          ) {
            lines.push(
              `\nHint: Tool calls must be valid JSON in code blocks. Use format: {"tool": "ToolName", "parameters": {...}}`
            );
          }
        }
        lines.push(''); // 空行分隔
      }

      return lines.join('\n');
    };

    // 在整个运行期间激活 P 键中断监听
    setupInterruptKey();

    chatLoop();
  });
