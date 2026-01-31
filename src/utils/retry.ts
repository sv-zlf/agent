/**
 * GG CODE - 重试工具
 * 提供通用的指数退避重试功能
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryOn?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryOn: () => true,
  onRetry: () => {},
};

export interface RetryResult<T> {
  success: true;
  data: T;
  attempts: number;
  totalTime: number;
}

export interface RetryError extends Error {
  attempts: number;
  lastError: unknown;
  totalTime: number;
}

export function isRetryError(error: unknown): error is RetryError {
  return error instanceof Error && 'attempts' in error && 'lastError' in error;
}

/**
 * 带指数退避的重试函数
 * @param fn 要重试的异步函数
 * @param options 重试选项
 * @returns 如果成功，返回结果和重试信息；如果失败，抛出 RetryError
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const data = await fn();
      return {
        success: true,
        data,
        attempts: attempt + 1,
        totalTime: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error;

      if (attempt === opts.maxRetries) {
        const err = new Error(`重试失败，已达到最大重试次数 (${opts.maxRetries})`) as RetryError;
        err.attempts = attempt + 1;
        err.lastError = error;
        err.totalTime = Date.now() - startTime;
        throw err;
      }

      if (!opts.retryOn(error)) {
        throw error;
      }

      opts.onRetry(error, attempt + 1);

      const delay = Math.min(
        opts.initialDelay * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelay
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * 创建可重试的 API 请求函数
 */
export function createRetryableAPI<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  options?: RetryOptions
): (...args: Args) => Promise<T> {
  return (...args: Args) =>
    withRetry(() => fn(...args), {
      retryOn: (error) => {
        if (isRetryError(error)) return false;
        if (error instanceof Error) {
          const message = error.message.toLowerCase();
          return (
            message.includes('network') ||
            message.includes('econnreset') ||
            message.includes('etimedout') ||
            message.includes('socket') ||
            message.includes('503') ||
            message.includes('502') ||
            message.includes('429')
          );
        }
        return true;
      },
      ...options,
    }).then((result) => result.data);
}

/**
 * 重试配置常量
 */
export const RETRY_CONFIG = {
  API: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  },
  TOOL: {
    maxRetries: 2,
    initialDelay: 500,
    maxDelay: 5000,
    backoffMultiplier: 2,
  },
  NETWORK: {
    maxRetries: 5,
    initialDelay: 2000,
    maxDelay: 60000,
    backoffMultiplier: 1.5,
  },
};
