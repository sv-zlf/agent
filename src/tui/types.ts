/**
 * TUI Types
 * 终端用户界面类型定义
 */

import { Message } from '../types';

export interface TUIProps {
  sessionId?: string;
  initialMessages?: Message[];
  onSendMessage?: (content: string) => Promise<void>;
  onInterrupt?: () => void;
  onExit?: () => void;
}

export interface TUIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: {
    toolCalls?: Array<{
      name: string;
      params: Record<string, any>;
      result?: string;
    }>;
    error?: string;
  };
}

export interface TUIState {
  messages: TUIMessage[];
  input: string;
  isLoading: boolean;
  status: 'idle' | 'thinking' | 'running' | 'error';
  currentTool?: string;
  sessionTitle?: string;
}

export interface MessageListProps {
  messages: TUIMessage[];
  maxHeight?: number;
}

export interface InputBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export interface StatusBarProps {
  status: TUIState['status'];
  currentTool?: string;
  messageCount: number;
  sessionTitle?: string;
}
