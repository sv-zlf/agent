#!/usr/bin/env node
import { Command } from 'commander';
import { configCommand } from './commands/config';
import { chatCommand } from './commands/chat';
import { agentCommand } from './commands/agent';

const program = new Command();

program
  .name('agent')
  .description('内网代码编辑助手')
  .version('1.0.0');

// 添加子命令
program.addCommand(configCommand);
program.addCommand(chatCommand);
program.addCommand(agentCommand);

// 默认显示帮助
program.action(() => {
  program.help();
});

program.parse();
