/**
 * GG CODE - 智能流式 Markdown 渲染器
 * 在流式输出中智能地渲染 Markdown，处理不完整的语法
 */

import chalk from 'chalk';

/**
 * 解析器状态
 */
interface ParserState {
  inCodeBlock: boolean;
  codeBlockLang: string;
  codeBlockBuffer: string;
  inList: boolean;
  listMarker: string; // '-', '*', '+', or '1.'
  inInlineCode: boolean;
  inBold: boolean;
  inItalic: boolean;
  buffer: string;
  lastOutput: string;
}

/**
 * 创建初始解析器状态
 */
function createInitialState(): ParserState {
  return {
    inCodeBlock: false,
    codeBlockLang: '',
    codeBlockBuffer: '',
    inList: false,
    listMarker: '',
    inInlineCode: false,
    inBold: false,
    inItalic: false,
    buffer: '',
    lastOutput: '',
  };
}

/**
 * 检测代码块开始
 */
function detectCodeBlockStart(text: string): { lang: string; matchLength: number } | null {
  // 匹配 ``` 或 ```lang
  const match = text.match(/^```\w*\s*/);
  if (match) {
    const lang = match[0].replace(/`|\s/g, '') || 'code';
    return { lang, matchLength: match[0].length };
  }
  return null;
}

/**
 * 检测代码块结束
 */
function detectCodeBlockEnd(text: string): number {
  const match = text.match(/^```/);
  return match ? match[0].length : 0;
}

/**
 * 检测列表标记
 */
function detectListMarker(text: string): string | null {
  // 无序列表: -, *, +
  const unorderedMatch = text.match(/^[\s]*[-*+]\s+/);
  if (unorderedMatch) {
    return unorderedMatch[0].trim();
  }
  // 有序列表: 1.
  const orderedMatch = text.match(/^\d+\.\s+/);
  if (orderedMatch) {
    return orderedMatch[0].trim();
  }
  return null;
}

/**
 * 检测标题
 */
function detectHeading(text: string): { level: number; length: number } | null {
  const match = text.match(/^#{1,6}\s/);
  if (match) {
    return { level: match[0].trim().length, length: match[0].length };
  }
  return null;
}

/**
 * 智能流式 Markdown 渲染器
 */
export class StreamingMarkdownRenderer {
  private state: ParserState;

  constructor() {
    this.state = createInitialState();
  }

  /**
   * 处理一个新的文本块
   * @returns 应该立即输出的内容（可能为空）
   */
  public process(chunk: string): string {
    // 跳过完全相同的重复 chunk
    if (chunk === this.state.lastOutput) {
      return '';
    }

    this.state.buffer += chunk;

    // 如果缓冲区以最后一个输出开头，说明是重复内容
    if (this.state.buffer.startsWith(this.state.lastOutput)) {
      // 只处理新增的部分
      this.state.buffer = this.state.buffer.slice(this.state.lastOutput.length);
    }

    // 如果缓冲区变空，说明全是重复内容
    if (this.state.buffer.length === 0) {
      return '';
    }

    const output = this.tryOutput();

    // 跟踪最后输出的内容
    if (output) {
      this.state.lastOutput = output;
    }

    return output;
  }

  /**
   * 刷新剩余的缓冲内容
   */
  public flush(): string {
    const output = this.renderBuffer(this.state.buffer);
    this.state.buffer = '';
    this.state.lastOutput = output;
    return output;
  }

  /**
   * 尝试输出可以安全渲染的内容
   */
  private tryOutput(): string {
    let buffer = this.state.buffer;
    let output = '';

    // 处理代码块
    if (this.state.inCodeBlock) {
      const endPos = detectCodeBlockEnd(buffer);
      if (endPos > 0) {
        const codeContent = this.state.codeBlockBuffer + buffer.slice(0, endPos);
        output = this.renderCodeBlock(codeContent, this.state.codeBlockLang);
        this.state.inCodeBlock = false;
        this.state.codeBlockBuffer = '';
        this.state.codeBlockLang = '';
        this.state.buffer = buffer.slice(endPos);
        return output;
      }
      // 还在代码块中，累积
      this.state.codeBlockBuffer += buffer;
      this.state.buffer = '';
      return '';
    }

    // 检查是否开始代码块
    const codeBlockStart = detectCodeBlockStart(buffer);
    if (codeBlockStart) {
      // 输出代码块前面的内容
      const beforeCodeBlock = buffer.slice(0, buffer.indexOf('```'));
      if (beforeCodeBlock) {
        output = this.renderInlineContent(beforeCodeBlock);
      }
      this.state.inCodeBlock = true;
      this.state.codeBlockLang = codeBlockStart.lang;
      this.state.buffer = buffer.slice(codeBlockStart.matchLength);
      return output;
    }

    // 查找换行点
    const newlinePos = buffer.indexOf('\n');
    if (newlinePos !== -1) {
      const line = buffer.slice(0, newlinePos + 1);
      if (this.isSafeToOutput(line)) {
        output = this.renderLine(line);
        this.state.buffer = buffer.slice(newlinePos + 1);
        return output;
      }
    }

    // 检查是否是完整句子
    if (this.isCompleteSentence(buffer)) {
      output = this.renderInlineContent(buffer);
      this.state.buffer = '';
      return output;
    }

    // 等待更多内容
    return '';
  }

  /**
   * 判断一行文本是否可以安全输出
   */
  private isSafeToOutput(line: string): boolean {
    // 检查是否有未闭合的行内代码
    const backtickCount = (line.match(/[^\\]`/g) || []).length;
    if (backtickCount % 2 !== 0) {
      return false;
    }

    // 检查是否有未闭合的粗体或斜体（简化检查）
    // 注意：这是一个保守的检查，可能会有误判
    const hasUnmatchedBold = (line.match(/\*\*/g) || []).length % 2 !== 0;
    const hasUnmatchedItalic = (line.match(/(?<!\*)\*(?!\*)/g) || []).length % 2 !== 0;

    if (hasUnmatchedBold || hasUnmatchedItalic) {
      return false;
    }

    return true;
  }

  /**
   * 判断是否是完整的句子（可以安全输出）
   */
  private isCompleteSentence(text: string): boolean {
    // 如果包含句子结束符，认为是安全的
    if (/[.!?。！？]\s*$/.test(text)) {
      return true;
    }

    // 如果以空格结尾，对于简单内容可能安全
    if (/\s+$/.test(text) && text.length < 50) {
      // 但需要检查是否有未闭合的标记
      return !this.hasUnclosedMarkers(text);
    }

    return false;
  }

  /**
   * 检查是否有未闭合的标记
   */
  private hasUnclosedMarkers(text: string): boolean {
    // 检查未闭合的行内代码
    const backtickCount = (text.match(/`/g) || []).length;
    if (backtickCount % 2 !== 0) return true;

    // 检查未闭合的粗体
    const boldCount = (text.match(/\*\*/g) || []).length;
    if (boldCount % 2 !== 0) return true;

    return false;
  }

  /**
   * 渲染缓冲区内容
   */
  private renderBuffer(text: string): string {
    if (this.state.inCodeBlock) {
      // 还在代码块中，直接输出
      return this.renderCodeBlock(text, this.state.codeBlockLang);
    }
    return this.renderInlineContent(text);
  }

  /**
   * 渲染一行文本
   */
  private renderLine(line: string): string {
    // 检测标题
    const heading = detectHeading(line);
    if (heading) {
      const text = line.slice(heading.length).trim();
      return chalk.yellow('■'.repeat(heading.level) + ' ' + text) + '\n';
    }

    // 检测列表
    const listMarker = detectListMarker(line);
    if (listMarker) {
      const text = line.slice(line.indexOf(listMarker) + listMarker.length).trim();
      if (/^\d+\.\s*$/.test(listMarker)) {
        return chalk.cyan(listMarker) + ' ' + chalk.white(text) + '\n';
      }
      return chalk.gray('• ') + chalk.white(text) + '\n';
    }

    // 检测引用
    if (line.trim().startsWith('>')) {
      const text = line.trim().slice(1).trim();
      return chalk.gray('> ') + chalk.dim(text) + '\n';
    }

    // 检测水平分隔线
    if (/^[-*]{3,}\s*$/.test(line.trim())) {
      return chalk.gray('─'.repeat(50)) + '\n';
    }

    // 普通行内内容
    return this.renderInlineContent(line);
  }

  /**
   * 渲染行内内容（代码、粗体、斜体等）
   */
  private renderInlineContent(text: string): string {
    let result = text;

    // 处理行内代码（优先级最高）
    result = result.replace(/`([^`]+)`/g, (_match, code) => {
      return chalk.cyan('`' + code + '`');
    });

    // 处理粗体
    result = result.replace(/\*\*([^*]+)\*\*/g, (_match, text) => {
      return chalk.bold(text);
    });

    // 处理斜体
    result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_match, text) => {
      return chalk.italic(text);
    });

    // 处理链接
    result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, (_match, text) => {
      return chalk.underline.blue(text);
    });

    // 处理删除线
    result = result.replace(/~~([^~]+)~~/g, (_match, text) => {
      return chalk.dim.strikethrough(text);
    });

    return result;
  }

  /**
   * 渲染代码块
   */
  private renderCodeBlock(code: string, lang: string): string {
    const lines = code
      .replace(/^```\s*|```\s*$|```$/g, '')
      .trim()
      .split('\n');

    let output = '\n' + chalk.gray(`${lang}:`) + '\n';
    for (const line of lines) {
      output += chalk.gray('  ') + chalk.cyan(line) + '\n';
    }

    return output;
  }

  /**
   * 重置渲染器状态
   */
  public reset(): void {
    this.state = createInitialState();
  }
}

/**
 * 创建流式渲染器实例的工厂函数
 */
export function createStreamingRenderer(): StreamingMarkdownRenderer {
  return new StreamingMarkdownRenderer();
}
