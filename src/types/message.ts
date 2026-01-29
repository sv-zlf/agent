/**
 * 增强的消息系统 - 参考 opencode 的 MessageV2 设计
 */

/**
 * Part 类型枚举
 */
export enum PartType {
  TEXT = 'text',
  FILE = 'file',
  TOOL_CALL = 'tool_call',
  TOOL_RESULT = 'tool_result',
  REASONING = 'reasoning',
  SYSTEM = 'system',
}

/**
 * 消息部分 - 每个消息可以包含多个部分
 */
export interface MessagePart {
  type: PartType;
  id: string;
  content: string;
  metadata?: Record<string, any>;
  synthetic?: boolean; // 系统自动生成的部分
  ignored?: boolean;   // 不在上下文中使用
}

/**
 * 增强的消息结构
 */
export interface EnhancedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
  timestamp: number;
  agent?: string;
  finish?: string; // 状态: 'completed', 'tool-calls', 'unknown'
}

/**
 * 工具调用部分
 */
export interface ToolCallPart extends MessagePart {
  type: PartType.TOOL_CALL;
  content: string; // JSON 字符串
  metadata: {
    tool: string;
    parameters: Record<string, any>;
  };
}

/**
 * 工具结果部分
 */
export interface ToolResultPart extends MessagePart {
  type: PartType.TOOL_RESULT;
  content: string; // 输出或错误信息
  metadata: {
    toolCallId: string;
    tool: string;
    success: boolean;
    error?: string;
    duration?: number;
    truncated?: boolean;
  };
}

/**
 * 文件部分
 */
export interface FilePart extends MessagePart {
  type: PartType.FILE;
  content: string; // 文件内容
  metadata: {
    path: string;
    operation?: 'read' | 'write' | 'edit';
  };
}

/**
 * 推理部分
 */
export interface ReasoningPart extends MessagePart {
  type: PartType.REASONING;
  content: string; // 推理过程
  synthetic: true; // 推理通常是自动生成的
}

/**
 * 创建新的消息
 */
export function createMessage(
  role: 'user' | 'assistant' | 'system',
  contentOrParts: string | MessagePart[],
  agent?: string
): EnhancedMessage {
  const parts = Array.isArray(contentOrParts)
    ? contentOrParts
    : [createTextPart(contentOrParts)];

  return {
    id: generateId(),
    role,
    parts,
    timestamp: Date.now(),
    agent,
  };
}

/**
 * 创建文本部分
 */
export function createTextPart(
  content: string,
  synthetic?: boolean
): MessagePart {
  return {
    type: PartType.TEXT,
    id: generateId(),
    content,
    synthetic,
  };
}

/**
 * 创建工具调用部分
 */
export function createToolCallPart(
  tool: string,
  parameters: Record<string, any>
): ToolCallPart {
  return {
    type: PartType.TOOL_CALL,
    id: generateId(),
    content: JSON.stringify({ tool, parameters }),
    metadata: { tool, parameters },
  };
}

/**
 * 创建工具结果部分
 */
export function createToolResultPart(
  toolCallId: string,
  tool: string,
  success: boolean,
  output?: string,
  error?: string,
  duration?: number
): ToolResultPart {
  return {
    type: PartType.TOOL_RESULT,
    id: generateId(),
    content: output || error || '',
    metadata: {
      toolCallId,
      tool,
      success,
      error,
      duration,
      truncated: output ? output.length > 2000 : undefined,
    },
  };
}

/**
 * 创建系统部分
 */
export function createSystemPart(
  content: string,
  synthetic?: boolean
): MessagePart {
  return {
    type: PartType.SYSTEM,
    id: generateId(),
    content,
    synthetic: synthetic !== undefined ? synthetic : true, // 系统部分默认是合成的
  };
}

/**
 * 创建推理部分
 */
export function createReasoningPart(
  content: string
): ReasoningPart {
  return {
    type: PartType.REASONING,
    id: generateId(),
    content,
    synthetic: true,
  };
}

/**
 * 生成唯一ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 将消息转换为纯文本（用于兼容旧的 API）
 */
export function messageToText(message: EnhancedMessage): string {
  return message.parts
    .filter(part => !part.ignored) // 过滤掉被忽略的部分
    .filter(part => part.type !== PartType.SYSTEM) // 过滤掉系统部分
    .map(part => {
      switch (part.type) {
        case PartType.TOOL_CALL:
          return `[调用工具: ${part.metadata?.tool}]`;
        case PartType.TOOL_RESULT:
          return part.metadata?.success
            ? `[工具执行成功]`
            : `[工具执行失败: ${part.metadata?.error}]`;
        case PartType.FILE:
          return `[文件: ${part.metadata?.path}]`;
        case PartType.REASONING:
          return `[推理过程]\n${part.content}`;
        default:
          return part.content;
      }
    })
    .join('\n');
}

/**
 * 过滤消息部分（根据 synthetic 和 ignored 标志）
 */
export function filterMessageParts(
  message: EnhancedMessage,
  options?: {
    includeSynthetic?: boolean;
    includeIgnored?: boolean;
  }
): MessagePart[] {
  const { includeSynthetic = false, includeIgnored = false } = options || {};

  return message.parts.filter(part => {
    if (part.ignored && !includeIgnored) {
      return false;
    }
    if (part.synthetic && !includeSynthetic) {
      return false;
    }
    return true;
  });
}

/**
 * 获取消息中的所有工具调用
 */
export function getToolCalls(message: EnhancedMessage): ToolCallPart[] {
  return message.parts.filter(
    (part): part is ToolCallPart => part.type === PartType.TOOL_CALL
  );
}

/**
 * 获取消息中的所有工具结果
 */
export function getToolResults(message: EnhancedMessage): ToolResultPart[] {
  return message.parts.filter(
    (part): part is ToolResultPart => part.type === PartType.TOOL_RESULT
  );
}
