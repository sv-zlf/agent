/**
 * 斜杠命令系统
 * 支持 /init 和 /models 等命令
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import type { Message } from '../types';
import { select, confirm, question, multiSelect, getConfigPath } from '../utils';
import type { Session } from '../core/session-manager';

/**
 * 命令处理结果
 */
export interface CommandResult {
  shouldContinue: boolean; // 是否继续执行（false 表示命令处理后停止）
  message?: string; // 可选的返回消息
  systemPrompt?: string; // 可选的系统提示词更新
  sessionSwitched?: {
    // 会话切换信息
    sessionId: string;
    historyFile: string;
  };
}

/**
 * 命令处理器类型
 */
export type CommandHandler = (args: string, context: CommandContext) => Promise<CommandResult>;

/**
 * 命令上下文
 */
export interface CommandContext {
  workingDirectory: string;
  config: any;
  messages: Message[];
  sessionManager?: any; // SessionManager 实例（可选）
  contextManager?: any; // ContextManager 实例（可选）
  /**
   * 在交互式选择前移除按键监听器
   * 返回恢复函数
   */
  pauseKeyListener?: () => () => void;
  /**
   * 可选的 API 适配器（用于需要调用 AI 的命令）
   */
  apiAdapter?: any; // ChatAPIAdapter 实例（可选）
  /**
   * 退出回调（用于 /exit 命令）
   */
  onExit?: () => void;
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
   * 获取所有命令
   */
  getCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
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
      name: 'exit',
      description: '退出程序',
      handler: this.handleExitCommand.bind(this),
    });

    this.registerCommand({
      name: 'init',
      description: '创建/更新项目文档 (AGENTS.md)',
      handler: this.handleInitCommand.bind(this),
    });

    this.registerCommand({
      name: 'models',
      description: '设置或查看模型名称',
      handler: this.handleModelsCommand.bind(this),
    });

    this.registerCommand({
      name: 'help',
      description: '显示可用命令列表',
      handler: this.handleHelpCommand.bind(this),
    });

    // 会话管理命令
    this.registerCommand({
      name: 'session',
      description: '会话管理 (new/list/switch/delete)',
      handler: this.handleSessionCommand.bind(this),
    });

    // 压缩管理命令
    this.registerCommand({
      name: 'compress',
      description: '上下文压缩管理 (on/off/status/manual)',
      handler: this.handleCompressCommand.bind(this),
    });

    // Token 统计命令
    this.registerCommand({
      name: 'tokens',
      description: '显示当前 token 使用情况',
      handler: this.handleTokensCommand.bind(this),
    });

    // 设置命令
    this.registerCommand({
      name: 'setting',
      description: 'API 参数设置 (temperature/top_p/top_k/repetition_penalty)',
      handler: this.handleSettingCommand.bind(this),
    });

    // 交互式测试命令
    this.registerCommand({
      name: 'test',
      description: '测试交互式选择功能',
      handler: this.handleTestCommand.bind(this),
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
  async executeCommand(input: string, context: CommandContext): Promise<CommandResult> {
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
  /**
   * /init 命令处理器 - 创建/更新 AGENTS.md 项目文档
   * 使用 AI 分析项目并生成标准化文档
   */
  private async handleInitCommand(_args: string, context: CommandContext): Promise<CommandResult> {
    const agentsFilePath = path.join(context.workingDirectory, 'AGENTS.md');

    // 检查是否需要使用 AI 生成（有 API adapter）
    if (!context.apiAdapter) {
      return await this.generateBasicAgentsDocument(context.workingDirectory, agentsFilePath);
    }

    console.log(chalk.cyan('🔍 正在分析项目并生成 AGENTS.md...\n'));

    try {
      // 1. 读取提示词模板
      // 优先尝试使用打包的提示词
      const { getProjectPrompt } = await import('../utils/packed-prompts');
      let promptTemplate = getProjectPrompt('init');

      if (!promptTemplate) {
        // 回退到文件读取（开发环境）
        const isDev = fsSync.existsSync(path.join(process.cwd(), 'src'));
        const promptsBasePath = path.join(process.cwd(), isDev ? 'src/prompts' : 'dist/prompts');
        const templatePath = path.join(promptsBasePath, 'init.txt');

        promptTemplate = await fs.readFile(templatePath, 'utf-8').catch(() => {
          console.log(chalk.yellow('⚠️  未找到 prompts/init.txt，使用默认模板\n'));
          return this.getDefaultInitTemplate();
        });
      }

      // 2. 替换模板变量
      promptTemplate = promptTemplate.replace(/\$\{path\}/g, context.workingDirectory);

      // 3. 收集项目上下文信息
      const projectContext = await this.collectProjectContext(context.workingDirectory);

      // 4. 构建发送给 AI 的消息
      const userContent = `${promptTemplate}\n\n## 项目上下文信息\n\n${projectContext}`;

      const messages: Message[] = [
        {
          role: 'system',
          content:
            '你是一个专业的项目文档生成助手。请分析提供的项目信息，生成清晰、准确、实用的 AGENTS.md 文档。',
        },
        {
          role: 'user',
          content: userContent,
        },
      ];

      // 5. 调用 AI 生成文档
      let generatedDoc: string | undefined;
      try {
        // 由于API有并发限制，使用重试机制

        let retryCount = 0;
        const maxRetries = 3;
        let retryDelay = 2000; // 2秒

        while (retryCount < maxRetries) {
          try {
            // 为文档生成任务设置更长的超时时间（90秒）
            generatedDoc = await context.apiAdapter.chat(messages, {
              temperature: 0.3, // 较低温度以确保稳定性
              timeout: 90000, // 90秒超时（文档生成任务）
            });
            break; // 成功则跳出重试循环
          } catch (apiError: any) {
            retryCount++;

            // 精确判断429错误类型
            if (apiError.message && apiError.message.includes('429')) {
              // 判断是否是配额/使用上限（需要等待重置，不需要重试）
              if (
                apiError.message.includes('使用上限') ||
                apiError.message.includes('限额') ||
                apiError.message.includes('quota') ||
                apiError.message.includes('limit')
              ) {
                throw apiError; // 配额问题，直接抛出，不重试
              }

              // 判断是否是并发数过高（可以重试）
              if (
                apiError.message.includes('并发') ||
                apiError.message.includes('concurrent') ||
                apiError.message.includes('过高')
              ) {
                if (retryCount < maxRetries) {
                  await new Promise((resolve) => setTimeout(resolve, retryDelay));
                  retryDelay *= 2; // 指数退避
                } else {
                  throw apiError; // 重试次数用完
                }
              } else {
                // 其他类型的429错误，有限重试
                if (retryCount < maxRetries) {
                  await new Promise((resolve) => setTimeout(resolve, retryDelay));
                  retryDelay *= 2;
                } else {
                  throw apiError;
                }
              }
            } else if (retryCount >= maxRetries) {
              throw apiError; // 重试次数用完，抛出错误
            } else {
              throw apiError; // 非429错误，直接抛出
            }
          }
        }
      } catch (apiError) {
        throw apiError; // 重新抛出以触发降级逻辑
      }

      // 6. 清理和保存生成的文档
      if (!generatedDoc) {
        throw new Error('生成文档失败：未获得API响应');
      }
      const cleanedDoc = this.cleanGeneratedDoc(generatedDoc);
      await fs.writeFile(agentsFilePath, cleanedDoc, 'utf-8');

      console.log(chalk.green(`✓ 已生成项目文档: ${agentsFilePath}`));

      return {
        shouldContinue: false,
      };
    } catch (error) {
      console.log(chalk.red(`✗ 生成文档失败: ${(error as Error).message}\n`));

      // 降级到基础模板
      return await this.generateBasicAgentsDocument(context.workingDirectory, agentsFilePath);
    }
  }

  /**
   * 收集项目上下文信息
   */
  private async collectProjectContext(workingDir: string): Promise<string> {
    const contextParts: Array<{ priority: number; name: string; content: string }> = [];

    // 优先级定义：1=最高，5=最低
    // 高优先级：核心配置和文档
    // 中优先级：现有文档
    // 低优先级：补充信息

    // 1. README.md (优先级 1 - 项目核心信息)
    const readmePath = path.join(workingDir, 'README.md');
    try {
      const readme = await fs.readFile(readmePath, 'utf-8');
      const readmeSnippet = readme.substring(0, 2000); // 减少到 2000 字符
      contextParts.push({
        priority: 1,
        name: 'README.md',
        content: `### README.md\n\`\`\`\n${readmeSnippet}\n\`\`\`\n`,
      });
    } catch {}

    // 2. package.json (优先级 1 - 构建命令)
    const packageJsonPath = path.join(workingDir, 'package.json');
    try {
      const pkgJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      if (pkgJson.scripts) {
        contextParts.push({
          priority: 1,
          name: 'package.json scripts',
          content: `### package.json scripts\n\`\`\`json\n${JSON.stringify(pkgJson.scripts, null, 2)}\n\`\`\`\n`,
        });
      }
      // 添加项目名称和描述
      if (pkgJson.name || pkgJson.description) {
        const projectInfo = [
          pkgJson.name ? `**项目名称**: ${pkgJson.name}` : '',
          pkgJson.description ? `**描述**: ${pkgJson.description}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        if (projectInfo) {
          contextParts.push({
            priority: 1,
            name: '项目信息',
            content: `### 项目信息\n${projectInfo}\n`,
          });
        }
      }
    } catch {}

    // 3. 现有的 AGENTS.md (优先级 2 - 用于改进)
    const agentsPath = path.join(workingDir, 'AGENTS.md');
    try {
      const existingAgents = await fs.readFile(agentsPath, 'utf-8');
      // 只取前 1500 字符用于参考
      const agentsSnippet = existingAgents.substring(0, 1500);
      contextParts.push({
        priority: 2,
        name: '现有 AGENTS.md',
        content: `### 现有的 AGENTS.md（用于参考）\n\`\`\`\n${agentsSnippet}\n\`\`\`\n`,
      });
    } catch {}

    // 4. .cursorrules (优先级 3 - 代码风格)
    const cursorRulesPath = path.join(workingDir, '.cursorrules');
    try {
      const cursorRules = await fs.readFile(cursorRulesPath, 'utf-8');
      // 限制在 1000 字符
      const rulesSnippet = cursorRules.substring(0, 1000);
      contextParts.push({
        priority: 3,
        name: '.cursorrules',
        content: `### .cursorrules（代码风格）\n\`\`\`\n${rulesSnippet}\n\`\`\`\n`,
      });
    } catch {}

    // 5. CONTRIBUTING.md (优先级 3 - 开发规范)
    const contributingPath = path.join(workingDir, 'CONTRIBUTING.md');
    try {
      const contributing = await fs.readFile(contributingPath, 'utf-8');
      // 限制在 1500 字符
      const contribSnippet = contributing.substring(0, 1500);
      contextParts.push({
        priority: 3,
        name: 'CONTRIBUTING.md',
        content: `### CONTRIBUTING.md（开发规范）\n\`\`\`\n${contribSnippet}\n\`\`\`\n`,
      });
    } catch {}

    // 6. src/ 目录结构（优先级 4 - 结构信息）
    try {
      const srcPath = path.join(workingDir, 'src');
      const items = await fs.readdir(srcPath, { withFileTypes: true });
      const structure = items
        .slice(0, 20) // 增加到 20 个
        .map((item) => `${item.isDirectory() ? '📁' : '📄'} ${item.name}`)
        .join('\n');
      contextParts.push({
        priority: 4,
        name: 'src/ 目录结构',
        content: `### src/ 目录结构\n\`\`\`\n${structure}\n\`\`\`\n`,
      });
    } catch {}

    // 7. .cursor/rules/ (优先级 5 - 低优先级，可能很长)
    const cursorRulesDir = path.join(workingDir, '.cursor', 'rules');
    try {
      const files = await fs.readdir(cursorRulesDir);
      // 只取前 3 个文件，每个最多 500 字符
      for (const file of files.slice(0, 3)) {
        try {
          const content = await fs.readFile(path.join(cursorRulesDir, file), 'utf-8');
          const snippet = content.substring(0, 500);
          contextParts.push({
            priority: 5,
            name: `.cursor/rules/${file}`,
            content: `### .cursor/rules/${file}\n\`\`\`\n${snippet}\n\`\`\`\n`,
          });
        } catch {}
      }
    } catch {}

    // 8. .github/copilot-instructions.md (优先级 5 - 低优先级)
    const copilotInstructionsPath = path.join(workingDir, '.github', 'copilot-instructions.md');
    try {
      const copilotInstructions = await fs.readFile(copilotInstructionsPath, 'utf-8');
      // 限制在 800 字符
      const snippet = copilotInstructions.substring(0, 800);
      contextParts.push({
        priority: 5,
        name: 'copilot-instructions.md',
        content: `### .github/copilot-instructions.md\n\`\`\`\n${snippet}\n\`\`\`\n`,
      });
    } catch {}

    // 按优先级排序，并限制总长度
    contextParts.sort((a, b) => a.priority - b.priority);

    // 上下文长度限制（字符数）- 进一步减少到 5000 以确保快速响应
    const MAX_CONTEXT_LENGTH = 5000;
    let totalLength = 0;
    const selectedParts: string[] = [];

    for (const part of contextParts) {
      const partLength = part.content.length;

      // 如果添加这个部分会超过限制，检查是否可以截断
      if (totalLength + partLength > MAX_CONTEXT_LENGTH) {
        // 高优先级（1-2）的总是包含，可能截断
        if (part.priority <= 2) {
          const remainingSpace = MAX_CONTEXT_LENGTH - totalLength;
          if (remainingSpace > 200) {
            // 至少保留 200 字符
            // 截断内容
            const truncated = part.content.substring(0, remainingSpace - 50) + '\n...(已截断)';
            selectedParts.push(truncated);
            totalLength += remainingSpace;
          }
        }
        // 达到限制后，只保留高优先级的内容
        if (totalLength >= MAX_CONTEXT_LENGTH * 0.9) {
          break;
        }
      } else {
        selectedParts.push(part.content);
        totalLength += partLength;
      }
    }

    const finalContext = selectedParts.join('\n');
    return finalContext;
  }

  /**
   * 清理 AI 生成的文档
   */
  private cleanGeneratedDoc(doc: string): string {
    let cleaned = doc;

    // 移除可能的外层 markdown 代码块标记
    cleaned = cleaned.replace(/^```markdown\n?\n?([\s\S]*?)\n?```$/s, '$1');
    cleaned = cleaned.replace(/^```\n?\n?([\s\S]*?)\n?```$/s, '$1');

    // 移除 AI 的常见对话填充词（在文档开头）
    const fillerPatterns = [
      /^(以下是|Here is|这是| Below is|I'll create|I will generate|I have created|生成的|创建的).*?\n\n?/im,
      /^(当然|好的|没问题|Sure|OK|Certainly).*?\n\n?/im,
    ];

    for (const pattern of fillerPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // 移除结尾的对话填充词
    cleaned = cleaned.replace(/\n\n?(希望|Hope|如有|If you have|请|Please).*$/im, '');

    // 确保文档以 # AGENTS.md 开头（如果没有，添加它）
    if (!cleaned.startsWith('#')) {
      // 查找第一个 # 标题
      const firstTitleMatch = cleaned.match(/\n#+\s/);
      if (firstTitleMatch && firstTitleMatch.index !== undefined && firstTitleMatch.index > 0) {
        // 移除第一个标题之前的内容
        cleaned = cleaned.substring(firstTitleMatch.index);
      }
    }

    // 清理多余的空行（超过2个连续空行合并为2个）
    cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n');

    // 移除行首尾空白
    cleaned = cleaned.trim();

    // 确保文档不为空
    if (!cleaned) {
      throw new Error('生成的文档为空，可能是 AI 返回了无效内容');
    }

    return cleaned + '\n';
  }

  /**
   * 获取默认初始化模板
   */
  private getDefaultInitTemplate(): string {
    return `请分析当前代码库并创建/更新 AGENTS.md 文件，文件需要包含以下内容：

## 必需内容

1. **项目概述** - 从 README.md 提取项目名称和描述
2. **构建和测试命令** - 从 package.json 提取可用的 npm scripts
3. **代码风格指南** - 导入顺序、命名约定、TypeScript 规范
4. **项目结构** - 主要目录和文件的用途说明
5. **开发工作流** - 日常开发流程、代码审查标准

## 输出要求

- 文档长度约 150-200 行
- 使用清晰的 Markdown 格式
- 包含具体的代码示例
- 突出显示重要信息

项目路径: \${path}`;
  }

  /**
   * 生成基础 AGENTS.md 文档（不使用 AI）
   */
  private async generateBasicAgentsDocument(
    workingDir: string,
    agentsFilePath: string
  ): Promise<CommandResult> {
    const exists = await fs
      .access(agentsFilePath)
      .then(() => true)
      .catch(() => false);

    // 基础模板
    const lines: string[] = [];

    lines.push('# AGENTS.md');
    lines.push('');
    lines.push('> 本文档由 GG CODE 自动生成，包含项目概述、构建命令、代码风格等信息。');
    lines.push(`> 生成时间: ${new Date().toLocaleString('zh-CN')}`);
    lines.push('');
    lines.push('## 1. 项目概述');
    lines.push('');
    lines.push('本项目使用 GG CODE AI 编程助手进行开发。');
    lines.push('');

    // 尝试从 README.md 提取信息
    const readmePath = path.join(workingDir, 'README.md');
    try {
      const readmeContent = await fs.readFile(readmePath, 'utf-8');
      const titleMatch = readmeContent.match(/^#\s+(.+)$/m);
      if (titleMatch) {
        lines.push(`**${titleMatch[1]}**`);
        lines.push('');
      }
    } catch {}

    // package.json scripts
    lines.push('## 2. 构建和测试命令');
    lines.push('');
    const packageJsonPath = path.join(workingDir, 'package.json');
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      if (packageJson.scripts) {
        lines.push('```bash');
        for (const [name, script] of Object.entries(packageJson.scripts)) {
          lines.push(`npm run ${name.padEnd(20)} # ${script}`);
        }
        lines.push('```');
        lines.push('');
      }
    } catch {
      lines.push('未找到 package.json 文件。');
      lines.push('');
    }

    lines.push('## 3. 代码风格指南');
    lines.push('');
    lines.push('### 导入顺序');
    lines.push('1. Node.js 内置模块');
    lines.push('2. 第三方库');
    lines.push('3. 项目内部模块');
    lines.push('');
    lines.push('### 命名约定');
    lines.push('- 文件名: kebab-case (例: `user-service.ts`)');
    lines.push('- 类名: PascalCase (例: `UserService`)');
    lines.push('- 函数/变量: camelCase (例: `getUserById`)');
    lines.push('- 常量: UPPER_SNAKE_CASE (例: `MAX_RETRY_COUNT`)');
    lines.push('');
    lines.push('## 4. 开发工作流');
    lines.push('');
    lines.push('```bash');
    lines.push('npm run agent          # 启动 AI 编程助手');
    lines.push('npm run agent -- -a explore  # 只读探索模式');
    lines.push('npm run agent -- -a build    # 构建专家模式');
    lines.push('```');
    lines.push('');
    lines.push('*如需更详细的文档，请配置 API 后重新运行 `/init` 命令。*');
    lines.push('');

    await fs.writeFile(agentsFilePath, lines.join('\n'), 'utf-8');

    const message = exists ? '已更新项目文档' : '已创建项目文档';
    console.log(chalk.green(`${message}: ${agentsFilePath}\n`));

    return {
      shouldContinue: false,
    };
  }

  private async handleModelsCommand(args: string, context: CommandContext): Promise<CommandResult> {
    const config = context.config;

    // 如果没有参数，列出可用模型（交互式选择）
    if (!args) {
      return this.listModels(config, context.pauseKeyListener);
    }

    // 如果有参数，尝试切换模型
    return this.switchModel(args.trim(), config);
  }

  /**
   * 列出可用模型（交互式选择）
   */
  private async listModels(
    config: any,
    pauseKeyListener?: () => () => void
  ): Promise<CommandResult> {
    const currentModel = config.getAPIConfig().model;

    // 常用模型列表
    const commonModels = [
      { name: 'F-G-9B-V20241220-0000-00', provider: '内部', description: 'F-G-9B 模型' },
      { name: 'Qwen3-32B-20250627', provider: 'Aliyun', description: 'Qwen3' },
      { name: 'QWQ-32B_DPO_20250523', provider: 'Aliyun', description: 'QWQ' },
      { name: 'DeepSeek-V3-671B_20250725', provider: 'DeepSeek', description: 'DeepSeek Chat' },
    ];

    // 找到当前模型的索引
    const currentIndex = commonModels.findIndex((m) => m.name === currentModel);
    const defaultIndex = currentIndex >= 0 ? currentIndex : 0;

    // 暂停按键监听器（如果有）
    const resumeKeyListener = pauseKeyListener ? pauseKeyListener() : () => {};

    try {
      // 显示当前模型信息
      console.log(chalk.cyan('\n📋 模型配置\n'));
      console.log(chalk.yellow(`当前模型: ${currentModel}\n`));
      console.log(chalk.gray('选择要切换的模型:\n'));

      // 使用交互式选择器
      const selected = await select({
        message: '选择模型:',
        options: commonModels.map((model) => ({
          label: `${model.name}${model.name === currentModel ? ' ✅ (当前)' : ''}`,
          value: model.name,
          description: `${model.provider} - ${model.description}`,
        })),
        default: defaultIndex,
      });

      // 如果选择的不是当前模型，切换模型
      if (selected.value !== currentModel) {
        return this.switchModel(selected.value, config);
      }

      console.log(chalk.gray('\n已取消切换\n'));

      return {
        shouldContinue: false,
      };
    } catch (error: any) {
      if (error.name === 'UserCancelled' || error.message?.includes('User force closed')) {
        console.log(chalk.gray('\n已取消选择\n'));
      } else {
        console.log(chalk.red(`\n✗ 选择失败: ${error.message}\n`));
      }
      return { shouldContinue: false };
    } finally {
      // 恢复按键监听器
      resumeKeyListener();
    }
  }

  /**
   * 列出所有会话（交互式选择切换）
   */
  private async listSessions(
    sessionManager: any,
    pauseKeyListener?: () => () => void
  ): Promise<CommandResult> {
    const sessions = sessionManager.getAllSessions();
    const currentSessionId = sessionManager.getCurrentSession()?.id;

    // 找到当前会话的索引
    const currentIndex = sessions.findIndex((s: Session) => s.id === currentSessionId);
    const defaultIndex = currentIndex >= 0 ? currentIndex : 0;

    // 暂停按键监听器（如果有）
    const resumeKeyListener = pauseKeyListener ? pauseKeyListener() : () => {};

    try {
      console.log(chalk.cyan('\n📋 会话列表\n'));

      const selected = await select({
        message: '选择要切换的会话 (或按 Esc 取消):',
        options: sessions.map((session: Session) => ({
          label: `${session.title || session.name}${session.id === currentSessionId ? ' ✅' : ''}`,
          value: session.id,
          description: `${new Date(session.lastActiveAt).toLocaleString('zh-CN')} | ${session.agentType || 'default'}`,
        })),
        default: defaultIndex,
      });

      if (selected.value !== currentSessionId) {
        const switchedSession = await sessionManager.switchSession(selected.value);
        console.log(chalk.green(`\n✓ 已切换到会话: ${selected.label.replace(' ✅', '')}\n`));

        // 返回 sessionSwitched 信息，让 agent.ts 加载历史记录
        return {
          shouldContinue: false,
          sessionSwitched: {
            sessionId: switchedSession.id,
            historyFile: switchedSession.historyFile,
          },
        };
      }

      return { shouldContinue: false };
    } catch (error: any) {
      if (error.name === 'UserCancelled' || error.message?.includes('User force closed')) {
        console.log(chalk.gray('\n已取消切换\n'));
      } else {
        console.log(chalk.red(`\n✗ 选择失败: ${error.message}\n`));
      }
      return { shouldContinue: false };
    } finally {
      resumeKeyListener();
    }
  }

  /**
   * 切换模型
   */
  private async switchModel(modelName: string, config: any): Promise<CommandResult> {
    const oldModel = config.getAPIConfig().model;

    if (modelName === oldModel) {
      console.log(chalk.yellow(`当前已经是 ${modelName} 模型\n`));
      return { shouldContinue: false };
    }

    // 更新配置文件
    const configPath = getConfigPath();
    try {
      let configObj: any;

      // 读取现有配置或创建新配置
      try {
        const configContent = await fs.readFile(configPath, 'utf-8');
        configObj = JSON.parse(configContent);
      } catch {
        // 文件不存在，创建新配置
        configObj = {
          api: {
            model: modelName,
          },
        };
      }

      // 更新模型
      configObj.api = configObj.api || {};
      configObj.api.model = modelName;

      // 写入配置文件
      await fs.writeFile(configPath, JSON.stringify(configObj, null, 2), 'utf-8');

      // 更新内存中的配置（立即生效）
      config.updateAPIConfig('model', modelName);

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
    }

    console.log(chalk.gray('使用方法: 在提示符后输入 /命令名 [参数]'));

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
    const { sessionManager, pauseKeyListener } = context;

    if (!sessionManager) {
      console.log(chalk.red('✗ 会话管理器未初始化\n'));
      return { shouldContinue: false };
    }

    const subCommand = args.trim();

    // 无参数时显示交互式会话选择
    if (!subCommand || subCommand === 'list') {
      return this.listSessions(sessionManager, pauseKeyListener);
    }

    const [command, ...commandArgs] = subCommand.split(/\s+/);

    switch (command) {
      case 'status': {
        const currentSession = sessionManager.getCurrentSession();
        const agent = currentSession?.agentType || 'default';

        console.log(chalk.cyan('\n📋 会话状态:\n'));
        console.log(chalk.gray(`  当前会话: ${currentSession?.title || 'Default Session'}`));
        console.log(chalk.gray(`  Agent 类型: ${agent}`));
        console.log(chalk.gray(`  会话 ID: ${currentSession?.id || 'default'}`));

        // 显示摘要信息
        if (currentSession?.summary) {
          console.log(chalk.blue(`\n📝 代码统计:`));
          if (currentSession.summary.title) {
            console.log(chalk.blue(`  标题: ${currentSession.summary.title}`));
          }
          console.log(chalk.gray(`  修改文件: ${currentSession.summary.files} 个`));
          console.log(chalk.gray(`  新增: +${currentSession.summary.additions} 行`));
          console.log(chalk.gray(`  删除: -${currentSession.summary.deletions} 行`));
          if (currentSession.summary.modifiedFiles.length > 0) {
            console.log(chalk.gray(`  文件列表:`));
            currentSession.summary.modifiedFiles.slice(0, 5).forEach((file: string) => {
              console.log(chalk.gray(`    • ${file}`));
            });
            if (currentSession.summary.modifiedFiles.length > 5) {
              console.log(
                chalk.gray(`    ... 还有 ${currentSession.summary.modifiedFiles.length - 5} 个文件`)
              );
            }
          }
          console.log(
            chalk.gray(
              `  更新时间: ${new Date(currentSession.summary.generatedAt).toLocaleString('zh-CN')}`
            )
          );
        }

        if (currentSession?.stats) {
          console.log(chalk.gray(`\n📊 统计信息:`));
          console.log(chalk.gray(`  消息数: ${currentSession.stats.totalMessages}`));
          console.log(chalk.gray(`  工具调用: ${currentSession.stats.toolCalls}`));
          if (currentSession.stats.modifiedFiles.length > 0) {
            console.log(chalk.gray(`  修改文件: ${currentSession.stats.modifiedFiles.length}`));
          }
          if (currentSession.stats.summariesGenerated) {
            console.log(chalk.gray(`  摘要生成: ${currentSession.stats.summariesGenerated} 次`));
          }
        }

        if (currentSession?.parentID) {
          console.log(chalk.gray(`\n📍 父会话: ${currentSession.parentID.substring(0, 8)}...`));
        }
        const children = sessionManager.getChildSessions(currentSession?.id || '');
        if (children.length > 0) {
          console.log(chalk.gray(`\n🌿 子会话 (${children.length}):`));
          children.forEach((child: Session) => {
            console.log(chalk.gray(`  - ${child.title} (${child.id.substring(0, 8)}...)`));
          });
        }

        console.log(chalk.gray(`\n  输入 /session 切换会话`));
        return { shouldContinue: false };
      }

      case 'list': {
        const sessions = sessionManager.getAllSessions();
        console.log(chalk.cyan(`\n📋 所有会话 (${sessions.length}):\n`));

        sessions.forEach((session: Session, index: number) => {
          const isCurrent = session.id === sessionManager.getCurrentSession()?.id;
          const marker = isCurrent ? chalk.cyan('→') : ' ';
          const title = session.title || session.name;
          const date = new Date(session.lastActiveAt).toLocaleString('zh-CN');

          console.log(marker + ' ' + (index + 1) + '. ' + title);
          console.log(chalk.gray(`   ID: ${session.id.substring(0, 12)}...`));
          console.log(chalk.gray(`   活跃: ${date}`));

          // 显示摘要信息
          if (session.summary) {
            if (session.summary.title) {
              console.log(chalk.blue(`   📝 ${session.summary.title}`));
            }
            if (session.summary.files > 0) {
              console.log(
                chalk.gray(
                  `   代码: +${session.summary.additions}/-${session.summary.deletions}, ${session.summary.files} 文件`
                )
              );
            }
          }

          if (session.parentID) {
            console.log(chalk.gray(`   父会话: ${session.parentID.substring(0, 8)}...`));
          }
        });

        return { shouldContinue: false };
      }

      case 'fork': {
        console.log(chalk.cyan('\n🌿 Fork 当前会话...\n'));

        try {
          const newSession = await sessionManager.forkSession();
          console.log(chalk.green(`✓ Fork 成功!`));
          console.log(chalk.gray(`  新会话: ${newSession.title}`));
          console.log(chalk.gray(`  ID: ${newSession.id}`));
        } catch (error) {
          console.log(chalk.red(`✗ Fork 失败: ${(error as Error).message}\n`));
        }

        return { shouldContinue: false };
      }

      case 'switch': {
        const sessionIdOrIndex = commandArgs[0];
        if (!sessionIdOrIndex) {
          console.log(chalk.red('✗ 请提供会话 ID 或序号\n'));
          console.log(chalk.gray('用法: /session switch <会话ID 或 序号>\n'));
          return { shouldContinue: false };
        }

        const sessions = sessionManager.getAllSessions();
        let targetSessionId: string | undefined;

        if (/^\d+$/.test(sessionIdOrIndex)) {
          const index = parseInt(sessionIdOrIndex, 10) - 1;
          if (index < 0 || index >= sessions.length) {
            console.log(chalk.red(`✗ 无效的序号，请使用 /session list 查看会话列表\n`));
            return { shouldContinue: false };
          }
          targetSessionId = sessions[index].id;
        } else {
          targetSessionId = sessionIdOrIndex;
        }

        try {
          const switchedSession = await sessionManager.switchSession(targetSessionId!);
          console.log(chalk.green(`✓ 已切换到会话: ${switchedSession?.title}\n`));

          // 返回 sessionSwitched 信息，让 agent.ts 加载历史记录
          return {
            shouldContinue: false,
            sessionSwitched: {
              sessionId: switchedSession.id,
              historyFile: switchedSession.historyFile,
            },
          };
        } catch (error) {
          console.log(chalk.red(`✗ 切换失败: ${(error as Error).message}\n`));
          return { shouldContinue: false };
        }
      }

      case 'rename': {
        const newName = commandArgs.join(' ');
        if (!newName) {
          console.log(chalk.red('✗ 请提供新名称\n'));
          console.log(chalk.gray('用法: /session rename <新名称>\n'));
          return { shouldContinue: false };
        }

        const currentSession = sessionManager.getCurrentSession();
        if (!currentSession) {
          console.log(chalk.red('✗ 没有当前会话\n'));
          return { shouldContinue: false };
        }

        try {
          await sessionManager.renameSession(currentSession.id, newName);
          console.log(chalk.green(`✓ 会话已重命名: ${newName}\n`));
        } catch (error) {
          console.log(chalk.red(`✗ 重命名失败: ${(error as Error).message}\n`));
        }

        return { shouldContinue: false };
      }

      case 'export': {
        const currentSession = sessionManager.getCurrentSession();
        if (!currentSession) {
          console.log(chalk.red('✗ 没有当前会话\n'));
          return { shouldContinue: false };
        }

        try {
          const jsonData = await sessionManager.exportSession(currentSession.id);
          console.log(chalk.green(`✓ 会话已导出:\n`));
          console.log(chalk.gray(jsonData));
        } catch (error) {
          console.log(chalk.red(`✗ 导出失败: ${(error as Error).message}\n`));
        }

        return { shouldContinue: false };
      }

      case 'import': {
        const jsonData = commandArgs.join(' ');
        if (!jsonData) {
          console.log(chalk.red('✗ 请提供 JSON 数据\n'));
          console.log(chalk.gray('用法: /session import \'{"info":{...}, "messages":[...]}\'\n'));
          return { shouldContinue: false };
        }

        try {
          const newSession = await sessionManager.importSession(jsonData);
          console.log(chalk.green(`✓ 会话已导入`));
          console.log(chalk.gray(`  名称: ${newSession.title}`));
          console.log(chalk.gray(`  ID: ${newSession.id}`));
        } catch (error) {
          console.log(chalk.red(`✗ 导入失败: ${(error as Error).message}\n`));
        }

        return { shouldContinue: false };
      }

      case 'cleanup': {
        console.log(chalk.cyan('\n🧹 会话清理\n'));

        // 显示当前统计信息
        const stats = sessionManager.getSessionStats();
        console.log(chalk.blue(`当前会话统计:`));
        console.log(chalk.gray(`  总数: ${stats.total}`));
        console.log(
          chalk.gray(`  当前: ${stats.current ? stats.current.substring(0, 8) + '...' : '无'}`)
        );
        if (stats.oldestSession) {
          console.log(
            chalk.gray(
              `  最旧会话: ${stats.oldestSession.toLocaleString('zh-CN')} (${stats.oldestSessionDays}天前)`
            )
          );
        }
        console.log(chalk.gray(`  平均年龄: ${stats.averageAge}天\n`));

        // 询问是否执行清理
        const shouldCleanup = await confirm('是否立即执行会话清理？', false);

        if (shouldCleanup) {
          try {
            const result = await sessionManager.manualCleanup();
            console.log(chalk.green(`✓ ${result.message}\n`));

            // 显示清理后的统计
            const newStats = sessionManager.getSessionStats();
            console.log(chalk.blue(`清理后统计:`));
            console.log(chalk.gray(`  总数: ${newStats.total}`));
          } catch (error) {
            console.log(chalk.red(`✗ 清理失败: ${(error as Error).message}\n`));
          }
        }

        return { shouldContinue: false };
      }

      default:
        console.log(chalk.red(`✗ 未知的命令: ${command}\n`));
        console.log(chalk.gray('可用命令: status, list, fork, rename, export, import, cleanup\n'));
        console.log(chalk.gray('  cleanup - 清理过期会话（基于配置的保留规则）\n'));
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
          console.log(
            chalk.gray(
              `  节省: ${result.savedTokens} tokens (${Math.round((result.savedTokens / result.originalTokens) * 100)}%)`
            )
          );
          if (result.prunedParts > 0) {
            console.log(chalk.gray(`  修剪: ${result.prunedParts} 个部件`));
          }
        } else {
          console.log(chalk.yellow('  上下文无需压缩\n'));
        }
        return { shouldContinue: false };

      case 'llm':
        if (!contextManager.supportsLLMCompact()) {
          console.log(chalk.red('✗ LLM 压缩不可用，请先配置 API 适配器\n'));
          return { shouldContinue: false };
        }
        console.log(chalk.cyan('🤖 使用 LLM 智能压缩上下文...\n'));
        try {
          const llmResult = await contextManager.llmCompact();
          if (llmResult.compressed) {
            console.log(chalk.green('✓ LLM 压缩完成:'));
            console.log(chalk.gray(`  原始: ${llmResult.originalTokens} tokens`));
            console.log(chalk.gray(`  压缩后: ${llmResult.compressedTokens} tokens`));
            console.log(
              chalk.gray(
                `  节省: ${llmResult.savedTokens} tokens (${Math.round((llmResult.savedTokens / llmResult.originalTokens) * 100)}%)`
              )
            );
          } else {
            console.log(chalk.yellow('  LLM 压缩返回空结果\n'));
          }
        } catch (error) {
          console.log(chalk.red(`✗ LLM 压缩失败: ${(error as Error).message}\n`));
        }
        return { shouldContinue: false };

      case 'status':
        const compactor = contextManager.getCompactor();
        const config = compactor.getConfig();
        const needsCompaction = compactor.needsCompaction(contextManager.getRawMessages());
        const currentTokens = contextManager.estimateTokens();

        console.log(chalk.cyan('📊 压缩状态:\n'));
        console.log(
          chalk.gray(`  自动压缩: ${config.enabled ? chalk.green('启用') : chalk.yellow('禁用')}`)
        );
        console.log(chalk.gray(`  当前 tokens: ${currentTokens}`));
        console.log(chalk.gray(`  最大限制: ${config.maxTokens}`));
        console.log(chalk.gray(`  保留空间: ${config.reserveTokens}`));
        console.log(
          chalk.gray(
            `  使用率: ${Math.round((currentTokens / (config.maxTokens - config.reserveTokens)) * 100)}%`
          )
        );
        console.log(
          chalk.gray(`  需要压缩: ${needsCompaction ? chalk.red('是') : chalk.green('否')}`)
        );
        console.log(
          chalk.gray(
            `  LLM 压缩: ${contextManager.supportsLLMCompact() ? chalk.green('可用 (/compress llm)') : chalk.gray('不可用')}`
          )
        );
        return { shouldContinue: false };

      default:
        console.log(chalk.yellow('\n📋 压缩管理命令:\n'));
        console.log(chalk.gray('  /compress on        - 启用自动压缩'));
        console.log(chalk.gray('  /compress off       - 禁用自动压缩'));
        console.log(chalk.gray('  /compress manual    - 立即压缩上下文（规则-based）'));
        console.log(chalk.gray('  /compress llm       - 使用 LLM 智能压缩（集成 compaction.txt）'));
        console.log(chalk.gray('  /compress status    - 查看压缩状态'));
        return { shouldContinue: false };
    }
  }

  /**
   * /tokens 命令处理器 - 显示 token 使用情况
   */
  private async handleTokensCommand(
    _args: string,
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

    const config = compactor.getConfig();
    const usagePercent = Math.round(
      (totalTokens / (config.maxTokens - config.reserveTokens)) * 100
    );

    if (usagePercent > 80) {
      console.log(chalk.yellow('⚠️  上下文使用率较高，建议启用压缩: /compress on\n'));
    } else if (usagePercent > 50) {
      console.log(chalk.gray('ℹ️  可以使用 /compress status 查看详细状态\n'));
    }

    return { shouldContinue: false };
  }

  /**
   * /setting 命令处理器 - API 参数设置
   */
  private async handleSettingCommand(
    args: string,
    context: CommandContext
  ): Promise<CommandResult> {
    const { config, pauseKeyListener } = context;
    const parts = args.trim().split(/\s+/);
    const subCommand = parts[0] || '';

    // 如果没有参数或参数不是 set/reset，启用交互式配置
    if (!subCommand || (subCommand !== 'set' && subCommand !== 'reset')) {
      return this.interactiveSettings(config, pauseKeyListener);
    }

    const validCommands = ['set', 'reset', 'list', 'show'] as const;
    type ValidCommand = (typeof validCommands)[number];

    switch (subCommand as ValidCommand) {
      case 'list':
      case 'show': {
        return this.listCurrentSettings(config);
      }
      case 'set': {
        if (parts.length < 3) {
          return this.interactiveSettings(config, pauseKeyListener);
        }
        return this.updateSetting(parts[1], parts.slice(2).join(' '), config);
      }
      case 'reset': {
        return this.resetSettings(config);
      }
      default: {
        return this.interactiveSettings(config, pauseKeyListener);
      }
    }
  }

  /**
   * 交互式设置
   */
  private async interactiveSettings(
    config: any,
    pauseKeyListener?: () => () => void
  ): Promise<CommandResult> {
    const { select, input } = await import('../utils/prompt');

    // 暂停按键监听器
    const resumeKeyListener = pauseKeyListener ? pauseKeyListener() : () => {};

    try {
      const settingOptions = [
        { label: 'temperature', description: '温度 (0.0-2.0, 默认 0.7)' },
        { label: 'top_p', description: 'Top-P 采样 (0.0-1.0, 默认 0.9)' },
        { label: 'top_k', description: 'Top-K 采样 (1-100, 默认 -1)' },
        { label: 'repetition_penalty', description: '重复惩罚 (1.0-2.0, 默认 1.0)' },
        { label: 'reset', description: '重置所有参数为默认值' },
        { label: 'cancel', description: '取消' },
      ];

      const selected = await select({
        message: '选择要配置的参数:',
        options: settingOptions.map((opt) => ({
          label: `/${opt.label}`,
          value: opt.label,
          description: opt.description,
        })),
      });

      if (selected.value === 'cancel') {
        console.log(chalk.gray('\n已取消\n'));
        return { shouldContinue: false };
      }

      if (selected.value === 'reset') {
        return this.resetSettings(config);
      }

      // 交互式输入值
      const paramName = selected.value;
      const validation: Record<
        string,
        { min: number; max: number; description: string; default: number }
      > = {
        temperature: { min: 0, max: 2, description: '温度', default: 0.7 },
        top_p: { min: 0, max: 1, description: 'Top-P', default: 0.9 },
        top_k: { min: -1, max: 100, description: 'Top-K', default: -1 },
        repetition_penalty: { min: 1, max: 2, description: '重复惩罚', default: 1.0 },
      };

      const rule = validation[paramName];

      const value = await input({
        message: `请输入 ${rule.description} 的值 (${rule.min}-${rule.max}, 默认 ${rule.default}):`,
        validate: (val: string) => {
          if (!val.trim()) {
            return true; // 空值使用默认值
          }
          const num = parseFloat(val);
          if (isNaN(num)) {
            return '请输入有效数字';
          }
          if (num < rule.min || num > rule.max) {
            return `值超出范围 (${rule.min}-${rule.max})`;
          }
          return true;
        },
      });

      if (!value.trim()) {
        console.log(chalk.gray('\n使用默认值，取消设置\n'));
        return { shouldContinue: false };
      }

      return this.updateSetting(paramName, value, config);
    } catch (error: any) {
      if (error.name === 'UserCancelled' || error.message?.includes('User force closed')) {
        console.log(chalk.gray('\n已取消\n'));
      } else {
        console.log(chalk.red(`\n✗ 设置失败: ${error.message}\n`));
      }
      return { shouldContinue: false };
    } finally {
      resumeKeyListener();
    }
  }

  /**
   * 列出当前 API 设置
   */
  private async listCurrentSettings(config: any): Promise<CommandResult> {
    const apiConfig = config.getAPIConfig();

    // 尝试读取配置文件获取 model_config
    let modelConfig: any = {};
    try {
      const configPath = getConfigPath();
      if (fsSync.existsSync(configPath)) {
        const configContent = fsSync.readFileSync(configPath, 'utf-8');
        const configObj = JSON.parse(configContent);
        modelConfig = configObj.model_config || {};
      }
    } catch {
      // 配置文件不存在或读取失败，忽略
    }

    console.log(chalk.cyan('\n⚙️  当前 API 配置\n'));

    // 基础配置
    console.log(chalk.yellow('基础配置:'));
    console.log(chalk.gray(`  模型:      ${apiConfig.model}`));
    console.log(chalk.gray(`  API 地址:  ${apiConfig.base_url}`));

    // 模型参数
    console.log(chalk.yellow('模型参数:'));
    console.log(
      chalk.gray(
        `  temperature:       ${modelConfig.temperature !== undefined ? modelConfig.temperature : '未设置 (使用默认)'}`
      )
    );
    console.log(
      chalk.gray(
        `  top_p:             ${modelConfig.top_p !== undefined ? modelConfig.top_p : '未设置 (使用默认)'}`
      )
    );
    console.log(
      chalk.gray(
        `  top_k:             ${modelConfig.top_k !== undefined ? modelConfig.top_k : '未设置 (使用默认)'}`
      )
    );
    console.log(
      chalk.gray(
        `  repetition_penalty: ${modelConfig.repetition_penalty !== undefined ? modelConfig.repetition_penalty : '未设置 (使用默认)'}`
      )
    );

    console.log(chalk.gray('💡 提示:'));
    console.log(chalk.gray('  /models <模型名称>    # 切换模型'));
    console.log(chalk.gray('  /setting             # 交互式设置参数'));
    console.log(chalk.gray('  /setting set <参数> <值>  # 命令式设置参数'));
    console.log(chalk.gray('  /setting reset       # 重置为默认值'));

    return { shouldContinue: false };
  }

  /**
   * 更新设置
   */
  private async updateSetting(
    paramName: string,
    value: string,
    _config: any
  ): Promise<CommandResult> {
    // 验证参数名
    const validParams = ['temperature', 'top_p', 'top_k', 'repetition_penalty'];
    if (!validParams.includes(paramName)) {
      console.log(chalk.red(`✗ 无效的参数名: ${paramName}\n`));
      console.log(chalk.gray('有效参数: ' + validParams.join(', ')));
      return { shouldContinue: false };
    }

    // 验证并转换值
    let numValue: number;
    try {
      numValue = parseFloat(value);
      if (isNaN(numValue)) {
        throw new Error('不是有效数字');
      }
    } catch {
      console.log(chalk.red(`✗ 无效的值: ${value}\n`));
      return { shouldContinue: false };
    }

    // 参数范围验证
    const validation: Record<string, { min: number; max: number; description: string }> = {
      temperature: { min: 0, max: 2, description: '温度' },
      top_p: { min: 0, max: 1, description: 'Top-P' },
      top_k: { min: -1, max: 100, description: 'Top-K (-1 表示禁用)' },
      repetition_penalty: { min: 1, max: 2, description: '重复惩罚' },
    };

    const validationRule = validation[paramName];
    if (numValue < validationRule.min || numValue > validationRule.max) {
      console.log(
        chalk.red(
          `✗ ${validationRule.description} 值超出范围: ${validationRule.min} - ${validationRule.max}\n`
        )
      );
      return { shouldContinue: false };
    }

    // 更新配置文件
    const configPath = getConfigPath();
    try {
      let configObj: any;

      // 读取现有配置或创建新配置
      try {
        const configContent = await fs.readFile(configPath, 'utf-8');
        configObj = JSON.parse(configContent);
      } catch {
        // 文件不存在，创建新配置
        configObj = {};
      }

      // 确保 model_config 存在
      if (!configObj.model_config) {
        configObj.model_config = {};
      }

      configObj.model_config[paramName] = numValue;

      // 写入配置文件
      await fs.writeFile(configPath, JSON.stringify(configObj, null, 2), 'utf-8');

      console.log(chalk.green(`✓ 已设置 ${paramName}:`));
      console.log(chalk.gray(`  值: ${numValue}`));
    } catch (error) {
      console.log(chalk.red(`✗ 设置失败: ${(error as Error).message}\n`));
      return { shouldContinue: false };
    }

    return { shouldContinue: false };
  }

  /**
   * 重置设置为默认值
   */
  private async resetSettings(_config: any): Promise<CommandResult> {
    const configPath = getConfigPath();
    try {
      // 检查文件是否存在
      if (!fsSync.existsSync(configPath)) {
        console.log(chalk.yellow('  配置文件不存在，无需重置\n'));
        return { shouldContinue: false };
      }

      const configContent = await fs.readFile(configPath, 'utf-8');
      const configObj = JSON.parse(configContent);

      // 移除 model_config
      if (configObj.model_config) {
        delete configObj.model_config;
      }

      await fs.writeFile(configPath, JSON.stringify(configObj, null, 2), 'utf-8');

      console.log(chalk.green('✓ 已重置所有模型参数为默认值\n'));
    } catch (error) {
      console.log(chalk.red(`✗ 重置失败: ${(error as Error).message}\n`));
      return { shouldContinue: false };
    }

    return { shouldContinue: false };
  }

  /**
   * /test 命令处理器 - 测试交互式选择功能
   */
  private async handleTestCommand(): Promise<CommandResult> {
    console.log(chalk.cyan('\n🧪 交互式选择功能测试\n'));

    // 测试单选
    console.log(chalk.yellow('测试 1: 单选菜单\n'));
    const color = await select({
      message: '请选择你喜欢的颜色：',
      options: [
        { label: '红色', value: 'red', description: '热情奔放' },
        { label: '蓝色', value: 'blue', description: '冷静理智' },
        { label: '绿色', value: 'green', description: '自然清新' },
        { label: '紫色', value: 'purple', description: '高贵典雅' },
      ],
      default: 0,
    });

    console.log(chalk.green(`你选择了: ${color.label}\n`));

    // 测试确认
    console.log(chalk.yellow('测试 2: 确认对话框\n'));
    const confirmed = await confirm('是否继续？', true);

    console.log(chalk.green(`你选择了: ${confirmed ? '继续' : '取消'}\n`));

    // 测试输入
    console.log(chalk.yellow('测试 3: 文本输入\n'));
    const name = await question('请输入你的名字', 'Guest');

    console.log(chalk.green(`你好, ${name}!\n`));

    // 测试多选
    console.log(chalk.yellow('测试 4: 多选菜单\n'));
    const features = await multiSelect({
      message: '请选择你喜欢的功能：',
      options: [
        { label: '会话管理', value: 'session' },
        { label: '上下文压缩', value: 'compress' },
        { label: 'Token 统计', value: 'tokens' },
        { label: '交互式选择', value: 'select' },
      ],
      default: 0,
    });

    console.log(chalk.green(`你选择了 ${features.length} 个功能:`));
    features.forEach((f) => console.log(chalk.gray(`  - ${f.label}`)));

    return { shouldContinue: false };
  }

  /**
   * /exit 命令处理器 - 退出程序
   */
  private async handleExitCommand(_args: string, context: CommandContext): Promise<CommandResult> {
    if (context.onExit) {
      context.onExit();
    } else {
      // 如果没有提供退出回调，直接退出
      process.exit(0);
    }
    // 不会返回，但为了类型检查
    return { shouldContinue: false };
  }
}

/**
 * 创建命令管理器
 */
export function createCommandManager(): CommandManager {
  return new CommandManager();
}
