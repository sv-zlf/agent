/**
 * API 适配器统一导出
 * 根据配置自动选择合适的适配器（真实 API、Mock API、录制/回放）
 */

export { ChatAPIAdapter, APIError, createAPIAdapter } from './adapter';
export { MockAPIAdapter, createMockAPIAdapter } from './mock-api-adapter';
export {
  RecordingAPIAdapter,
  createRecordingAPIAdapter,
} from './recording-api-adapter';
export type { MockResponse, MockScenario } from './mock-api-adapter';
export type { RecordedInteraction, RecordingSession } from './recording-api-adapter';

import type { APIConfig } from '../types';
import { ChatAPIAdapter } from './adapter';
import { MockAPIAdapter } from './mock-api-adapter';
import { RecordingAPIAdapter } from './recording-api-adapter';

export type AdapterMode = 'live' | 'mock' | 'record' | 'playback';

export interface AdapterOptions {
  mode?: AdapterMode;
  mockScenariosDir?: string;
  recordingDir?: string;
  recordingSession?: string;
}

/**
 * 创建 API 适配器工厂
 * 根据模式自动选择合适的适配器
 */
export function createAPIAdapterFactory(config: APIConfig, options: AdapterOptions = {}) {
  const mode = options.mode || 'live';

  return {
    /**
     * 创建适配器实例
     */
    create(): ChatAPIAdapter | MockAPIAdapter | RecordingAPIAdapter {
      switch (mode) {
        case 'mock':
          const mockAdapter = new MockAPIAdapter(config);
          // 自动加载 Mock 场景
          if (options.mockScenariosDir) {
            mockAdapter.loadScenariosFromDir(options.mockScenariosDir);
          }
          return mockAdapter;

        case 'record':
        case 'playback':
        case 'live':
          return new RecordingAPIAdapter(config, {
            mode,
            recordingDir: options.recordingDir,
            sessionName: options.recordingSession,
          });

        default:
          return new ChatAPIAdapter(config);
      }
    },

    /**
     * 获取当前模式
     */
    getMode(): AdapterMode {
      return mode;
    },
  };
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
