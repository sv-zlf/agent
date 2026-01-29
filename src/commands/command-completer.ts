/**
 * 命令自动完成和选择器
 * 参考 opencode 的实现，在用户输入 / 时显示命令列表
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { CommandManager, type CommandDefinition } from './slash-commands';

/**
 * 命令选择器
 */
export class CommandCompleter {
  private commandManager: CommandManager;
  private currentInput: string = '';

  constructor(commandManager: CommandManager) {
    this.commandManager = commandManager;
  }

  /**
   * 检查输入是否可能触发命令补全
   */
  shouldTrigger(input: string): boolean {
    this.currentInput = input;
    // 当输入只有 "/" 或 "/" 开头时触发
    return input.trim() === '/' || (input.trim().startsWith('/') && input.length < 10);
  }

  /**
   * 显示命令选择器
   * 返回用户选择的命令（包含前导斜杠）
   */
  async showCommandSelector(): Promise<string> {
    const commands = this.commandManager.getCommands();

    const choices = commands.map(cmd => ({
      name: `/${cmd.name}`,
      value: `/${cmd.name}`,
      short: cmd.description,
    }));

    // 如果有当前输入，过滤命令
    const filteredChoices = this.currentInput.trim() === '/'
      ? choices
      : choices.filter(c => c.name.startsWith(this.currentInput.trim()));

    if (filteredChoices.length === 0) {
      // 没有匹配的命令，返回当前输入
      return this.currentInput;
    }

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'command',
        message: '选择命令:',
        choices: filteredChoices,
        pageSize: 10,
        default: filteredChoices[0]?.value || '',
      }
    ]);

    return answers.command;
  }

  /**
   * 获取命令补全建议
   */
  getCompletions(input: string): string[] {
    const commands = this.commandManager.getCommands();
    const prefix = input.startsWith('/') ? '' : '/';

    return commands.map(cmd => prefix + cmd.name);
  }

  /**
   * 格式化命令列表用于显示
   */
  formatCommandList(): string {
    const commands = this.commandManager.getCommands();

    const lines: string[] = [];
    lines.push(chalk.cyan('\n📋 可用命令列表:\n'));

    const maxLength = Math.max(...commands.map(cmd => cmd.name.length));

    for (const cmd of commands) {
      const paddedName = cmd.name.padEnd(maxLength + 2);
      lines.push(chalk.yellow(`  /${paddedName}`) + chalk.gray(cmd.description));
    }

    lines.push('');
    lines.push(chalk.gray('💡 提示:'));
    lines.push(chalk.gray('  • 输入 / 然后按 Tab 键查看命令'));
    lines.push(chalk.gray('  • 直接输入 /命令名 可快速执行'));
    lines.push('');

    return lines.join('\n');
  }

  /**
   * 获取命令详情
   */
  getCommandHelp(commandName: string): string {
    const commands = this.commandManager.getCommands();
    const command = commands.find(cmd => cmd.name === commandName);

    if (!command) {
      return chalk.red(`未知命令: ${commandName}`);
    }

    const lines: string[] = [];
    lines.push(chalk.cyan(`\n命令: /${command.name}\n`));
    lines.push(chalk.white(command.description));
    lines.push('');
    lines.push(chalk.gray('用法:'));
    lines.push(chalk.gray(`  /${command.name} [参数]\n`));

    return lines.join('\n');
  }
}
