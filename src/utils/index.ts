import * as path from 'path';
import * as os from 'os';

export { Logger, createLogger } from './logger';
export { BackupManager, createBackupManager } from './backup';
export { select, confirm, input, multiSelect, textInput } from './prompt';
export type { SelectOption, SelectConfig, InputConfig } from './prompt';
export { truncateOutput, cleanupOldTruncationFiles, formatTruncateStats } from './truncation';
export type { TruncateOptions, TruncateResult, TruncateStats } from './truncation';
export {
  renderMarkdown,
  renderMarkdownSimple,
  renderDiff,
  renderCode,
  renderKeyValue,
  hasMarkdown,
  smartRender,
} from './markdown';
export {
  withRetry,
  createRetryableAPI,
  isRetryError,
  RETRY_CONFIG,
  type RetryOptions,
  type RetryResult,
  type RetryError,
} from './retry';
// MarkdownOptions 类型已在使用时内联定义，不单独导出

/**
 * 获取系统根目录下的 .ggcode 路径
 * 所有临时文件都保存在用户主目录的 .ggcode 文件夹中
 */
export function getGGCodeRoot(): string {
  return path.join(os.homedir(), '.ggcode');
}

/**
 * 获取会话目录路径
 */
export function getSessionsDir(): string {
  return path.join(getGGCodeRoot(), 'sessions');
}

/**
 * 获取当前会话文件路径
 */
export function getCurrentSessionFile(): string {
  return path.join(getGGCodeRoot(), 'current-session');
}

/**
 * 获取历史文件基础路径
 */
export function getHistoryBasePath(): string {
  return path.join(getGGCodeRoot(), 'history');
}

/**
 * 获取配置文件路径（统一保存在 .ggcode 目录）
 */
export function getConfigPath(): string {
  return path.join(getGGCodeRoot(), 'config.json');
}

/**
 * 获取系统级配置文件路径（系统级配置保存在 .ggcode）
 */
export function getSystemConfigPath(): string {
  return path.join(getGGCodeRoot(), 'config.json');
}
