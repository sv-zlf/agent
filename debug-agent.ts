/**
 * 调试版本的agent命令
 * 用于定位退出问题
 */

import * as readline from 'readline';
import chalk from 'chalk';

// 创建简单的readline接口测试
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('=== Agent调试模式 ===\n');

let round = 0;

const chatLoop = () => {
  round++;
  console.log(chalk.gray(`\n[轮次 ${round}] 开始新的对话循环\n`));

  rl.question(chalk.cyan('You: '), (input: string) => {
    console.log(chalk.gray(`\n[DEBUG] 收到输入: "${input}"\n`));

    if (!input.trim()) {
      console.log(chalk.gray('[DEBUG] 输入为空，继续循环\n'));
      chatLoop();
      return;
    }

    // 处理特殊命令
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log(chalk.gray('[DEBUG] 用户要求退出\n'));
      rl.close();
      console.log(chalk.gray('[DEBUG] readline已关闭'));
      process.exit(0);
      return;
    }

    if (input.toLowerCase() === 'test') {
      // 模拟工具执行
      console.log(chalk.green('AI: 模拟工具执行\n'));
      console.log(chalk.yellow('📋 工具调用:'));
      console.log(chalk.cyan('  工具: MakeDirectory'));
      console.log(chalk.gray('  参数: {"path":"test"}\n'));
      console.log(chalk.green('  ✓ 成功\n'));
      console.log(chalk.gray('📊 执行完成\n'));

      // 关键测试：是否继续循环
      console.log(chalk.gray('[DEBUG] 准备调用 chatLoop() 继续对话\n'));

      // 使用setTimeout避免调用栈问题
      setTimeout(() => {
        console.log(chalk.gray('[DEBUG] chatLoop() 即将被调用\n'));
        chatLoop();
      }, 100);

      return;
    }

    // 默认回复
    console.log(chalk.green(`AI: 收到你的输入 "${input}"\n`));

    // 继续循环
    console.log(chalk.gray('[DEBUG] 准备继续循环\n'));
    setTimeout(() => {
      chatLoop();
    }, 100);
  });
};

// 启动
console.log(chalk.gray('[DEBUG] chatLoop() 首次调用\n'));
chatLoop();

// 监听进程退出
process.on('exit', (code) => {
  console.log(chalk.red(`\n[DEBUG] 进程退出，代码: ${code}\n`));
});

// 监听未捕获的异常
process.on('uncaughtException', (error) => {
  console.error(chalk.red('\n[DEBUG] 未捕获的异常:'));
  console.error(error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('\n[DEBUG] 未处理的Promise拒绝:'));
  console.error(reason);
});
