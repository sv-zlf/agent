#!/usr/bin/env node
import { Command } from 'commander';
import { agentCommand } from './commands/agent';

const program = new Command();

program.name('ggcode').description('GG CODE - AI-Powered Code Editor CLI Tool').version('1.0.0');

// 添加子命令
program.addCommand(agentCommand);

// 默认启动 agent
program.action(() => {
  agentCommand.parseAsync(process.argv);
});

program.parse();
