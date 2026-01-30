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
 * 显示启动横幅（简化版）
 */
export const displayBanner = (version: string): void => {
  console.log();
  displayLogo();

  console.log(chalk.gray('  =========================================='));
  console.log(chalk.cyan('GG CODE') + chalk.gray(' - AI-Powered Code Editor'));
  console.log(chalk.gray('  Version: ') + chalk.green(version));
  console.log(chalk.gray('  =========================================='));
  console.log();
};
