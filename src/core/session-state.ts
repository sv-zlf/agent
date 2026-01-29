/**
 * 会话状态管理 - 参考 opencode 的状态机设计
 */

/**
 * 会话状态枚举
 */
export enum SessionState {
  IDLE = 'idle',           // 空闲，等待用户输入
  BUSY = 'busy',           // 忙碌，正在处理
  THINKING = 'thinking',   // AI 思考中
  EXECUTING = 'executing', // 工具执行中
  ERROR = 'error',         // 错误状态
  COMPLETED = 'completed', // 任务完成
}

/**
 * 状态变化事件
 */
export interface StateChangeEvent {
  from: SessionState;
  to: SessionState;
  timestamp: number;
  message?: string;
}

/**
 * 状态变化监听器类型
 */
export type StateChangeListener = (event: StateChangeEvent) => void;

/**
 * 会话状态管理器
 */
export class SessionStateManager {
  private currentState: SessionState = SessionState.IDLE;
  private previousState: SessionState | null = null;
  private listeners: Set<StateChangeListener> = new Set();
  private stateHistory: StateChangeEvent[] = [];
  private maxHistorySize: number = 100;

  constructor(maxHistorySize: number = 100) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * 获取当前状态
   */
  getState(): SessionState {
    return this.currentState;
  }

  /**
   * 获取上一个状态
   */
  getPreviousState(): SessionState | null {
    return this.previousState;
  }

  /**
   * 设置状态
   */
  setState(newState: SessionState, message?: string): void {
    const oldState = this.currentState;

    // 如果状态没有改变，不触发事件
    if (oldState === newState) {
      return;
    }

    this.previousState = oldState;
    this.currentState = newState;

    // 记录状态变化事件
    const event: StateChangeEvent = {
      from: oldState,
      to: newState,
      timestamp: Date.now(),
      message,
    };

    this.addToHistory(event);

    // 通知所有监听器
    this.notifyListeners(event);
  }

  /**
   * 检查是否处于某个状态
   */
  isState(state: SessionState): boolean {
    return this.currentState === state;
  }

  /**
   * 检查是否处于忙碌状态（包括思考、执行等）
   */
  isBusy(): boolean {
    return [
      SessionState.BUSY,
      SessionState.THINKING,
      SessionState.EXECUTING,
    ].includes(this.currentState);
  }

  /**
   * 检查是否处于可交互状态
   */
  isInteractive(): boolean {
    return this.currentState === SessionState.IDLE;
  }

  /**
   * 重置状态到初始状态
   */
  reset(): void {
    this.setState(SessionState.IDLE, '状态重置');
  }

  /**
   * 订阅状态变化
   * @returns 取消订阅的函数
   */
  subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 获取状态历史
   */
  getHistory(limit?: number): StateChangeEvent[] {
    if (limit) {
      return this.stateHistory.slice(-limit);
    }
    return [...this.stateHistory];
  }

  /**
   * 清空状态历史
   */
  clearHistory(): void {
    this.stateHistory = [];
  }

  /**
   * 获取状态统计信息
   */
  getStatistics(): {
    totalTransitions: number;
    stateDistribution: Record<SessionState, number>;
    lastStateChange: number | null;
  } {
    const distribution: Record<SessionState, number> = {
      [SessionState.IDLE]: 0,
      [SessionState.BUSY]: 0,
      [SessionState.THINKING]: 0,
      [SessionState.EXECUTING]: 0,
      [SessionState.ERROR]: 0,
      [SessionState.COMPLETED]: 0,
    };

    // 统计每个状态的出现次数
    for (const event of this.stateHistory) {
      distribution[event.to]++;
    }

    const lastEvent = this.stateHistory[this.stateHistory.length - 1];

    return {
      totalTransitions: this.stateHistory.length,
      stateDistribution: distribution,
      lastStateChange: lastEvent ? lastEvent.timestamp : null,
    };
  }

  /**
   * 获取状态名称（用于显示）
   */
  getStateName(state: SessionState): string {
    const names: Record<SessionState, string> = {
      [SessionState.IDLE]: '空闲',
      [SessionState.BUSY]: '忙碌',
      [SessionState.THINKING]: '思考中',
      [SessionState.EXECUTING]: '执行中',
      [SessionState.ERROR]: '错误',
      [SessionState.COMPLETED]: '已完成',
    };
    return names[state] || state;
  }

  /**
   * 获取当前状态名称
   */
  getCurrentStateName(): string {
    return this.getStateName(this.currentState);
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(event: StateChangeEvent): void {
    this.stateHistory.push(event);

    // 限制历史记录大小
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift();
    }
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(event: StateChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // 监听器错误不应该影响其他监听器
        console.error('状态变化监听器错误:', error);
      }
    }
  }
}

/**
 * 全局状态管理器实例
 */
let globalStateManager: SessionStateManager | null = null;

/**
 * 获取全局状态管理器
 */
export function getGlobalStateManager(): SessionStateManager {
  if (!globalStateManager) {
    globalStateManager = new SessionStateManager();
  }
  return globalStateManager;
}

/**
 * 重置全局状态管理器
 */
export function resetGlobalStateManager(): void {
  if (globalStateManager) {
    globalStateManager.clearHistory();
    globalStateManager.reset();
  }
  globalStateManager = null;
}
