/**
 * Token 估算器
 * 参考 OpenCode 实现，提供更准确的 token 估算
 */

/**
 * Token 估算器类
 */
export class TokenEstimator {
  private static readonly CHARS_PER_TOKEN = 4; // 英文约 4 字符 = 1 token
  private static readonly CHINESE_CHAR_TOKEN = 2; // 中文字符约 1 字 = 1.5-2 token

  /**
   * 估算文本的 token 数量
   * 使用启发式方法：中文单独计算，英文按 4 字符/token
   */
  static estimate(text: string): number {
    if (!text) return 0;

    // 统计中文字符
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishChars = text.length - chineseChars;

    // 中文约 2 字符/token，英文约 4 字符/token
    return Math.ceil(chineseChars * 0.6 + englishChars / this.CHARS_PER_TOKEN);
  }

  /**
   * 估算消息的 token 数量
   */
  static estimateMessage(message: { role: string; content: string }): number {
    // role 约 5 tokens
    const roleTokens = 5;
    // 内容
    const contentTokens = this.estimate(message.content);
    // 额外开销（括号、逗号等）
    const overhead = 10;

    return roleTokens + contentTokens + overhead;
  }

  /**
   * 估算工具调用的 token 数量
   */
  static estimateToolCall(tool: string, parameters: any): number {
    // 工具名约 10 tokens
    const toolTokens = this.estimate(tool);
    // 参数序列化后估算
    const paramsStr = JSON.stringify(parameters);
    const paramsTokens = this.estimate(paramsStr);
    // 额外开销
    const overhead = 20;

    return toolTokens + paramsTokens + overhead;
  }

  /**
   * 估算工具结果的 token 数量
   */
  static estimateToolResult(output: string): number {
    // 输出可能很长，直接估算
    return this.estimate(output);
  }

  /**
   * 计算上下文总 token 数量
   */
  static estimateContext(messages: { role: string; content: string }[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateMessage(msg), 0);
  }
}
