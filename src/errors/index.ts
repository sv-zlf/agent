/**
 * GG CODE - 统一错误处理系统
 *
 * 提供标准化的错误类层次结构，便于错误追踪和处理
 */

/**
 * 错误代码枚举
 * 所有错误都应该有明确的错误代码
 */
export enum ErrorCode {
  // API 错误 (1xxx)
  API_NETWORK_ERROR = 'API_1001',
  API_EMPTY_RESPONSE = 'API_1002',
  API_BLANK_CONTENT = 'API_1003',
  API_TIMEOUT = 'API_1004',
  API_ABORTED = 'API_1005',
  API_RATE_LIMIT = 'API_1006',
  API_AUTH_FAILED = 'API_1007',

  // 工具错误 (2xxx)
  TOOL_NOT_FOUND = 'TOOL_2001',
  TOOL_EXECUTION_FAILED = 'TOOL_2002',
  TOOL_VALIDATION_FAILED = 'TOOL_2003',
  TOOL_PERMISSION_DENIED = 'TOOL_2004',
  TOOL_TIMEOUT = 'TOOL_2005',

  // 配置错误 (3xxx)
  CONFIG_INVALID = 'CONFIG_3001',
  CONFIG_MISSING = 'CONFIG_3002',
  CONFIG_SCHEMA_ERROR = 'CONFIG_3003',

  // 文件错误 (4xxx)
  FILE_NOT_FOUND = 'FILE_4001',
  FILE_READ_ERROR = 'FILE_4002',
  FILE_WRITE_ERROR = 'FILE_4003',
  FILE_TOO_LARGE = 'FILE_4004',

  // 会话错误 (5xxx)
  SESSION_NOT_FOUND = 'SESSION_5001',
  _SESSION_LOAD_FAILED = 'SESSION_5002',
  SESSION_SAVE_FAILED = 'SESSION_5003',

  // Agent 错误 (6xxx)
  AGENT_EXECUTION_FAILED = 'AGENT_6001',
  AGENT_MAX_ITERATIONS = 'AGENT_6002',
  AGENT_INTERRUPTED = 'AGENT_6003',

  // 通用错误 (9xxx)
  UNKNOWN_ERROR = 'ERROR_9999',
}

/**
 * 基础错误类
 * 所有自定义错误都应该继承此类
 */
export class GGCodeError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly timestamp: number;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    statusCode?: number,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.timestamp = Date.now();
    this.context = context;

    // 维持正确的原型链
    Object.setPrototypeOf(this, new.target.prototype);

    // 捕获堆栈跟踪（在某些环境中）
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * 转换为可序列化的对象
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      context: this.context,
      stack: this.stack,
    };
  }

  /**
   * 格式化错误消息用于日志
   */
  toLogMessage(): string {
    const parts = [`[${this.code}]`, this.message];

    if (this.context) {
      parts.push(`Context: ${JSON.stringify(this.context)}`);
    }

    return parts.join(' ');
  }
}

/**
 * API 相关错误
 */
export class APIError extends GGCodeError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.API_NETWORK_ERROR,
    statusCode?: number,
    context?: Record<string, unknown>
  ) {
    super(message, code, statusCode, context);
    this.name = 'APIError';
  }
}

/**
 * 工具执行错误
 */
export class ToolExecutionError extends GGCodeError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.TOOL_EXECUTION_FAILED,
    context?: Record<string, unknown>
  ) {
    super(message, code, undefined, context);
    this.name = 'ToolExecutionError';
  }
}

/**
 * 配置错误
 */
export class ConfigurationError extends GGCodeError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.CONFIG_INVALID,
    context?: Record<string, unknown>
  ) {
    super(message, code, undefined, context);
    this.name = 'ConfigurationError';
  }
}

/**
 * 文件操作错误
 */
export class FileOperationError extends GGCodeError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.FILE_READ_ERROR,
    context?: Record<string, unknown>
  ) {
    super(message, code, undefined, context);
    this.name = 'FileOperationError';
  }
}

/**
 * 会话错误
 */
export class SessionError extends GGCodeError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.SESSION_NOT_FOUND,
    context?: Record<string, unknown>
  ) {
    super(message, code, undefined, context);
    this.name = 'SessionError';
  }
}

/**
 * Agent 执行错误
 */
export class AgentExecutionError extends GGCodeError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.AGENT_EXECUTION_FAILED,
    context?: Record<string, unknown>
  ) {
    super(message, code, undefined, context);
    this.name = 'AgentExecutionError';
  }
}

/**
 * 错误工具类
 * 提供错误处理的辅助方法
 */
export class ErrorHelper {
  /**
   * 判断错误是否为特定类型
   */
  static isTypeError(error: unknown, errorClass: new (...args: any[]) => Error): boolean {
    return error instanceof errorClass;
  }

  /**
   * 提取用户友好的错误消息
   */
  static getUserMessage(error: unknown): string {
    if (error instanceof GGCodeError) {
      return error.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  /**
   * 记录错误到日志
   */
  static logError(error: unknown, logger?: { error: (msg: string) => void }): void {
    const message = error instanceof GGCodeError ? error.toLogMessage() : String(error);

    if (logger) {
      logger.error(message);
    } else {
      console.error(message);
    }
  }

  /**
   * 将未知错误转换为 GGCodeError
   */
  static normalize(error: unknown): GGCodeError {
    if (error instanceof GGCodeError) {
      return error;
    }

    if (error instanceof Error) {
      return new GGCodeError(error.message, ErrorCode.UNKNOWN_ERROR, undefined, {
        originalError: error.name,
        stack: error.stack,
      });
    }

    return new GGCodeError(String(error), ErrorCode.UNKNOWN_ERROR);
  }
}
