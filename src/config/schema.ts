import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as fsSync from 'fs';
import dotenv from 'dotenv';
import type { AgentConfig } from '../types';
import { ConfigurationError, ErrorCode } from '../errors';

/**
 * 获取用户配置文件路径 (~/.ggcode/config.json)
 */
function getUserConfigPath(): string {
  return path.join(os.homedir(), '.ggcode', 'config.json');
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: AgentConfig = {
  api: {
    mode: (process.env.API_MODE as 'A4011LM01' | 'OpenApi') || 'A4011LM01',
    // 内网 API 配置 (A4011LM01 模式)
    base_url: process.env.INTERNAL_API_BASE || 'http://10.252.167.50:8021',
    access_key_id: process.env.ACCESS_KEY_ID || '1305842310935769088',
    tx_code: process.env.TX_CODE || 'A4011LM01',
    sec_node_no: process.env.SEC_NODE_NO || '400136',
    model: process.env.MODEL_ID || 'DeepSeek-V3-671B_20250725',
    // OpenAPI 配置 (OpenApi 模式)
    api_key: process.env.OPENAPI_KEY || '',
    timeout: 60000,
  },
  agent: {
    max_context_tokens: 64000,
    max_history: 20,
    max_iterations: 10,
    auto_approve: false,
    // 自动压缩配置
    auto_compress: true,
    compress_threshold: 0.7, // 70% 时触发压缩
    compress_reserve: 4000, // 保留 4000 tokens 给输出
  },
  sessions: {
    max_sessions: 20, // 最多保留20个会话
    max_inactive_days: 30, // 30天未活跃的会话将被清理
    auto_cleanup: true, // 启用自动清理
    cleanup_interval_hours: 24, // 每24小时检查一次
    preserve_recent_sessions: 5, // 最近5个会话不受时间限制
  },
};

/**
 * 配置管理类
 */
export class ConfigManager {
  private config: AgentConfig;

  constructor() {
    this.config = DEFAULT_CONFIG;
    this.loadEnv();
  }

  /**
   * 加载环境变量
   */
  private loadEnv(): void {
    const envPaths = ['.env', './config/.env'];
    for (const envPath of envPaths) {
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        break;
      }
    }
  }

  /**
   * 加载用户配置（从 ~/.ggcode/config.json）
   */
  private loadUserConfig(): void {
    const userConfigPath = getUserConfigPath();
    try {
      if (fsSync.existsSync(userConfigPath)) {
        const content = fsSync.readFileSync(userConfigPath, 'utf-8');
        const userConfig = JSON.parse(content) as Partial<AgentConfig>;

        // 完整合并用户配置
        this.config = this.mergeConfig(this.config, userConfig);
      }
    } catch (error) {
      // 用户配置文件读取失败，忽略错误，使用默认配置
      console.warn(`警告: 无法读取用户配置文件，使用默认配置: ${(error as Error).message}`);
    }
  }

  /**
   * 加载配置文件
   */
  async load(): Promise<void> {
    try {
      // 尝试加载用户配置文件（~/.ggcode/config.json）
      this.loadUserConfig();

      // 如果配置文件不存在，创建默认配置文件
      const userConfigPath = getUserConfigPath();
      if (!fsSync.existsSync(userConfigPath)) {
        await this.save();
        console.log(`已创建默认配置文件: ${userConfigPath}`);
      }
    } catch (error) {
      throw new ConfigurationError(
        `配置文件加载失败: ${(error as Error).message}`,
        ErrorCode.CONFIG_INVALID,
        { error }
      );
    }
  }

  /**
   * 保存配置文件（保存到 ~/.ggcode/config.json）
   */
  async save(config?: Partial<AgentConfig>): Promise<void> {
    const toSave = config ? this.mergeConfig(this.config, config) : this.config;

    try {
      const userConfigPath = getUserConfigPath();

      // 确保目录存在
      const dir = path.dirname(userConfigPath);
      await fs.ensureDir(dir);

      // 写入配置文件（JSON 格式）
      const content = JSON.stringify(toSave, null, 2);
      await fs.writeFile(userConfigPath, content, 'utf-8');

      // 更新当前配置
      this.config = toSave;
    } catch (error) {
      throw new ConfigurationError(
        `配置文件保存失败: ${(error as Error).message}`,
        ErrorCode.CONFIG_SCHEMA_ERROR,
        { config: toSave }
      );
    }
  }

  /**
   * 获取配置
   */
  get(): AgentConfig;
  get<K extends keyof AgentConfig>(key: K): AgentConfig[K];
  get<K extends keyof AgentConfig>(key?: K): AgentConfig | AgentConfig[K] {
    return key ? this.config[key] : this.config;
  }

  /**
   * 设置配置
   */
  set<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]): void {
    this.config[key] = value;
  }

  /**
   * 更新 API 配置中的单个字段
   */
  updateAPIConfig<K extends keyof AgentConfig['api']>(key: K, value: AgentConfig['api'][K]): void {
    this.config.api[key] = value;
  }

  /**
   * 获取API配置
   */
  getAPIConfig() {
    return this.config.api;
  }

  /**
   * 获取Agent配置
   */
  getAgentConfig() {
    return this.config.agent;
  }

  /**
   * 深度合并配置
   */
  private mergeConfig(base: AgentConfig, override: Partial<AgentConfig>): AgentConfig {
    return {
      api: { ...base.api, ...override.api },
      agent: { ...base.agent, ...override.agent },
    };
  }

  /**
   * 验证配置
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const apiMode = this.config.api.mode || 'A4011LM01';

    if (apiMode === 'OpenApi') {
      // OpenAPI 模式验证
      if (!this.config.api.base_url) {
        errors.push('API base_url 不能为空');
      }
      if (!this.config.api.api_key) {
        errors.push('OpenAPI 模式需要 api_key（请配置 api_key 或设置 OPENAPI_KEY 环境变量）');
      }
      if (!this.config.api.model) {
        errors.push('API model 不能为空');
      }
    } else {
      // A4011LM01 (内网模式) 验证
      if (!this.config.api.base_url) {
        errors.push('API base_url 不能为空');
      }
      if (!this.config.api.access_key_id) {
        errors.push('API access_key_id 不能为空');
      }
      if (!this.config.api.tx_code) {
        errors.push('API tx_code 不能为空');
      }
      if (!this.config.api.sec_node_no) {
        errors.push('API sec_node_no 不能为空');
      }
      if (!this.config.api.model) {
        errors.push('API model 不能为空');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * 单例配置实例
 */
let configInstance: ConfigManager | null = null;

/**
 * 获取配置实例
 */
export function getConfig(): ConfigManager {
  if (!configInstance) {
    configInstance = new ConfigManager();
  }
  return configInstance;
}

/**
 * 重置配置实例（用于测试）
 */
export function resetConfig(): void {
  configInstance = null;
}
