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
  buffer: string;
  processedOffset: number; // 已经处理并输出的字符位置
}

/**
 * 创建初始解析器状态
 */
function createInitialState(): ParserState {
  return {
    inCodeBlock: false,
    codeBlockLang: '',
    codeBlockBuffer: '',
    buffer: '',
    processedOffset: 0,
  };
}

/**
 * 检测代码块开始
 */
function detectCodeBlockStart(text: string): { lang: string; matchLength: number } | null {
  // 匹配 ``` 或 ```lang
  const match = text.match(/^```(\w*)\s*/);
  if (match) {
    const lang = match[1] || 'code';
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
    this.state.buffer += chunk;
    const output = this.tryOutput();
    return output;
  }

  /**
   * 刷新剩余的缓冲内容
   */
  public flush(): string {
    if (this.state.buffer.length === 0) {
      return '';
    }

    const output = this.renderBuffer(this.state.buffer);
    this.state.buffer = '';
    this.state.processedOffset = 0;
    return output;
  }

  /**
   * 尝试输出可以安全渲染的内容
   */
  private tryOutput(): string {
    const buffer = this.state.buffer;
    let output = '';
    let remaining = buffer;
    let processed = 0;

    while (remaining.length > 0) {
      // 1. 检查是否在代码块中
      if (this.state.inCodeBlock) {
        const endPos = detectCodeBlockEnd(remaining);
        if (endPos > 0) {
          // 代码块结束
          const codeContent = this.state.codeBlockBuffer + remaining.slice(0, endPos);
          output += this.renderCodeBlock(codeContent, this.state.codeBlockLang);

          this.state.inCodeBlock = false;
          this.state.codeBlockBuffer = '';
          this.state.codeBlockLang = '';
          remaining = remaining.slice(endPos);
          processed += endPos;
        } else {
          // 还在代码块中，累积但不输出（等待结束）
          this.state.codeBlockBuffer += remaining;
          remaining = '';
        }
        continue;
      }

      // 2. 检查是否开始新的代码块
      const codeBlockStart = detectCodeBlockStart(remaining);
      if (codeBlockStart) {
        // 先输出前面的内容
        const beforeCodeBlock = remaining.slice(0, remaining.indexOf('```'));
        if (beforeCodeBlock) {
          output += this.renderInlineContent(beforeCodeBlock);
          processed += beforeCodeBlock.length;
        }

        this.state.inCodeBlock = true;
        this.state.codeBlockLang = codeBlockStart.lang;
        remaining = remaining.slice(codeBlockStart.matchLength);
        processed += codeBlockStart.matchLength;
        continue;
      }

      // 3. 查找安全的换行点
      const newlinePos = remaining.indexOf('\n');
      if (newlinePos !== -1) {
        const line = remaining.slice(0, newlinePos + 1);

        // 放宽检查：几乎所有行都允许输出
        // 只有极少数明显未闭合的情况才拒绝
        if (this.isSafeToOutput(line)) {
          output += this.renderLine(line);
          remaining = remaining.slice(newlinePos + 1);
          processed += newlinePos + 1;
        } else {
          // 不安全，但这行很可能永远不会被满足
          // 为了避免内容丢失，强制输出这一行
          output += this.renderLine(line);
          remaining = remaining.slice(newlinePos + 1);
          processed += newlinePos + 1;
        }
        continue;
      }

      // 4. 没有换行符，检查是否可以直接输出（如：空格、标点符号后）
      if (this.isCompleteSentence(remaining)) {
        output += this.renderInlineContent(remaining);
        processed += remaining.length;
        remaining = '';
        break;
      }

      // 5. 没有找到安全的输出点，等待更多 chunk
      break;
    }

    // 更新缓冲区
    this.state.buffer = buffer.slice(processed);
    this.state.processedOffset = processed;

    return output;
  }

  /**
   * 判断一行文本是否可以安全输出
   */
  private isSafeToOutput(line: string): boolean {
    // 极简检查：只拒绝明显未闭合的情况
    const trimmed = line.trimEnd();

    // 只有当行以单个反引号结尾时才拒绝（明显的未闭合代码）
    const doubleBacktick = '``';
    const tripleBacktick = '```';
    if (trimmed.endsWith('`') && !trimmed.endsWith(doubleBacktick) && !trimmed.endsWith(tripleBacktick)) {
      // 检查是否有奇数个反引号
      const backtickCount = (trimmed.match(/`/g) || []).length;
      if (backtickCount % 2 !== 0) {
        return false;
      }
    }

    // 其他情况都允许输出（包括粗体、斜体等）
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

    // 如果有换行符，逐行渲染
    if (text.includes('\n')) {
      const lines = text.split('\n');
      let output = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isLastLine = i === lines.length - 1;

        if (line === '') {
          // 空行（除非是最后且原文本不以 \n 结尾）
          if (!isLastLine || text.endsWith('\n')) {
            output += '\n';
          }
        } else {
          // 非空行，渲染
          const rendered = this.renderLine(line);
          output += rendered;
          // 如果 renderLine 没有添加换行符，且不是最后一行，手动添加
          if (!isLastLine && !rendered.endsWith('\n')) {
            output += '\n';
          }
        }
      }
      return output;
    }

    // 单行内容，使用行内渲染
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
