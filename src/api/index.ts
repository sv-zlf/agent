/**
 * API 适配器统一导出
 * 支持多种模式：内网 API（A4011LM01）、OpenAPI、Mock API、录制/回放
 */

// 导入类型
import type { APIConfig, APIMode, InternalAPIConfig, OpenAPIConfig } from '../types';

// 导入适配器类
import { InternalAPIAdapter } from './internal-adapter';
import { OpenAPIAdapter } from './openapi-adapter';
import { MockAPIAdapter } from './mock-api-adapter';
import { RecordingAPIAdapter } from './recording-api-adapter';

// 导出所有适配器
export { InternalAPIAdapter, createInternalAPIAdapter } from './internal-adapter';
export { APIError } from '../errors';
export { OpenAPIAdapter, createOpenAPIAdapter } from './openapi-adapter';
export { MockAPIAdapter, createMockAPIAdapter } from './mock-api-adapter';
export { RecordingAPIAdapter, createRecordingAPIAdapter } from './recording-api-adapter';

// 导出类型
export type { MockResponse, MockScenario } from './mock-api-adapter';
export type { RecordedInteraction, RecordingSession } from './recording-api-adapter';

/**
 * 适配器运行模式
 */
export type AdapterMode = 'live' | 'mock' | 'record' | 'playback';

/**
 * 适配器选项
 */
export interface AdapterOptions {
  mode?: AdapterMode;
  mockScenariosDir?: string;
  recordingDir?: string;
  recordingSession?: string;
}

/**
 * 统一适配器接口
 * 所有适配器都必须实现 chat 方法
 */
export interface IAPIAdapter {
  chat(
    messages: any[],
    options?: {
      userId?: string;
      temperature?: number;
      topP?: number;
      topK?: number;
      repetitionPenalty?: number;
      abortSignal?: AbortSignal;
      stream?: boolean;
      onChunk?: (chunk: string) => void;
    }
  ): Promise<string>;
}

/**
 * API 适配器工厂
 * 根据配置自动选择合适的适配器
 */
export class APIAdapterFactory {
  private config: APIConfig;
  private options: AdapterOptions;

  constructor(config: APIConfig, options: AdapterOptions = {}) {
    this.config = config;
    this.options = options;
  }

  /**
   * 创建适配器实例
   */
  create(): IAPIAdapter {
    const mode = this.options.mode || 'live';
    const apiMode = this.config.mode || 'A4011LM01';

    switch (mode) {
      case 'mock':
        const mockAdapter = new MockAPIAdapter(this.config);
        if (this.options.mockScenariosDir) {
          mockAdapter.loadScenariosFromDir(this.options.mockScenariosDir);
        }
        return mockAdapter;

      case 'record':
      case 'playback':
        return new RecordingAPIAdapter(this.config, {
          mode,
          recordingDir: this.options.recordingDir,
          sessionName: this.options.recordingSession,
        });

      case 'live':
        // 根据 API 模式选择适配器
        if (apiMode === 'OpenApi') {
          return new OpenAPIAdapter(this.config as unknown as OpenAPIConfig);
        } else {
          // A4011LM01 (内网模式)
          return new InternalAPIAdapter(this.config as unknown as InternalAPIConfig);
        }

      default:
        // 默认使用内网 API
        return new InternalAPIAdapter(this.config as unknown as InternalAPIConfig);
    }
  }

  /**
   * 获取当前适配器模式
   */
  getMode(): AdapterMode {
    return this.options.mode || 'live';
  }

  /**
   * 获取当前 API 模式
   */
  getAPIMode(): APIMode {
    return this.config.mode || 'A4011LM01';
  }
}

/**
 * 快捷方法：创建 API 适配器工厂
 */
export function createAPIAdapterFactory(
  config: APIConfig,
  options: AdapterOptions = {}
): APIAdapterFactory {
  return new APIAdapterFactory(config, options);
}

/**
 * 快捷方法：创建内网 API 适配器
 */
export function createInternalAdapter(config: InternalAPIConfig): InternalAPIAdapter {
  return new InternalAPIAdapter(config);
}

/**
 * 快捷方法：创建 OpenAPI 适配器
 */
export function createOpenAdapter(config: OpenAPIConfig): OpenAPIAdapter {
  return new OpenAPIAdapter(config);
}

/**
 * 快捷方法：创建 Mock 适配器
 */
export function createMockAdapter(config: APIConfig, scenariosDir?: string): MockAPIAdapter {
  const adapter = new MockAPIAdapter(config);
  if (scenariosDir) {
    adapter.loadScenariosFromDir(scenariosDir);
  }
  return adapter;
}

/**
 * 快捷方法：创建录制/回放适配器
 */
export function createRecordingAdapter(
  config: APIConfig,
  mode: 'live' | 'record' | 'playback' = 'live',
  sessionName?: string
): RecordingAPIAdapter {
  return new RecordingAPIAdapter(config, {
    mode,
    sessionName,
  });
}
