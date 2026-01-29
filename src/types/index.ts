/**
 * 消息角色类型
 */
export type MessageRole = 'system' | 'user' | 'assistant';

/**
 * 消息类型
 */
export interface Message {
  role: MessageRole;
  content: string;
}

/**
 * API配置接口
 */
export interface APIConfig {
  base_url: string;
  access_key_id: string;
  tx_code: string;
  sec_node_no: string;
  model: string;
  timeout?: number;
}

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
    'Data_Enqr_Rslt': string;
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
 * Agent配置接口
 */
export interface AgentConfig {
  api: APIConfig;
  agent: {
    max_context_tokens: number;
    backup_before_edit: boolean;
    backup_dir: string;
    max_file_size: number;
    max_history: number;
    max_iterations?: number;
    auto_approve?: boolean;
  };
  prompts: {
    system: string;
    code_edit: string;
    agent_mode?: string;
  };
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
 * 工具定义
 */
export interface ToolDefinition {
  name: string;
  description: string;
  category: 'file' | 'search' | 'command' | 'system';
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
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
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
