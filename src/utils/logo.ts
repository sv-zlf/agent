import chalk from 'chalk';

/**
 * GG CODE Logo 设计
 * 使用纯 ASCII 字母
 */
export const displayLogo = (): void => {
  // 使用纯 ASCII 字母
  const logo = [
    '',
    chalk.cyan('  GGGG    GGGG'),
    chalk.cyan('  G   G  G   G'),
    chalk.cyan('  G G G  G G G'),
    chalk.cyan('  G   G  G   G'),
    chalk.cyan('  GGGG    GGGG'),
    '',
    chalk.green('  CCC   OOO   DDD   EEEE'),
    chalk.green(' C     O   O  D  D  E'),
    chalk.green(' C     O   O  D   D EEEE'),
    chalk.green(' C     O   O  D  D  E'),
    chalk.green('  CCC   OOO   DDD   EEEE'),
    '',
  ];

  logo.forEach(line => console.log(line));
};

/**
 * 显示启动横幅
 */
export const displayBanner = (version: string): void => {
  console.log();
  displayLogo();

  console.log(chalk.gray('  =========================================='));
  console.log(chalk.white.bold('  ') + chalk.cyan.bold('GG CODE') + chalk.white.bold(' - AI-Powered Code Editor'));
  console.log(chalk.gray('  Version: ') + chalk.green.bold(version));
  console.log(chalk.gray('  =========================================='));
  console.log();

  console.log(chalk.yellow('  ⌨️  Controls / 快捷键:'));
  console.log(chalk.white('    • P     ') + chalk.gray('- Interrupt / 中断操作'));
  console.log(chalk.white('    • Ctrl+C ') + chalk.gray('- Exit / 退出程序'));
  console.log();

  console.log(chalk.yellow('  📝 Commands / 命令:'));
  console.log(chalk.white('    • exit  ') + chalk.gray('- Exit / 退出'));
  console.log(chalk.white('    • clear ') + chalk.gray('- Clear history / 清空历史'));
  console.log(chalk.white('    • tools ') + chalk.gray('- List tools / 工具列表'));
  console.log();

  console.log(chalk.gray('  =========================================='));
  console.log();
};
