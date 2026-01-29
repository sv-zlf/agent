/**
 * 中断管理器
 * 参考 opencode 的实现，提供统一的 AbortSignal 管理
 */

export interface InterruptState {
  isInterrupted: boolean;
  isAIThinking: boolean;
  isExecutingTool: boolean;
  isHandlingInterrupt: boolean;
}

export class InterruptManager {
  private abortController: AbortController | null = null;
  private state: InterruptState = {
    isInterrupted: false,
    isAIThinking: false,
    isExecutingTool: false,
    isHandlingInterrupt: false,
  };

  private sigintListener: (() => void) | null = null;

  /**
   * 获取当前的 AbortSignal
   */
  get signal(): AbortSignal | null {
    return this.abortController?.signal ?? null;
  }

  /**
   * 获取当前状态
   */
  get currentState(): Readonly<InterruptState> {
    return { ...this.state };
  }

  /**
   * 设置 AI 思考状态
   */
  setAIThinking(thinking: boolean): void {
    this.state.isAIThinking = thinking;
    if (thinking) {
      this.reset();
    }
  }

  /**
   * 设置工具执行状态
   */
  setExecutingTool(executing: boolean): void {
    this.state.isExecutingTool = executing;
  }

  /**
   * 开始新的操作周期，创建新的 AbortController
   */
  startOperation(): AbortSignal {
    // 清理旧的 controller
    if (this.abortController) {
      this.abortController.abort();
    }

    // 创建新的 controller
    this.abortController = new AbortController();
    this.state.isInterrupted = false;
    this.state.isHandlingInterrupt = false;

    return this.abortController.signal;
  }

  /**
   * 请求中断
   */
  requestInterrupt(): void {
    if (this.state.isHandlingInterrupt) {
      return;
    }

    this.state.isInterrupted = true;
    this.state.isHandlingInterrupt = true;

    // 如果有活跃的 AbortController，调用 abort
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch (e) {
        // 忽略 abort 错误
      }
    }
  }

  /**
   * 检查是否已中断
   */
  isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  /**
   * 检查是否应该中断（考虑操作状态）
   */
  shouldInterrupt(): boolean {
    const { isAIThinking, isExecutingTool, isInterrupted } = this.state;

    // 如果在 AI 思考或工具执行中，且请求了中断
    return (isAIThinking || isExecutingTool) && isInterrupted;
  }

  /**
   * 重置中断状态（操作完成后调用）
   */
  reset(): void {
    this.state.isInterrupted = false;

    // 只有不在操作中时才重置 isHandlingInterrupt
    if (!this.state.isAIThinking && !this.state.isExecutingTool) {
      this.state.isHandlingInterrupt = false;
    }
  }

  /**
   * 完全重置所有状态（用于新的一轮对话）
   */
  fullReset(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.state = {
      isInterrupted: false,
      isAIThinking: false,
      isExecutingTool: false,
      isHandlingInterrupt: false,
    };
  }

  /**
   * 设置 SIGINT 监听器
   */
  setupSIGINT(onInterrupt: () => void, onExit: () => void): void {
    // 移除旧的监听器
    if (this.sigintListener) {
      process.removeListener('SIGINT', this.sigintListener);
    }

    // 创建新的监听器
    this.sigintListener = () => {
      const { isAIThinking, isExecutingTool, isHandlingInterrupt } = this.state;

      // 如果正在处理中断，忽略
      if (isHandlingInterrupt) {
        return;
      }

      // 如果在 AI 思考或工具执行中，请求中断
      if (isAIThinking || isExecutingTool) {
        this.requestInterrupt();
        onInterrupt();
      } else {
        // 如果不在操作中，执行退出
        onExit();
      }
    };

    process.on('SIGINT', this.sigintListener);
  }

  /**
   * 移除 SIGINT 监听器
   */
  removeSIGINT(): void {
    if (this.sigintListener) {
      process.removeListener('SIGINT', this.sigintListener);
      this.sigintListener = null;
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.removeSIGINT();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.fullReset();
  }
}

/**
 * 单例中断管理器实例
 */
let interruptManagerInstance: InterruptManager | null = null;

/**
 * 获取中断管理器实例
 */
export function getInterruptManager(): InterruptManager {
  if (!interruptManagerInstance) {
    interruptManagerInstance = new InterruptManager();
  }
  return interruptManagerInstance;
}

/**
 * 重置中断管理器（用于测试）
 */
export function resetInterruptManager(): void {
  if (interruptManagerInstance) {
    interruptManagerInstance.cleanup();
    interruptManagerInstance = null;
  }
}
