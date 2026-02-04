/**
 * GG CODE - 工具调用格式实时检测器（流式输出专用）
 *
 * @purpose 在流式输出过程中实时检测并立即中断错误的工具调用格式
 *
 * @usage
 * - 在 `onChunk` 回调中实时检测每个 chunk
 * - 当检测到错误格式时，立即 abort 当前请求
 * - 发送纠正提示给 AI，要求重新生成
 *
 * @difference from tool-engine.detectMalformedToolCalls
 * - **此模块**：轻量级、实时检测（100 行），适用于流式输出
 * - **tool-engine**：完整、深度分析（150+ 行），适用于完整响应
 *
 * @detection-trigger
 * 1. 包含工具关键词（read, write, edit 等）
 * 2. 伴随 XML 标签（<tag>, </tag>）
 * 3. 缺少 JSON 格式（没有 "tool" 或 "parameters" 字段）
 * 4. 置信度 ≥ 0.8
 *
 * @example
 * ```typescript
 * onChunk: (chunk: string) => {
 *   fullResponse += chunk;
 *   const detection = detectMalformedToolCall(fullResponse);
 *   if (detection.hasError && detection.confidence >= 0.8) {
 *     abortSignal.abort();
 *     // 发送纠正消息...
 *   }
 * }
 * ```
 */

/**
 * 工具关键词列表
 */
const TOOL_KEYWORDS = [
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  'bash',
  'ls',
  'task',
  'multiedit',
  'batch',
  'question',
  'todowrite',
  'todoread',
  'tododelete',
  'todoclear',
];

/**
 * 检测结果
 */
export interface FormatDetectionResult {
  hasError: boolean;
  errorType?: 'xml_format' | 'mixed_format';
  confidence: number; // 0-1，置信度
  snippet?: string; // 错误的代码片段
}

/**
 * 检测是否在代码块中
 */
function isInCodeBlock(buffer: string): boolean {
  const lines = buffer.split('\n');
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }
  }

  return inCodeBlock;
}

/**
 * 检测是否包含工具关键词
 */
function hasToolKeyword(text: string): boolean {
  const lowerText = text.toLowerCase();
  return TOOL_KEYWORDS.some((keyword) => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    return regex.test(lowerText);
  });
}

/**
 * 检测是否包含 XML 标签
 */
function hasXmlTags(text: string): boolean {
  const xmlPatterns = [
    /<\w+[^>]*>/, // 开始标签 <tag>, <tag attr="">
    /<\/\w+>/, // 结束标签 </tag>
    /<\w+\/?>/, // 自闭合标签 <tag/>
  ];

  return xmlPatterns.some((pattern) => pattern.test(text));
}

/**
 * 检测是否包含正确的 JSON 格式
 */
function hasJsonFormat(text: string): boolean {
  return text.includes('"tool"') || text.includes('"parameters"') || text.includes("'tool'");
}

/**
 * 检测 XML 格式的工具调用
 */
function detectXmlFormat(text: string): FormatDetectionResult {
  // 必须包含工具关键词
  if (!hasToolKeyword(text)) {
    return { hasError: false, confidence: 0 };
  }

  // 必须包含 XML 标签
  if (!hasXmlTags(text)) {
    return { hasError: false, confidence: 0 };
  }

  // 如果已经有正确的 JSON 格式，可能是在展示示例
  if (hasJsonFormat(text)) {
    return { hasError: false, confidence: 0 };
  }

  // 提取错误片段（最后 200 字符）
  const snippet = text.slice(-200);

  // 计算置信度
  let confidence = 0.5;

  // 如果包含典型的 XML 工具调用模式，提高置信度
  if (/<(\w+)[\s>]*>[\s\S]*?<\/\1>/.test(text)) {
    confidence = 0.9;
  }

  // 如果包含 <tool_call> 或类似标签，提高置信度
  if (/<(tool_call|toolcall|invoke)[\s>]/i.test(text)) {
    confidence = 0.95;
  }

  return {
    hasError: true,
    errorType: 'xml_format',
    confidence,
    snippet,
  };
}

/**
 * 主检测函数：检测工具调用格式错误
 * @param text 当前累积的文本
 * @param fullBuffer 完整的输出缓冲区（用于判断上下文）
 * @returns 检测结果
 */
export function detectMalformedToolCall(
  text: string,
  fullBuffer?: string
): FormatDetectionResult {
  // 如果在代码块中，不检测（可能是代码示例）
  if (fullBuffer && isInCodeBlock(fullBuffer)) {
    return { hasError: false, confidence: 0 };
  }

  // 检测 XML 格式
  const xmlResult = detectXmlFormat(text);
  if (xmlResult.hasError && xmlResult.confidence >= 0.7) {
    return xmlResult;
  }

  // 未来可以添加其他格式的检测
  // 例如：函数调用格式 glob(pattern="...")

  return { hasError: false, confidence: 0 };
}

/**
 * 生成格式纠正消息
 */
export function generateCorrectionMessage(result: FormatDetectionResult): string {
  if (!result.hasError) {
    return '';
  }

  const { errorType, snippet } = result;

  let message = '⚠️ 检测到工具调用格式错误，已中断输出。\n\n';

  if (errorType === 'xml_format') {
    message += '**错误示例**（你刚才输出的）：\n';
    message += '```\n';
    message += (snippet || '<read><filePath>...</filePath></read>');
    message += '\n```\n\n';

    message += '**问题**：使用了 XML 标签格式（如 `<read>...</read>`）\n\n';

    message += '**正确格式**：\n';
    message += '```json\n';
    message += '{\n';
    message += '  "tool": "read",\n';
    message += '  "parameters": {\n';
    message += '    "filePath": "H:/Project/agent/src/file.ts"\n';
    message += '  }\n';
    message += '}\n';
    message += '```\n\n';

    message += '**重要规则**：\n';
    message += '1. 必须使用 JSON 格式\n';
    message += '2. 工具名必须小写：`"read"` 而不是 `"Read"`\n';
    message += '3. 参数名使用 camelCase：`filePath` 而不是 `file_path`\n';
    message += '4. 只输出 JSON，不要在前后添加其他文本\n\n';

    message += '请使用正确的 JSON 格式重新调用工具。';
  }

  return message;
}
