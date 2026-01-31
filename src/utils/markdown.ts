/**
 * GG CODE - Markdown 终端渲染器
 * 在终端中显示格式化的 Markdown 内容
 */

import chalk from 'chalk';

export interface MarkdownOptions {
  colors?: boolean;
  codeTheme?: 'light' | 'dark';
}

/**
 * 渲染 Markdown 为终端格式
 */
export function renderMarkdown(md: string, options: MarkdownOptions = {}): string {
  const { colors = true } = options;

  if (!md) return '';

  let result = md;

  // 1. 处理代码块（```）- 必须先处理，避免内部语法被解析
  result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const lines = code.trim().split('\n');
    const langLabel = lang || 'code';

    let output = '\n' + chalk.gray(`${langLabel}:`) + '\n';

    // 使用更简洁的代码显示，避免边框字符
    for (const line of lines) {
      output += chalk.gray('  ') + chalk.cyan(line) + '\n';
    }

    return output;
  });

  // 2. 处理行内代码（`code`）
  result = result.replace(/`([^`]+)`/g, (_match, code) => {
    return colors ? chalk.cyan('`' + code + '`') : '`' + code + '`';
  });

  // 3. 处理标题（# ## ### 等）
  result = result.replace(/^(#{1,6})\s+(.+)$/gm, (_match, hashes, title) => {
    const level = hashes.length;
    const prefix = '■'.repeat(level);
    if (colors) {
      return chalk.yellow(prefix + ' ' + title);
    }
    return prefix + ' ' + title;
  });

  // 4. 处理粗体（**text** 或 __text__）
  result = result.replace(/\*\*([^*]+)\*\*/g, (_match, text) => {
    return colors ? chalk.bold(text) : text;
  });
  result = result.replace(/__([^_]+)__/g, (_match, text) => {
    return colors ? chalk.bold(text) : text;
  });

  // 5. 处理斜体（*text* 或 _text_）
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_match, text) => {
    return colors ? chalk.italic(text) : text;
  });
  result = result.replace(/(?<!_)_([^_]+)_(?!_)/g, (_match, text) => {
    return colors ? chalk.italic(text) : text;
  });

  // 6. 处理无序列表（- 或 *）
  result = result.replace(/^[\s]*[-*]\s+(.+)$/gm, (_match, item) => {
    return colors ? chalk.gray('• ') + chalk.white(item) : '• ' + item;
  });

  // 7. 处理有序列表（1. 2. 等）
  result = result.replace(/^[\s]*(\d+)\.\s+(.+)$/gm, (_match, num, item) => {
    return colors ? chalk.cyan(num + '. ') + chalk.white(item) : num + '. ' + item;
  });

  // 8. 处理引用（> text）
  result = result.replace(/^>\s+(.+)$/gm, (_match, text) => {
    if (colors) {
      return chalk.gray('> ') + chalk.dim(text);
    }
    return '> ' + text;
  });

  // 9. 处理链接（[text](url)）- 只显示文本
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, (_match, text) => {
    return colors ? chalk.underline.blue(text) : text;
  });

  // 10. 处理水平分隔线（--- 或 ***）
  result = result.replace(/^[-*]{3,}$/gm, () => {
    return chalk.gray('─'.repeat(50));
  });

  // 11. 处理删除线（~~text~~）
  result = result.replace(/~~([^~]+)~~/g, (_match, text) => {
    if (colors) {
      return chalk.dim.strikethrough(text);
    }
    return text;
  });

  return result;
}

/**
 * 简化版本：只处理代码块和基本格式
 */
export function renderMarkdownSimple(md: string): string {
  if (!md) return '';

  let result = md;

  // 处理代码块
  result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    return chalk.gray('\n▸' + (lang || 'code') + ':\n') + chalk.cyan(code.trim()) + '\n';
  });

  // 处理行内代码
  result = result.replace(/`([^`]+)`/g, (_match, code) => {
    return chalk.cyan('`' + code + '`');
  });

  // 处理粗体
  result = result.replace(/\*\*([^*]+)\*\*/g, (_match, text) => {
    return chalk.bold(text);
  });

  // 处理标题
  result = result.replace(/^(#{1,3})\s+(.+)$/gm, (_match, hashes, title) => {
    return chalk.yellow(hashes + ' ' + title);
  });

  return result;
}

/**
 * 渲染差异对比（+ 添加，- 删除）
 */
export function renderDiff(diff: string): string {
  if (!diff) return '';

  const lines = diff.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    if (line.startsWith('+')) {
      result.push(chalk.green(line));
    } else if (line.startsWith('-')) {
      result.push(chalk.red(line));
    } else if (line.startsWith('@@')) {
      result.push(chalk.cyan(line));
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * 渲染代码高亮（简单版本）
 */
export function renderCode(code: string, _language?: string): string {
  if (!code) return '';

  // 移除前后空白
  const trimmed = code.trim();
  const lines = trimmed.split('\n');

  // 添加行号
  const maxLineNum = lines.length;
  const lineNumWidth = String(maxLineNum).length;

  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const paddedNum = String(lineNum).padStart(lineNumWidth);
    result.push(chalk.gray(`${paddedNum}: `) + chalk.white(lines[i]));
  }

  return '\n' + result.join('\n') + '\n';
}

/**
 * 渲染键值对（用于配置等）
 */
export function renderKeyValue(pairs: Record<string, any>): string {
  const maxKeyLength = Math.max(...Object.keys(pairs).map((k) => k.length));

  const lines: string[] = [];
  for (const [key, value] of Object.entries(pairs)) {
    const paddedKey = key.padEnd(maxKeyLength);
    lines.push(chalk.cyan(paddedKey + ': ') + chalk.white(String(value)));
  }

  return lines.join('\n');
}

/**
 * 检测文本是否包含 Markdown 语法
 */
export function hasMarkdown(text: string): boolean {
  const markdownPatterns = [
    /```/, // 代码块
    /`[^`]+`/, // 行内代码
    /\*\*[^*]+\*\*/, // 粗体
    /^#{1,6}\s/, // 标题
    /^[-*]\s/, // 列表
    /^\d+\.\s/, // 有序列表
    /^>\s/, // 引用
    /\[[^\]]+\]\(/, // 链接
  ];

  return markdownPatterns.some((pattern) => pattern.test(text));
}

/**
 * 智能渲染：自动检测是否需要 Markdown 渲染
 */
export function smartRender(text: string, options?: MarkdownOptions): string {
  if (!text) return '';

  // 如果包含 Markdown 语法，使用完整渲染
  if (hasMarkdown(text)) {
    return renderMarkdown(text, options);
  }

  // 否则返回原文本
  return text;
}
