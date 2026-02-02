/**
 * TUI Renderer - Blessed Version
 * TUI 渲染器 - 使用Blessed库
 */

import * as blessed from 'blessed';
import { Message } from '../types';

interface TUIOptions {
  sessionId?: string;
  initialMessages?: Message[];
  onSendMessage?: (content: string) => Promise<void>;
  onInterrupt?: () => void;
  onExit?: () => void;
}

export class TUIRenderer {
  private screen: any;
  private messageBox: any;
  private inputBox: any;
  private statusBar: any;
  private header: any;
  private onSendMessage?: (content: string) => Promise<void>;
  private onInterrupt?: () => void;
  private onExit?: () => void;
  private isLoading = false;

  constructor(options: TUIOptions) {
    this.onSendMessage = options.onSendMessage;
    this.onInterrupt = options.onInterrupt;
    this.onExit = options.onExit;

    // 创建屏幕
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'GG CODE - AI-Powered Code Editor',
    });

    // 创建头部
    this.header = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: '{center}GG CODE - AI-Powered Code Editor{/center}',
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        fg: 'cyan',
        border: {
          fg: 'cyan',
        },
      },
    });

    // 创建消息区域
    this.messageBox = blessed.log({
      top: 3,
      left: 0,
      width: '100%',
      height: '70%',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        style: {
          inverse: true,
        },
      },
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        border: {
          fg: 'gray',
        },
      },
    });

    // 创建输入框
    this.inputBox = blessed.textarea({
      bottom: 3,
      left: 0,
      width: '100%',
      height: 3,
      inputOnFocus: true,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        border: {
          fg: 'blue',
        },
        focus: {
          border: {
            fg: 'cyan',
          },
        },
      },
    });

    // 创建状态栏
    this.statusBar = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' Ready | Ctrl+C: Exit | P: Interrupt ',
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        fg: 'green',
        border: {
          fg: 'green',
        },
      },
    });

    // 组装界面
    this.screen.append(this.header);
    this.screen.append(this.messageBox);
    this.screen.append(this.inputBox);
    this.screen.append(this.statusBar);

    // 绑定事件
    this.bindEvents();

    // 显示欢迎消息
    this.addMessage('system', 'Welcome to GG CODE!');
    this.addMessage('system', 'Type your message and press Enter to send.');
    this.addMessage('system', 'Press Ctrl+C to exit, P to interrupt.');

    // 加载历史消息
    if (options.initialMessages) {
      options.initialMessages.forEach((msg) => {
        this.addMessage(msg.role as 'user' | 'assistant' | 'system', msg.content);
      });
    }
  }

  private bindEvents(): void {
    // 输入框提交事件
    this.inputBox.key('enter', async () => {
      if (this.isLoading) return;

      const content = this.inputBox.getValue().trim();
      if (!content) return;

      // 清空输入框
      this.inputBox.setValue('');
      this.screen.render();

      // 显示用户消息
      this.addMessage('user', content);

      // 发送消息
      if (this.onSendMessage) {
        this.setLoading(true);
        try {
          await this.onSendMessage(content);
        } catch (error) {
          this.addMessage(
            'system',
            `Error: ${error instanceof Error ? error.message : String(error)}`
          );
        } finally {
          this.setLoading(false);
        }
      }
    });

    // 全局按键事件
    this.screen.key(['C-c'], () => {
      if (this.isLoading && this.onInterrupt) {
        this.onInterrupt();
        this.setLoading(false);
      } else {
        this.onExit?.();
        process.exit(0);
      }
    });

    this.screen.key(['p', 'P'], () => {
      if (this.isLoading && this.onInterrupt) {
        this.onInterrupt();
        this.setLoading(false);
      }
    });

    // 聚焦输入框
    this.inputBox.focus();
  }

  public addMessage(role: 'user' | 'assistant' | 'system', content: string): void {
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    let coloredRole: string;
    switch (role) {
      case 'user':
        coloredRole = '{blue-fg}You{/blue-fg}';
        break;
      case 'assistant':
        coloredRole = '{green-fg}AI{/green-fg}';
        break;
      case 'system':
        coloredRole = '{yellow-fg}System{/yellow-fg}';
        break;
      default:
        coloredRole = role;
    }

    const lines = content.split('\n');
    const formattedContent = lines.map((line) => `  ${line}`).join('\n');

    const message = `[${timestamp}] ${coloredRole}:\n${formattedContent}\n`;
    this.messageBox.log(message);
    this.screen.render();
  }

  public setLoading(loading: boolean): void {
    this.isLoading = loading;
    if (loading) {
      this.statusBar.setContent(
        ' {yellow-fg}Thinking...{/yellow-fg} | P: Interrupt | Ctrl+C: Exit '
      );
    } else {
      this.statusBar.setContent(' {green-fg}Ready{/green-fg} | Ctrl+C: Exit | P: Interrupt ');
    }
    this.screen.render();
  }

  public setStatus(status: 'idle' | 'thinking' | 'running' | 'error', toolName?: string): void {
    let content: string;
    switch (status) {
      case 'thinking':
        content = ' {yellow-fg}AI is thinking...{/yellow-fg} | P: Interrupt | Ctrl+C: Exit ';
        break;
      case 'running':
        content = ` {cyan-fg}Running ${toolName || 'tool'}...{/cyan-fg} | P: Interrupt | Ctrl+C: Exit `;
        break;
      case 'error':
        content = ' {red-fg}Error occurred{/red-fg} | Ctrl+C: Exit ';
        break;
      case 'idle':
      default:
        content = ' {green-fg}Ready{/green-fg} | Ctrl+C: Exit | P: Interrupt ';
    }
    this.statusBar.setContent(content);
    this.screen.render();
  }

  public render(): void {
    this.screen.render();
  }

  public stop(): void {
    this.screen.destroy();
  }
}

let currentRenderer: TUIRenderer | null = null;

/**
 * 启动 TUI 界面
 */
export function startTUI(options: TUIOptions): { stop: () => void } {
  currentRenderer = new TUIRenderer(options);
  currentRenderer.render();

  return {
    stop: () => {
      currentRenderer?.stop();
      currentRenderer = null;
    },
  };
}

/**
 * 添加消息到 TUI
 */
export function addMessageToTUI(
  content: string,
  _role: 'assistant' | 'system' = 'assistant',
  _metadata?: Record<string, any>
): void {
  if (currentRenderer) {
    currentRenderer.addMessage(_role, content);
  }
}

/**
 * 更新 TUI 状态
 */
export function updateTUIStatus(
  status: 'idle' | 'thinking' | 'running' | 'error',
  currentTool?: string
): void {
  if (currentRenderer) {
    currentRenderer.setStatus(status, currentTool);
  }
}

export default startTUI;
