import chalk from 'chalk';

/**
 * 日志级别
 */
export type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'debug';

/**
 * 简单的日志工具
 */
export class Logger {
  private debugMode: boolean;

  constructor(debugMode: boolean = false) {
    this.debugMode = debugMode;
  }

  /**
   * 信息日志
   */
  info(message: string): void {
    console.log(chalk.blue('ℹ'), message);
  }

  /**
   * 成功日志
   */
  success(message: string): void {
    console.log(chalk.green('✓'), message);
  }

  /**
   * 警告日志
   */
  warning(message: string): void {
    console.log(chalk.yellow('⚠'), message);
  }

  /**
   * 错误日志
   */
  error(message: string): void {
    console.error(chalk.red('✗'), message);
  }

  /**
   * 调试日志
   */
  debug(message: string): void {
    if (this.debugMode) {
      console.log(chalk.gray('ℹ'), message);
    }
  }

  /**
   * 标题日志
   */
  title(message: string): void {
    console.log('\n' + chalk.bold.cyan(message));
  }

  /**
   * 代码日志
   */
  code(code: string, language: string = ''): void {
    console.log(chalk.gray(`\`\`\`${language}`));
    console.log(code);
    console.log(chalk.gray('```\n'));
  }

  /**
   * 列表日志
   */
  list(items: string[]): void {
    items.forEach((item) => {
      console.log(chalk.gray('  •'), item);
    });
  }

  /**
   * 表格日志
   */
  table(headers: string[], rows: string[][]): void {
    // 计算每列最大宽度
    const colWidths = headers.map((h, i) => {
      const maxWidth = Math.max(h.length, ...rows.map((row) => (row[i] || '').length));
      return maxWidth + 2;
    });

    // 打印表头
    const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join(chalk.gray('|'));
    console.log(headerRow);

    // 打印分隔线
    const separator = colWidths
      .map((w) => chalk.gray('-'.repeat(w - 1) + ' '))
      .join(chalk.gray('|'));
    console.log(separator);

    // 打印数据行
    rows.forEach((row) => {
      const dataRow = headers
        .map((_, i) => (row[i] || '').padEnd(colWidths[i]))
        .join(chalk.gray('|'));
      console.log(dataRow);
    });
  }
}

/**
 * 创建日志实例
 */
export function createLogger(debugMode: boolean = false): Logger {
  return new Logger(debugMode);
}
