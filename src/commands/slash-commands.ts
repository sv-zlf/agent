/**
 * 斜杠命令系统
 * 支持 /init 和 /models 等命令
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';
import { getConfig } from '../config';
import type { Message } from '../types';
import type { Session } from '../core/session-manager';

/**
 * 命令处理结果
 */
export interface CommandResult {
  shouldContinue: boolean; // 是否继续执行（false 表示命令处理后停止）
  message?: string;        // 可选的返回消息
  systemPrompt?: string;   // 可选的系统提示词更新
}

/**
 * 命令处理器类型
 */
export type CommandHandler = (
  args: string,
  context: CommandContext
) => Promise<CommandResult>;

/**
 * 命令上下文
 */
export interface CommandContext {
  workingDirectory: string;
  config: any;
  messages: Message[];
  sessionManager?: any; // SessionManager 实例（可选）
  contextManager?: any; // ContextManager 实例（可选）
}

/**
 * 命令定义
 */
export interface CommandDefinition {
  name: string;
  description: string;
  handler: CommandHandler;
}

/**
 * 命令管理器
 */
export class CommandManager {
  private commands: Map<string, CommandDefinition> = new Map();

  constructor() {
    this.registerBuiltInCommands();
  }

  /**
   * 注册命令
   */
  registerCommand(command: CommandDefinition): void {
    this.commands.set(command.name, command);
  }

  /**
   * 注册内置命令
   */
  private registerBuiltInCommands(): void {
    this.registerCommand({
      name: 'init',
      description: '创建/更新项目设计文件 (DESIGN.md)',
      handler: this.handleInitCommand,
    });

    this.registerCommand({
      name: 'models',
      description: '列出可用模型或切换模型',
      handler: this.handleModelsCommand,
    });

    this.registerCommand({
      name: 'help',
      description: '显示可用命令列表',
      handler: this.handleHelpCommand,
    });

    // 会话管理命令
    this.registerCommand({
      name: 'session',
      description: '会话管理 (new/list/switch/delete)',
      handler: this.handleSessionCommand,
    });

    // 压缩管理命令
    this.registerCommand({
      name: 'compress',
      description: '上下文压缩管理 (on/off/status/manual)',
      handler: this.handleCompressCommand,
    });

    // Token 统计命令
    this.registerCommand({
      name: 'tokens',
      description: '显示当前 token 使用情况',
      handler: this.handleTokensCommand,
    });
  }

  /**
   * 检测输入是否是命令
   */
  isCommand(input: string): boolean {
    const trimmed = input.trim();
    return trimmed.startsWith('/');
  }

  /**
   * 解析命令名称和参数
   */
  parseCommand(input: string): { name: string; args: string } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return null;
    }

    // 移除开头的 /
    const withoutSlash = trimmed.slice(1);

    // 分割命令名和参数（第一个空格后都是参数）
    const firstSpaceIndex = withoutSlash.indexOf(' ');
    if (firstSpaceIndex === -1) {
      return { name: withoutSlash, args: '' };
    }

    const name = withoutSlash.slice(0, firstSpaceIndex);
    const args = withoutSlash.slice(firstSpaceIndex + 1).trim();

    return { name, args };
  }

  /**
   * 执行命令
   */
  async executeCommand(
    input: string,
    context: CommandContext
  ): Promise<CommandResult> {
    const parsed = this.parseCommand(input);
    if (!parsed) {
      return { shouldContinue: true };
    }

    const command = this.commands.get(parsed.name);
    if (!command) {
      return {
        shouldContinue: true,
        message: `未知命令: /${parsed.name}. 输入 /help 查看可用命令。`,
      };
    }

    console.log(chalk.cyan(`\n📝 执行命令: /${command.name}\n`));

    try {
      return await command.handler(parsed.args, context);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`命令执行失败: ${errorMsg}\n`));
      return { shouldContinue: true };
    }
  }

  /**
   * 获取所有命令
   */
  getCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /**
   * /init 命令处理器 - 创建项目设计文件
   */
  private async handleInitCommand(
    args: string,
    context: CommandContext
  ): Promise<CommandResult> {
    const designFilePath = path.join(context.workingDirectory, 'DESIGN.md');

    // 检查是否已存在
    const exists = await fs.access(designFilePath).then(() => true).catch(() => false);

    // 生成项目设计文档
    const designDoc = await this.generateDesignDocument(context.workingDirectory, exists);

    // 写入文件
    await fs.writeFile(designFilePath, designDoc, 'utf-8');

    const message = exists
      ? `已更新项目设计文件: ${designFilePath}`
      : `已创建项目设计文件: ${designFilePath}`;

    console.log(chalk.green(message));
    console.log(chalk.gray('\n包含以下内容:'));
    console.log(chalk.gray('  • 项目概述'));
    console.log(chalk.gray('  • 构建/测试命令'));
    console.log(chalk.gray('  • 代码风格指南'));
    console.log(chalk.gray('  • 项目结构说明'));
    console.log();

    return {
      shouldContinue: false, // 命令执行后停止
    };
  }

  /**
   * 生成项目设计文档
   */
  private async generateDesignDocument(
    workingDir: string,
    update: boolean
  ): Promise<string> {
    const lines: string[] = [];

    // 标题
    lines.push('# 项目设计文档');
    lines.push('');
    lines.push(`> 自动生成于 ${new Date().toLocaleString('zh-CN')}`);
    lines.push('');

    // 项目概述
    lines.push('## 项目概述');
    lines.push('');
    lines.push('本项目使用 GG CODE AI 编程助手进行开发。');
    lines.push('');

    // 构建/测试命令
    lines.push('## 构建/测试命令');
    lines.push('');

    // 尝试读取 package.json
    const packageJsonPath = path.join(workingDir, 'package.json');
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      if (packageJson.scripts) {
        lines.push('### npm scripts');
        lines.push('');
        lines.push('```bash');
        for (const [name, script] of Object.entries(packageJson.scripts)) {
          lines.push(`npm run ${name}  # ${script}`);
        }
        lines.push('```');
        lines.push('');
      }
    } catch {
      lines.push('未找到 package.json 文件。');
      lines.push('');
    }

    // 代码风格
    lines.push('## 代码风格指南');
    lines.push('');
    lines.push('### 导入顺序');
    lines.push('');
    lines.push('1. Node.js 内置模块');
    lines.push('2. 第三方库');
    lines.push('3. 项目内部模块');
    lines.push('');
    lines.push('### 命名约定');
    lines.push('');
    lines.push('- 文件名: kebab-case (例: `user-service.ts`)');
    lines.push('- 类名: PascalCase (例: `UserService`)');
    lines.push('- 函数/变量: camelCase (例: `getUserById`)');
    lines.push('- 常量: UPPER_SNAKE_CASE (例: `MAX_RETRY_COUNT`)');
    lines.push('');
    lines.push('### TypeScript 规范');
    lines.push('');
    lines.push('- 使用严格的类型检查');
    lines.push('- 避免使用 `any` 类型');
    lines.push('- 优先使用 `interface` 定义对象结构');
    lines.push('- 使用 `type` 定义联合类型或交叉类型');
    lines.push('');

    // 项目结构
    lines.push('## 项目结构');
    lines.push('');
    lines.push('```');
    const srcPath = path.join(workingDir, 'src');
    try {
      const items = await fs.readdir(srcPath, { withFileTypes: true });
      for (const item of items.slice(0, 20)) {
        // 只显示前20项
        const prefix = item.isDirectory() ? '📁 ' : '📄 ';
        lines.push(`${prefix}${item.name}`);
      }
      if (items.length > 20) {
        lines.push(`... (还有 ${items.length - 20} 项)`);
      }
    } catch {
      lines.push('(src 目录不存在或为空)');
    }
    lines.push('```');
    lines.push('');

    // 配置说明
    lines.push('## GG CODE 配置');
    lines.push('');
    lines.push('项目使用 GG CODE 配置文件 `.ggrc.json` 进行配置。');
    lines.push('');
    lines.push('主要配置项:');
    lines.push('- `api.base_url`: API 基础 URL');
    lines.push('- `api.model`: 使用的模型名称');
    lines.push('- `agent.max_history`: 最大历史记录数');
    lines.push('- `agent.max_iterations`: 最大迭代次数');
    lines.push('- `agent.auto_approve`: 是否自动批准工具调用');
    lines.push('');

    // 开发指南
    lines.push('## 开发指南');
    lines.push('');
    lines.push('### 使用 GG CODE');
    lines.push('');
    lines.push('```bash');
    lines.push('npm run agent          # 启动 AI 编程助手');
    lines.push('npm run agent -- -a explore  # 使用 explore agent (只读模式)');
    lines.push('npm run agent -- -a build    # 使用 build agent (构建专家)');
    lines.push('```');
    lines.push('');
    lines.push('### 斜杠命令');
    lines.push('');
    lines.push('- `/init` - 创建/更新项目设计文件');
    lines.push('- `/models` - 列出可用模型或切换模型');
    lines.push('- `/help` - 显示帮助信息');
    lines.push('- 在 AI 思考时按 `P` 键中断操作');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * /models 命令处理器 - 模型管理
   */
  private async handleModelsCommand(
    args: string,
    context: CommandContext
  ): Promise<CommandResult> {
    const config = context.config;

    // 如果没有参数，列出可用模型
    if (!args) {
      return this.listModels(config);
    }

    // 如果有参数，尝试切换模型
    return this.switchModel(args.trim(), config, context.workingDirectory);
  }

  /**
   * 列出可用模型
   */
  private async listModels(config: any): Promise<CommandResult> {
    const currentModel = config.getAPIConfig().model;

    console.log(chalk.cyan('\n📋 可用模型列表:\n'));
    console.log(chalk.yellow(`当前模型: ${currentModel}\n`));

    // 常用模型列表
    const commonModels = [
      { name: 'claude-3-5-sonnet-20241022', provider: 'Anthropic', description: 'Claude 3.5 Sonnet (推荐)' },
      { name: 'claude-3-opus-20240229', provider: 'Anthropic', description: 'Claude 3 Opus' },
      { name: 'gpt-4o', provider: 'OpenAI', description: 'GPT-4o' },
      { name: 'gpt-4o-mini', provider: 'OpenAI', description: 'GPT-4o Mini (快速)' },
      { name: 'deepseek-chat', provider: 'DeepSeek', description: 'DeepSeek Chat' },
    ];

    console.log(chalk.gray('模型名称\t\t提供商\t描述'));
    console.log(chalk.gray('-'.repeat(80)));

    for (const model of commonModels) {
      const isCurrent = model.name === currentModel;
      const prefix = isCurrent ? chalk.green('→ ') : '  ';
      console.log(`${prefix}${chalk.cyan(model.name)}\t${chalk.yellow(model.provider)}\t${model.description}`);
    }

    console.log();
    console.log(chalk.gray('使用方法:'));
    console.log(chalk.gray('  /models <模型名称>    # 切换到指定模型'));
    console.log();

    return {
      shouldContinue: false,
    };
  }

  /**
   * 切换模型
   */
  private async switchModel(
    modelName: string,
    config: any,
    workingDir: string
  ): Promise<CommandResult> {
    const oldModel = config.getAPIConfig().model;

    if (modelName === oldModel) {
      console.log(chalk.yellow(`当前已经是 ${modelName} 模型\n`));
      return { shouldContinue: false };
    }

    // 更新配置文件
    const configPath = path.join(workingDir, '.ggrc.json');
    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      const configObj = JSON.parse(configContent);
      configObj.api.model = modelName;
      await fs.writeFile(configPath, JSON.stringify(configObj, null, 2), 'utf-8');

      console.log(chalk.green(`✓ 已切换模型:`));
      console.log(chalk.gray(`  从: ${oldModel}`));
      console.log(chalk.gray(`  到: ${modelName}\n`));

      return {
        shouldContinue: false,
      };
    } catch (error) {
      console.log(chalk.red(`✗ 切换模型失败: ${(error as Error).message}\n`));
      return { shouldContinue: false };
    }
  }

  /**
   * /help 命令处理器
   */
  private async handleHelpCommand(): Promise<CommandResult> {
    console.log(chalk.cyan('\n📖 可用命令:\n'));

    for (const cmd of this.getCommands()) {
      console.log(chalk.yellow(`/${cmd.name}`));
      console.log(chalk.gray(`  ${cmd.description}`));
      console.log();
    }

    console.log(chalk.gray('使用方法: 在提示符后输入 /命令名 [参数]'));
    console.log();

    return {
      shouldContinue: false,
    };
  }

  /**
   * /session 命令处理器 - 会话管理
   */
  private async handleSessionCommand(
    args: string,
    context: CommandContext
  ): Promise<CommandResult> {
    const { sessionManager, contextManager } = context;

    if (!sessionManager) {
      console.log(chalk.red('✗ 会话管理器未初始化\n'));
      return { shouldContinue: false };
    }

    // 解析子命令
    const parts = args.trim().split(/\s+/);
    const subCommand = parts[0] || 'list';

    switch (subCommand) {
      case 'new':
        return this.handleNewSession(parts.slice(1).join(' '), sessionManager, contextManager);
      case 'list':
        return this.handleListSessions(sessionManager);
      case 'switch':
        return this.handleSwitchSession(parts[1], sessionManager, contextManager);
      case 'delete':
        return this.handleDeleteSession(parts[1], sessionManager);
      default:
        console.log(chalk.yellow('\n📋 会话管理命令:\n'));
        console.log(chalk.gray('  /session new [名称]     - 创建新会话'));
        console.log(chalk.gray('  /session list           - 列出所有会话'));
        console.log(chalk.gray('  /session switch <id>    - 切换到指定会话'));
        console.log(chalk.gray('  /session delete <id>    - 删除指定会话'));
        console.log();
        return { shouldContinue: false };
    }
  }

  /**
   * 创建新会话
   */
  private async handleNewSession(
    name: string,
    sessionManager: any,
    contextManager: any
  ): Promise<CommandResult> {
    const sessionName = name.trim() || `会话 ${new Date().toLocaleString('zh-CN')}`;
    const newSession = await sessionManager.createSession(sessionName, 'default');

    // 更新 contextManager 的会话ID
    if (contextManager) {
      contextManager.setSessionId(newSession.id);
      contextManager.clearContext();
    }

    console.log(chalk.green(`✓ 已创建新会话:`));
    console.log(chalk.gray(`  ID: ${newSession.id}`));
    console.log(chalk.gray(`  名称: ${newSession.name}`));
    console.log();

    return { shouldContinue: false };
  }

  /**
   * 列出所有会话
   */
  private async handleListSessions(sessionManager: any): Promise<CommandResult> {
    const sessions = sessionManager.getAllSessions();
    const currentSession = sessionManager.getCurrentSession();

    console.log(chalk.cyan('\n📋 所有会话:\n'));

    if (sessions.length === 0) {
      console.log(chalk.gray('  (暂无会话)\n'));
      return { shouldContinue: false };
    }

    for (const session of sessions) {
      const isCurrent = currentSession && session.id === currentSession.id;
      const prefix = isCurrent ? chalk.green('→ ') : '  ';
      const nameDisplay = isCurrent ? chalk.green(session.name) : session.name;
      const time = new Date(session.lastActiveAt).toLocaleString('zh-CN');

      console.log(`${prefix}${nameDisplay}`);
      console.log(chalk.gray(`    ID: ${session.id.substring(0, 8)}...`));
      console.log(chalk.gray(`    最后活跃: ${time}`));
      console.log();
    }

    return { shouldContinue: false };
  }

  /**
   * 切换会话
   */
  private async handleSwitchSession(
    sessionId: string,
    sessionManager: any,
    contextManager: any
  ): Promise<CommandResult> {
    if (!sessionId) {
      console.log(chalk.red('✗ 请指定会话 ID\n'));
      console.log(chalk.gray('使用方法: /session switch <会话ID>'));
      console.log(chalk.gray('提示: 使用 /session list 查看所有会话'));
      console.log();
      return { shouldContinue: false };
    }

    try {
      // 支持短ID（前8位）或完整ID
      const sessions = sessionManager.getAllSessions();
      const targetSession = sessions.find((s: Session) =>
        s.id === sessionId || s.id.startsWith(sessionId)
      );

      if (!targetSession) {
        console.log(chalk.red(`✗ 会话不存在: ${sessionId}\n`));
        return { shouldContinue: false };
      }

      await sessionManager.switchSession(targetSession.id);

      // 更新 contextManager 的会话ID并清空上下文
      if (contextManager) {
        contextManager.setSessionId(targetSession.id);
        contextManager.clearContext();
      }

      console.log(chalk.green(`✓ 已切换到会话:`));
      console.log(chalk.gray(`  名称: ${targetSession.name}`));
      console.log(chalk.gray(`  ID: ${targetSession.id}`));
      console.log();

      return {
        shouldContinue: false,
        message: `已切换到会话: ${targetSession.name}`,
      };
    } catch (error) {
      console.log(chalk.red(`✗ 切换会话失败: ${(error as Error).message}\n`));
      return { shouldContinue: false };
    }
  }

  /**
   * 删除会话
   */
  private async handleDeleteSession(
    sessionId: string,
    sessionManager: any
  ): Promise<CommandResult> {
    if (!sessionId) {
      console.log(chalk.red('✗ 请指定会话 ID\n'));
      console.log(chalk.gray('使用方法: /session delete <会话ID>'));
      console.log(chalk.gray('提示: 使用 /session list 查看所有会话'));
      console.log();
      return { shouldContinue: false };
    }

    try {
      // 支持短ID（前8位）或完整ID
      const sessions = sessionManager.getAllSessions();
      const targetSession = sessions.find((s: Session) =>
        s.id === sessionId || s.id.startsWith(sessionId)
      );

      if (!targetSession) {
        console.log(chalk.red(`✗ 会话不存在: ${sessionId}\n`));
        return { shouldContinue: false };
      }

      const currentSession = sessionManager.getCurrentSession();
      const isCurrent = currentSession && targetSession.id === currentSession.id;

      await sessionManager.deleteSession(targetSession.id);

      console.log(chalk.green(`✓ 已删除会话:`));
      console.log(chalk.gray(`  名称: ${targetSession.name}`));
      console.log(chalk.gray(`  ID: ${targetSession.id}`));

      if (isCurrent) {
        console.log(chalk.yellow('  注意: 已删除当前会话，已自动切换到其他会话'));
      }

      console.log();

      return { shouldContinue: false };
    } catch (error) {
      console.log(chalk.red(`✗ 删除会话失败: ${(error as Error).message}\n`));
      return { shouldContinue: false };
    }
  }

  /**
   * /compress 命令处理器 - 压缩管理
   */
  private async handleCompressCommand(
    args: string,
    context: CommandContext
  ): Promise<CommandResult> {
    const { contextManager } = context;

    if (!contextManager) {
      console.log(chalk.red('✗ 上下文管理器未初始化\n'));
      return { shouldContinue: false };
    }

    const subCommand = args.trim() || 'status';

    switch (subCommand) {
      case 'on':
        contextManager.enableAutoCompress();
        console.log(chalk.green('✓ 已启用自动压缩\n'));
        console.log(chalk.gray('  当上下文接近限制时自动压缩历史消息'));
        console.log();
        return { shouldContinue: false };

      case 'off':
        contextManager.disableAutoCompress();
        console.log(chalk.yellow('✓ 已禁用自动压缩\n'));
        return { shouldContinue: false };

      case 'manual':
        console.log(chalk.cyan('🔄 手动压缩上下文...\n'));
        const result = await contextManager.compact();
        if (result.compressed) {
          console.log(chalk.green('✓ 压缩完成:'));
          console.log(chalk.gray(`  原始: ${result.originalTokens} tokens`));
          console.log(chalk.gray(`  压缩后: ${result.compressedTokens} tokens`));
          console.log(chalk.gray(`  节省: ${result.savedTokens} tokens (${Math.round(result.savedTokens / result.originalTokens * 100)}%)`));
          if (result.prunedParts > 0) {
            console.log(chalk.gray(`  修剪: ${result.prunedParts} 个部件`));
          }
          console.log();
        } else {
          console.log(chalk.yellow('  上下文无需压缩\n'));
        }
        return { shouldContinue: false };

      case 'status':
        const compactor = contextManager.getCompactor();
        const config = compactor.getConfig();
        const needsCompaction = compactor.needsCompaction(contextManager.getRawMessages());
        const currentTokens = contextManager.estimateTokens();

        console.log(chalk.cyan('📊 压缩状态:\n'));
        console.log(chalk.gray(`  自动压缩: ${config.enabled ? chalk.green('启用') : chalk.yellow('禁用')}`));
        console.log(chalk.gray(`  当前 tokens: ${currentTokens}`));
        console.log(chalk.gray(`  最大限制: ${config.maxTokens}`));
        console.log(chalk.gray(`  保留空间: ${config.reserveTokens}`));
        console.log(chalk.gray(`  使用率: ${Math.round(currentTokens / (config.maxTokens - config.reserveTokens) * 100)}%`));
        console.log(chalk.gray(`  需要压缩: ${needsCompaction ? chalk.red('是') : chalk.green('否')}`));
        console.log();
        return { shouldContinue: false };

      default:
        console.log(chalk.yellow('\n📋 压缩管理命令:\n'));
        console.log(chalk.gray('  /compress on        - 启用自动压缩'));
        console.log(chalk.gray('  /compress off       - 禁用自动压缩'));
        console.log(chalk.gray('  /compress manual    - 立即压缩上下文'));
        console.log(chalk.gray('  /compress status    - 查看压缩状态'));
        console.log();
        return { shouldContinue: false };
    }
  }

  /**
   * /tokens 命令处理器 - 显示 token 使用情况
   */
  private async handleTokensCommand(
    args: string,
    context: CommandContext
  ): Promise<CommandResult> {
    const { contextManager } = context;

    if (!contextManager) {
      console.log(chalk.red('✗ 上下文管理器未初始化\n'));
      return { shouldContinue: false };
    }

    const messages = contextManager.getRawMessages();
    const compactor = contextManager.getCompactor();
    const totalTokens = compactor.estimateMessages(messages);

    console.log(chalk.cyan('📊 Token 使用情况:\n'));
    console.log(chalk.gray(`  总 tokens: ${totalTokens}`));

    // 按消息类型统计
    let userMsgs = 0;
    let assistantMsgs = 0;
    let systemMsgs = 0;

    for (const msg of messages) {
      if (msg.role === 'user') userMsgs++;
      else if (msg.role === 'assistant') assistantMsgs++;
      else if (msg.role === 'system') systemMsgs++;
    }

    console.log(chalk.gray(`  消息数量:`));
    console.log(chalk.gray(`    用户: ${userMsgs}`));
    console.log(chalk.gray(`    助手: ${assistantMsgs}`));
    console.log(chalk.gray(`    系统: ${systemMsgs}`));
    console.log();

    const config = compactor.getConfig();
    const usagePercent = Math.round(totalTokens / (config.maxTokens - config.reserveTokens) * 100);

    if (usagePercent > 80) {
      console.log(chalk.yellow('⚠️  上下文使用率较高，建议启用压缩: /compress on\n'));
    } else if (usagePercent > 50) {
      console.log(chalk.gray('ℹ️  可以使用 /compress status 查看详细状态\n'));
    }

    return { shouldContinue: false };
  }
}

/**
 * 创建命令管理器
 */
export function createCommandManager(): CommandManager {
  return new CommandManager();
}
