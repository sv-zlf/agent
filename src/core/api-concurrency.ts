/**
 * API 并发控制器
 * 确保同时只有一个API请求在执行，避免并发冲突
 */

import { createLogger } from '../utils';

const logger = createLogger(false);

/**
 * API 请求队列项
 */
interface QueuedRequest<T> {
  id: string;
  execute: () => Promise<T>;
  resolve: (result: T) => void;
  reject: (error: Error) => void;
  priority: number; // 优先级，数字越小优先级越高
}

/**
 * API 并发控制器
 * 使用单例模式确保全局只有一个实例
 */
export class APIConcurrencyController {
  private static instance: APIConcurrencyController | null = null;
  private isProcessing: boolean = false;
  private queue: QueuedRequest<any>[] = [];
  private requestCounter: number = 0;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): APIConcurrencyController {
    if (!this.instance) {
      this.instance = new APIConcurrencyController();
    }
    return this.instance;
  }

  /**
   * 执行API请求（自动排队）
   */
  async execute<T>(requestFn: () => Promise<T>, priority: number = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const requestId = `req_${++this.requestCounter}_${Date.now()}`;

      const queuedRequest: QueuedRequest<T> = {
        id: requestId,
        execute: requestFn,
        resolve,
        reject,
        priority,
      };

      // 添加到队列（按优先级插入）
      this.insertByPriority(queuedRequest);

      logger.debug(`API请求已排队: ${requestId}, 当前队列长度: ${this.queue.length}`);

      // 尝试处理队列
      this.processQueue();
    });
  }

  /**
   * 按优先级插入队列
   */
  private insertByPriority<T>(request: QueuedRequest<T>): void {
    // 找到合适的插入位置（优先级从小到大）
    let insertIndex = this.queue.length;

    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority > request.priority) {
        insertIndex = i;
        break;
      }
    }

    this.queue.splice(insertIndex, 0, request);
  }

  /**
   * 处理队列中的请求
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const request = this.queue.shift()!;

        try {
          logger.debug(`开始处理API请求: ${request.id}`);
          const result = await request.execute();
          request.resolve(result);
          logger.debug(`API请求完成: ${request.id}`);

          // 检测429错误并在队列不为空时添加延迟（缩短等待时间）
          if (this.queue.length > 0 && this.queue.length <= 2) {
            logger.debug(`队列中还有 ${this.queue.length} 个请求，等待500ms以避免并发限制`);
            await new Promise((resolve) => setTimeout(resolve, 500));
          } else if (this.queue.length > 2) {
            logger.debug(`队列中还有 ${this.queue.length} 个请求，等待800ms以避免并发限制`);
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        } catch (error: any) {
          // 只对网络连接错误（非 API 响应错误）做并发控制
          // API 返回的 429 等错误由 withRetry 处理重试，这里直接透传
          const isAPIResponseError = error?.context?.responseData || error?.message?.includes('{');

          if (!isAPIResponseError && error.message && error.message.includes('429')) {
            if (
              error.message.includes('使用上限') ||
              error.message.includes('限额') ||
              error.message.includes('quota') ||
              error.message.includes('limit')
            ) {
              logger.info(`API配额已达上限: ${error.message}`);
            } else if (
              error.message.includes('并发') ||
              error.message.includes('concurrent') ||
              error.message.includes('过高')
            ) {
              logger.info(`API并发限制: ${error.message}`);
            } else {
              logger.info(`API限制: ${error.message}`);
            }
          }

          logger.error(`API请求失败: ${request.id}, 错误: ${(error as Error).message}`);
          request.reject(error as Error);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 获取当前队列状态
   */
  getStatus(): {
    isProcessing: boolean;
    queueLength: number;
    pendingRequests: string[];
  } {
    return {
      isProcessing: this.isProcessing,
      queueLength: this.queue.length,
      pendingRequests: this.queue.map((req) => req.id),
    };
  }

  /**
   * 清空队列（用于紧急停止）
   */
  clearQueue(): void {
    const clearedRequests = this.queue.length;
    this.queue.forEach((req) => {
      req.reject(new Error('API请求队列已清空'));
    });
    this.queue = [];
    logger.debug(`已清空API请求队列，清除了 ${clearedRequests} 个请求`);
  }

  /**
   * 重置控制器（主要用于测试）
   */
  static reset(): void {
    if (this.instance) {
      this.instance.clearQueue();
      this.instance = null;
    }
  }
}

/**
 * 便捷函数：执行受并发控制的API请求
 */
export async function executeAPIRequest<T>(
  requestFn: () => Promise<T>,
  priority: number = 0
): Promise<T> {
  const controller = APIConcurrencyController.getInstance();
  return controller.execute(requestFn, priority);
}

/**
 * 优先级常量
 */
export const API_PRIORITY = {
  HIGH: 0, // 高优先级：用户直接请求
  NORMAL: 1, // 普通优先级：工具执行
  LOW: 2, // 低优先级：摘要生成、压缩等
} as const;
