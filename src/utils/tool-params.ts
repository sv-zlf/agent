/**
 * GG CODE - 工具参数处理工具
 * 统一处理工具参数的提取、转换和验证
 */

/**
 * 常见的路径参数名
 */
export const PATH_PARAM_KEYS = ['file_path', 'path', 'filePath', 'pattern', 'glob'] as const;

/**
 * 参数名映射（snake_case → camelCase）
 */
export const PARAM_MAPPINGS: Record<string, Record<string, string>> = {
  Read: {
    file_path: 'filePath',
  },
  Write: {
    file_path: 'filePath',
    content: 'content',
  },
  Edit: {
    file_path: 'filePath',
    old_string: 'oldString',
    new_string: 'newString',
    replace_all: 'replaceAll',
  },
  Glob: {
    pattern: 'pattern',
    path: 'path',
  },
  Grep: {
    pattern: 'pattern',
    path: 'path',
  },
  Bash: {
    command: 'command',
  },
  MultiEdit: {
    file_path: 'filePath',
    edits: 'edits',
  },
  Batch: {
    tool_calls: 'toolCalls',
  },
  Task: {
    prompt: 'prompt',
  },
  TodoWrite: {
    todos: 'todos',
  },
  TodoRead: {},
  TodoDelete: {
    id: 'id',
  },
  TodoClear: {},
};

/**
 * 工具参数上下文
 */
export interface ToolParameterContext {
  /** 工具名称 */
  toolName: string;
  /** 原始参数 */
  parameters: Record<string, unknown>;
}

/**
 * 工具参数处理类
 */
export class ToolParameterHelper {
  /**
   * 从工具参数中提取路径（用于权限检查）
   * @param params 工具参数
   * @returns 路径字符串或 undefined
   */
  static extractPath(params: Record<string, unknown>): string | undefined {
    for (const key of PATH_PARAM_KEYS) {
      if (params[key]) {
        return String(params[key]);
      }
    }

    return undefined;
  }

  /**
   * 验证参数完整性
   * @param params 参数对象
   * @param required 必需参数列表
   * @returns 验证结果
   */
  static validateParams(
    params: Record<string, unknown>,
    required: string[]
  ): { valid: boolean; missing: string[] } {
    const missing = required.filter((key) => !(key in params));

    return {
      valid: missing.length === 0,
      missing,
    };
  }

  /**
   * 清理参数值（移除空字符串、null、undefined）
   * @param params 参数对象
   * @returns 清理后的参数
   */
  static cleanParams(params: Record<string, unknown>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== '') {
        cleaned[key] = value;
      }
    }

    return cleaned;
  }

  /**
   * 适配工具参数（snake_case → camelCase，支持大小写不敏感匹配）
   * @param toolName 工具名称
   * @param params 原始参数
   * @returns 适配后的参数
   */
  static adaptParameters(
    toolName: string,
    params: Record<string, unknown>
  ): Record<string, unknown> {
    const adapted = { ...params };
    const mappings = PARAM_MAPPINGS[toolName];

    if (mappings) {
      for (const [snakeName, camelName] of Object.entries(mappings)) {
        if (snakeName === camelName) {
          continue;
        }

        const lowerSnakeName = snakeName.toLowerCase();

        for (const key of Object.keys(adapted)) {
          if (key.toLowerCase() === lowerSnakeName) {
            adapted[camelName] = adapted[key];
            delete adapted[key];
            break;
          }
        }
      }
    }

    return adapted;
  }

  /**
   * 格式化工具参数为字符串（用于显示）
   * @param params 参数对象
   * @returns 格式化后的字符串
   */
  static formatParams(params: Record<string, unknown>): string {
    return Object.entries(params)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');
  }

  /**
   * 检查参数是否包含路径
   * @param params 参数对象
   * @returns 是否包含路径参数
   */
  static hasPathParam(params: Record<string, unknown>): boolean {
    return PATH_PARAM_KEYS.some((key) => key in params);
  }

  /**
   * 获取所有可能的路径参数值
   * @param params 参数对象
   * @returns 路径值数组
   */
  static extractAllPaths(params: Record<string, unknown>): string[] {
    const paths: string[] = [];

    for (const key of PATH_PARAM_KEYS) {
      if (params[key]) {
        paths.push(String(params[key]));
      }
    }

    return paths;
  }
}

/**
 * 默认导出
 */
export default ToolParameterHelper;
