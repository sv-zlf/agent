/**
 * GG CODE - 工具调用自动纠正器
 * 检测并自动纠正 AI 的错误工具调用格式
 */

/**
 * 检测到的格式错误类型
 */
type FormatErrorType =
  | 'xml_tags' // XML 标签格式
  | 'function_call' // 函数调用格式
  | 'uppercase_tool' // 大写工具名
  | 'missing_quotes' // 缺少引号
  | 'malformed_json'; // 格式错误的 JSON

interface FormatError {
  type: FormatErrorType;
  position: number;
  length: number;
  original: string;
  suggestion: string;
}

/**
 * 工具调用纠正器
 */
export class ToolCallCorrector {
  /**
   * 检测并纠正工具调用格式错误
   */
  static detectAndCorrect(
    response: string,
    knownTools: Set<string>
  ): {
    corrected: string;
    errors: FormatError[];
    hasErrors: boolean;
    corrections: string[];
  } {
    const errors: FormatError[] = [];
    const corrections: string[] = [];
    let corrected = response;

    // 1. 检测 XML 标签格式
    const xmlErrors = this.detectXMLTags(response);
    errors.push(...xmlErrors);
    if (xmlErrors.length > 0) {
      const { text, correction } = this.convertXMLToJSON(xmlErrors, knownTools);
      corrected = corrected.replace(text, correction);
      corrections.push(`将 XML 标签格式转换为 JSON 格式`);
    }

    // 2. 检测函数调用格式 (Read{...})
    const funcErrors = this.detectFunctionCalls(response, knownTools);
    errors.push(...funcErrors);
    if (funcErrors.length > 0) {
      for (const err of funcErrors) {
        const { text, correction } = this.convertFunctionCallToJSON(err, knownTools);
        corrected = corrected.replace(text, correction);
        corrections.push(`将 "${err.original.trim()}" 转换为 JSON 格式`);
      }
    }

    // 3. 检测大写工具名
    const uppercaseErrors = this.detectUppercaseToolNames(response, knownTools);
    errors.push(...uppercaseErrors);
    if (uppercaseErrors.length > 0) {
      for (const err of uppercaseErrors) {
        corrected = corrected.replace(err.original, err.suggestion);
        corrections.push(`将工具名 "${err.original}" 改为小写 "${err.suggestion}"`);
      }
    }

    // 4. 检测缺少引号的 JSON 键
    const quoteErrors = this.detectMissingQuotes(response);
    errors.push(...quoteErrors);
    if (quoteErrors.length > 0) {
      for (const err of quoteErrors) {
        corrected = corrected.replace(err.original, err.suggestion);
        corrections.push(`添加缺失的引号: ${err.original} → ${err.suggestion}`);
      }
    }

    return {
      corrected,
      errors,
      hasErrors: errors.length > 0,
      corrections,
    };
  }

  /**
   * 检测 XML 标签格式
   * 例如: <Read><filePath>...</filePath></Read>
   */
  private static detectXMLTags(response: string): FormatError[] {
    const errors: FormatError[] = [];
    const patterns = [
      // <ToolName>...</ToolName>
      /<([A-Z][a-zA-Z0-9]*)>([\s\S]*?)<\/\1>/g,
      // <ToolName paramName>value</paramName>
      /<([A-Z][a-zA-Z0-9]*)\s+(\w+)>([^<]+)<\/\2>/g,
      // <invoke>...</invoke>
      /<invoke>([\s\S]*?)<\/invoke>/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(response)) !== null) {
        errors.push({
          type: 'xml_tags',
          position: match.index,
          length: match[0].length,
          original: match[0],
          suggestion: match[0], // 稍后转换
        });
      }
    }

    return errors;
  }

  /**
   * 检测函数调用格式
   * 例如: Read{filePath: "..."} 或 glob(...)
   */
  private static detectFunctionCalls(response: string, _knownTools: Set<string>): FormatError[] {
    const errors: FormatError[] = [];

    // 匹配 ToolName{...} 或 ToolName(...)
    for (const tool of _knownTools) {
      // ToolName{...} 格式
      const bracePattern = new RegExp(`\\b${tool}\\s*\\{[^}]*\\}`, 'g');
      let match;
      while ((match = bracePattern.exec(response)) !== null) {
        errors.push({
          type: 'function_call',
          position: match.index,
          length: match[0].length,
          original: match[0],
          suggestion: match[0], // 稍后转换
        });
      }

      // ToolName(...) 格式
      const parenPattern = new RegExp(`\\b${tool}\\s*\\([^)]*\\)`, 'g');
      while ((match = parenPattern.exec(response)) !== null) {
        errors.push({
          type: 'function_call',
          position: match.index,
          length: match[0].length,
          original: match[0],
          suggestion: match[0], // 稍后转换
        });
      }
    }

    return errors;
  }

  /**
   * 检测大写工具名
   * 例如: {"Tool": "Read", ...}
   */
  private static detectUppercaseToolNames(
    response: string,
    knownTools: Set<string>
  ): FormatError[] {
    const errors: FormatError[] = [];
    const pattern = /\{\s*"tool"\s*:\s*"([A-Z][a-zA-Z0-9]*)"/g;

    let match;
    while ((match = pattern.exec(response)) !== null) {
      const toolName = match[1];
      const lowerToolName = toolName.toLowerCase();

      if (knownTools.has(lowerToolName)) {
        errors.push({
          type: 'uppercase_tool',
          position: match.index,
          length: match[0].length,
          original: match[0],
          suggestion: match[0].replace(`"${toolName}"`, `"${lowerToolName}"`),
        });
      }
    }

    return errors;
  }

  /**
   * 检测缺少引号的 JSON 键
   * 例如: {tool: "read", parameters: {...}}
   */
  private static detectMissingQuotes(response: string): FormatError[] {
    const errors: FormatError[] = [];

    // 检测 {tool: "name", ...} (应该是 "tool")
    const unquotedKeyPattern = /\{\s*(tool|parameters)\s*:/g;
    let match;
    while ((match = unquotedKeyPattern.exec(response)) !== null) {
      errors.push({
        type: 'missing_quotes',
        position: match.index,
        length: match[0].length,
        original: match[0],
        suggestion: match[0].replace(/(tool|parameters)/, '"$1"'),
      });
    }

    return errors;
  }

  /**
   * 将 XML 格式转换为 JSON
   */
  private static convertXMLToJSON(errors: FormatError[], _knownTools: Set<string>) {
    if (errors.length === 0) {
      return { text: '', correction: '' };
    }

    const firstError = errors[0];
    const xmlMatch = firstError.original.match(/<(\w+)>([\s\S]*?)<\/\1>/);

    if (!xmlMatch) {
      return { text: '', correction: '' };
    }

    const toolName = xmlMatch[1].toLowerCase();

    // 尝试从 XML 中提取参数
    const content = xmlMatch[2];
    const paramPattern = /<(\w+)>([^<]+)<\/\1>/g;
    const params: Record<string, unknown> = {};

    let paramMatch;
    while ((paramMatch = paramPattern.exec(content)) !== null) {
      params[paramMatch[1]] = paramMatch[2].trim();
    }

    const jsonCall = JSON.stringify({ tool: toolName, parameters: params }, null, 2);

    return {
      text: firstError.original,
      correction: jsonCall,
    };
  }

  /**
   * 将函数调用转换为 JSON
   */
  private static convertFunctionCallToJSON(error: FormatError, _knownTools: Set<string>) {
    const original = error.original.trim();

    // 匹配 ToolName{param: value} 或 ToolName(param, value)
    const braceMatch = original.match(/^(\w+)\s*\{(.*)\}$/);
    const parenMatch = original.match(/^(\w+)\s*\((.*)\)$/);

    if (braceMatch) {
      const toolName = braceMatch[1].toLowerCase();
      const paramsStr = braceMatch[2];

      try {
        // 尝试解析参数
        // eslint-disable-next-line no-eval
        const params = eval(`(${paramsStr})`);
        const jsonCall = JSON.stringify({ tool: toolName, parameters: params }, null, 2);

        return {
          text: error.original,
          correction: jsonCall,
        };
      } catch {
        // 解析失败，返回空
        return { text: '', correction: '' };
      }
    }

    if (parenMatch) {
      const toolName = parenMatch[1].toLowerCase();
      const paramsStr = parenMatch[2];

      // 参数是逗号分隔的值列表
      const values = paramsStr.split(',').map((v: string) => v.trim());

      // 简单推断参数名
      const params: Record<string, unknown> = {};
      if (toolName === 'read' || toolName === 'cat') {
        params.filePath = values[0] || '';
      } else if (toolName === 'grep' || toolName === 'search') {
        params.pattern = values[0] || '';
        if (values[1]) params.path = values[1];
      } else if (toolName === 'write') {
        params.filePath = values[0] || '';
        if (values[1]) params.content = values[1];
      }

      const jsonCall = JSON.stringify({ tool: toolName, parameters: params }, null, 2);

      return {
        text: error.original,
        correction: jsonCall,
      };
    }

    return { text: '', correction: '' };
  }

  /**
   * 生成错误报告
   */
  static generateErrorReport(
    response: string,
    knownTools: Set<string>
  ): {
    hasErrors: boolean;
    report: string;
    corrected: string;
  } {
    const { corrected, errors, hasErrors, corrections } = this.detectAndCorrect(
      response,
      knownTools
    );

    if (!hasErrors) {
      return {
        hasErrors: false,
        report: '',
        corrected: response,
      };
    }

    let report = '⚠️  检测到工具调用格式错误，已自动纠正：\n\n';

    // 按类型分组错误
    const errorsByType = new Map<FormatErrorType, FormatError[]>();
    for (const err of errors) {
      if (!errorsByType.has(err.type)) {
        errorsByType.set(err.type, []);
      }
      errorsByType.get(err.type)!.push(err);
    }

    // 生成每种错误类型的说明
    if (errorsByType.has('xml_tags')) {
      report += '❌ XML 标签格式（不支持）\n';
      const xmlErrors = errorsByType.get('xml_tags')!;
      report += `   检测到: ${xmlErrors[0].original}\n`;
      report += '   原因: 系统只支持 JSON 格式\n';
    }

    if (errorsByType.has('function_call')) {
      report += '❌ 函数调用格式（不支持）\n';
      const funcErrors = errorsByType.get('function_call')!;
      report += `   检测到: ${funcErrors.map((e) => e.original).join(', ')}\n`;
      report += '   原因: 系统只支持 JSON 格式\n';
    }

    if (errorsByType.has('uppercase_tool')) {
      report += '❌ 大写工具名\n';
      report += '   原因: 工具名必须使用小写\n';
    }

    if (errorsByType.has('missing_quotes')) {
      report += '❌ JSON 键缺少引号\n';
      report += '   原因: JSON 格式要求键必须用引号包围\n';
    }

    // 列出纠正项
    report += '\n✅ 已应用的纠正:\n';
    corrections.forEach((correction, i) => {
      report += `   ${i + 1}. ${correction}\n`;
    });

    // 显示纠正后的格式
    report += '\n📝 纠正后的工具调用:\n';
    report += corrected;

    return {
      hasErrors: true,
      report,
      corrected,
    };
  }
}
