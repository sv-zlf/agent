import * as yaml from 'js-yaml';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as fsSync from 'fs';
import dotenv from 'dotenv';
import type { AgentConfig } from '../types';

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
    base_url: process.env.INTERNAL_API_BASE || 'http://10.252.167.50:8021',
    access_key_id: process.env.ACCESS_KEY_ID || '1305842310935769088',
    tx_code: process.env.TX_CODE || 'A4011LM01',
    sec_node_no: process.env.SEC_NODE_NO || '400136',
    model: process.env.MODEL_ID || 'DeepSeek-V3-671B_20250725',
    timeout: 30000,
  },
  agent: {
    max_context_tokens: 8000,
    backup_before_edit: true,
    backup_dir: './backups',
    max_file_size: 1048576, // 1MB
    max_history: 10,
    max_iterations: 10,
    auto_approve: false,
  },
  prompts: {
    system: './prompts/system.txt',
    code_edit: './prompts/code-edit.txt',
    agent_mode: './prompts/agent.txt',
  },
};

/**
 * 配置管理类
 */
export class ConfigManager {
  private config: AgentConfig;
  private configPath: string;

  constructor(configPath: string = './config/config.yaml') {
    this.configPath = configPath;
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
        const userConfig = JSON.parse(content);

        // 优先使用用户配置中的模型
        if (userConfig.api && userConfig.api.model) {
          this.config.api.model = userConfig.api.model;
        }

        // 合并 model_config 参数（如果有的话）
        if (userConfig.model_config) {
          // 可以在这里处理其他模型参数
        }
      }
    } catch (error) {
      // 用户配置文件读取失败，忽略错误
      console.warn(`警告: 无法读取用户配置文件: ${(error as Error).message}`);
    }
  }

  /**
   * 加载配置文件
   */
  async load(): Promise<void> {
    try {
      // 首先加载项目配置文件（config/config.yaml）
      if (await fs.pathExists(this.configPath)) {
        const content = await fs.readFile(this.configPath, 'utf-8');
        const loaded = yaml.load(content) as Partial<AgentConfig>;

        // 合并配置（深层合并）
        this.config = this.mergeConfig(DEFAULT_CONFIG, loaded);
      }

      // 然后加载用户配置（优先级更高）
      this.loadUserConfig();
    } catch (error) {
      throw new Error(`配置文件加载失败: ${(error as Error).message}`);
    }
  }

  /**
   * 保存配置文件
   */
  async save(config?: Partial<AgentConfig>): Promise<void> {
    const toSave = config ? this.mergeConfig(this.config, config) : this.config;

    try {
      // 确保目录存在
      const dir = path.dirname(this.configPath);
      await fs.ensureDir(dir);

      // 写入配置文件
      const content = yaml.dump(toSave, { indent: 2 });
      await fs.writeFile(this.configPath, content, 'utf-8');

      // 更新当前配置
      this.config = this.mergeConfig(this.config, toSave);
    } catch (error) {
      throw new Error(`配置文件保存失败: ${(error as Error).message}`);
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
      prompts: { ...base.prompts, ...override.prompts },
    };
  }

  /**
   * 验证配置
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 验证API配置
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
export function getConfig(configPath?: string): ConfigManager {
  if (!configInstance) {
    configInstance = new ConfigManager(configPath);
  }
  return configInstance;
}

/**
 * 重置配置实例（用于测试）
 */
export function resetConfig(): void {
  configInstance = null;
}
