/**
 * 消息角色类型
 */
export type MessageRole = 'system' | 'user' | 'assistant';

/**
 * 消息类型（简单版本，用于向后兼容）
 */
export interface Message {
  role: MessageRole;
  content: string;
}

// 导出增强的消息系统
export * from './message';

/**
 * API 模式类型
 */
export type APIMode = 'A4011LM01' | 'OpenApi';

/**
 * 内网 API 配置接口（A4011LM01 模式）
 */
export interface InternalAPIConfig {
  base_url: string;
  access_key_id: string;
  tx_code: string;
  sec_node_no: string;
  model: string;
  timeout?: number;
}

/**
 * OpenAPI 配置接口（OpenApi 模式）
 */
export interface OpenAPIConfig {
  base_url: string;
  api_key: string;
  model: string;
  timeout?: number;
}

/**
 * API 配置联合类型
 * 支持两种模式的所有字段
 */
export type APIConfig = {
  mode?: APIMode;
  base_url: string;
  model: string;
  timeout?: number;
  // 内网 API (A4011LM01) 字段
  access_key_id?: string;
  tx_code?: string;
  sec_node_no?: string;
  // OpenAPI 字段
  api_key?: string;
};

/**
 * 模型配置
 */
export interface ModelConfig {
  model: string;
  repetition_penalty?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
}

/**
 * 内网API请求体（内层）
 */
export interface InternalAPIRequest {
  user_id?: string;
  messages: Message[];
  stream: boolean;
  echo?: boolean;
  model_config: ModelConfig;
}

/**
 * 内网API响应体
 */
export interface InternalAPIResponse {
  'C-API-Status': string;
  'C-Response-Code': string;
  'C-Response-Desc': string;
  'C-Response-Body': {
    codeid: string;
    Data_Enqr_Rslt: string;
  };
}

/**
 * OpenAPI 请求体
 */
export interface OpenAPIRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

/**
 * OpenAPI 响应体
 */
export interface OpenAPIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * 解析后的API结果
 */
export interface ParsedResult {
  traceId: string;
  notes?: string;
  choices: Array<{
    finish_reason: string;
    index: number;
    messages: {
      content: string;
      role: string;
    };
  }>;
  created: number;
  usage: {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * 会话管理配置
 */
export interface SessionManagementConfig {
  max_sessions: number; // 最大会话数量
  max_inactive_days: number; // 最大非活跃天数
  auto_cleanup: boolean; // 是否自动清理
  cleanup_interval_hours: number; // 清理检查间隔（小时）
  preserve_recent_sessions: number; // 保留最近的会话数量（不受时间限制）
}

/**
 * Agent配置接口
 */
export interface AgentConfig {
  api: APIConfig;
  agent: {
    max_context_tokens: number;
    max_history: number;
    max_iterations?: number;
    auto_approve?: boolean;
  };
  sessions?: SessionManagementConfig;
}

/**
 * 代码编辑操作
 */
export interface CodeEdit {
  filePath: string;
  oldContent: string;
  newContent: string;
}

/**
 * 文件分析结果
 */
export interface FileAnalysis {
  path: string;
  language: string;
  lineCount: number;
  size: number;
  functions?: string[];
  classes?: string[];
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  pattern?: string;
  filePattern?: string;
  caseSensitive?: boolean;
  maxResults?: number;
}

/**
 * 任务类型
 */
export type TaskType = 'chat' | 'edit' | 'search' | 'analyze';

/**
 * 解析后的任务
 */
export interface ParsedTask {
  type: TaskType;
  query: string;
  files?: string[];
  options?: Record<string, unknown>;
}

/**
 * 工具调用参数
 */
export interface ToolCallParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  default?: unknown;
}

/**
 * 工具权限级别
 */
export type ToolPermissionLevel = 'safe' | 'local-modify' | 'network' | 'dangerous';

/**
 * 工具定义
 */
export interface ToolDefinition {
  name: string;
  description: string;
  category: 'file' | 'search' | 'command' | 'system';
  permission: ToolPermissionLevel; // 权限级别
  parameters: Record<string, ToolCallParameter>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * 工具调用请求
 */
export interface ToolCall {
  tool: string;
  parameters: Record<string, unknown>;
  id?: string;
}

/**
 * 工具执行结果元数据
 * 支持标准字段和自定义扩展字段
 */
export interface ToolResultMetadata extends Record<string, unknown> {
  startTime?: number; // 开始时间戳
  endTime?: number; // 结束时间戳
  duration?: number; // 执行时长（毫秒）
  truncated?: boolean; // 输出是否被截断
  truncationFile?: string; // 截断后完整输出的存储路径
  truncationStats?: {
    // 截断统计信息
    totalLines: number;
    totalBytes: number;
    keptLines: number;
    keptBytes: number;
    removedLines?: number;
    removedBytes?: number;
    truncateReason: 'lines' | 'bytes';
  };
  attachments?: string[]; // 文件附件路径列表
  exitCode?: number; // 退出码（用于命令工具）
  signal?: string; // 中断信号（如果被中断）
  retryCount?: number; // 重试次数
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: ToolResultMetadata;
}

/**
 * Agent执行状态
 */
export type AgentStatus = 'idle' | 'thinking' | 'running' | 'error' | 'completed';

/**
 * Agent执行配置
 */
export interface AgentRuntimeConfig {
  maxIterations: number;
  autoApprove: boolean;
  dangerousCommands: string[];
  workingDirectory: string;
}

/**
 * Agent执行上下文
 */
export interface AgentContext {
  iteration: number;
  toolCalls: ToolCall[];
  results: ToolResult[];
  files: string[];
  currentPlan?: string;
}
