#!/usr/bin/env node
import { Command } from 'commander';
import { agentCommand } from './commands/agent';

const program = new Command();

program
  .name('agent')
  .description('内网代码编辑助手')
  .version('1.0.0');

// 添加子命令
program.addCommand(agentCommand);

// 默认启动 agent
program.action(() => {
  agentCommand.parseAsync(process.argv);
});

program.parse();
