/**
 * Mock API 适配器 - 用于外网开发环境测试
 * 支持从配置文件加载预设的响应，模拟真实 API 行为
 */

import type { Message, APIConfig } from '../types';
import { APIError } from './internal-adapter';

export interface MockResponse {
  input?: {
    messages: Message[];
    options?: any;
  };
  output: string;
  delay?: number; // 模拟网络延迟
  error?: {
    message: string;
    code?: string;
  };
}

export interface MockScenario {
  name: string;
  description: string;
  responses: MockResponse[];
  currentIndex?: number;
}

export class MockAPIAdapter {
  private scenarios: Map<string, MockScenario>;
  private currentScenario: string | null;

  constructor(_config: APIConfig) {
    this.scenarios = new Map();
    this.currentScenario = null;
  }

  /**
   * 加载测试场景
   */
  loadScenario(name: string, scenario: MockScenario): void {
    this.scenarios.set(name, {
      ...scenario,
      currentIndex: 0,
    });
  }

  /**
   * 从文件加载测试场景
   */
  async loadScenarioFromFile(name: string, filePath: string): Promise<void> {
    const fs = await import('fs/promises');
    const content = await fs.readFile(filePath, 'utf-8');
    const scenario: MockScenario = JSON.parse(content);
    this.loadScenario(name, scenario);
  }

  /**
   * 加载多个场景（从目录）
   */
  async loadScenariosFromDir(dirPath: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { readdirSync } = await import('fs');

    const files = readdirSync(dirPath).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const scenario: MockScenario = JSON.parse(content);
      const scenarioName = file.replace('.json', '');
      this.loadScenario(scenarioName, scenario);
    }
  }

  /**
   * 选择当前使用的场景
   */
  selectScenario(name: string): void {
    if (!this.scenarios.has(name)) {
      throw new Error(`场景 "${name}" 不存在`);
    }
    this.currentScenario = name;
    // 重置场景索引
    const scenario = this.scenarios.get(name)!;
    scenario.currentIndex = 0;
  }

  /**
   * 获取所有场景名称
   */
  getScenarioNames(): string[] {
    return Array.from(this.scenarios.keys());
  }

  /**
   * 模拟聊天请求
   */
  async chat(
    messages: Message[],
    options?: {
      userId?: string;
      temperature?: number;
      topP?: number;
      topK?: number;
      repetitionPenalty?: number;
      abortSignal?: AbortSignal;
    }
  ): Promise<string> {
    // 检查是否已中断
    if (options?.abortSignal?.aborted) {
      throw new APIError('请求已被用户中断', 'ABORTED');
    }

    if (!this.currentScenario) {
      throw new Error('未选择测试场景，请先调用 selectScenario()');
    }

    const scenario = this.scenarios.get(this.currentScenario)!;
    const index = scenario.currentIndex || 0;

    if (index >= scenario.responses.length) {
      // 如果响应用完了，循环使用最后一个
      const lastResponse = scenario.responses[scenario.responses.length - 1];
      return this.executeResponse(lastResponse, messages, options);
    }

    const response = scenario.responses[index];
    scenario.currentIndex = index + 1;

    return this.executeResponse(response, messages, options);
  }

  /**
   * 执行响应（支持延迟和错误）
   */
  private async executeResponse(
    response: MockResponse,
    _messages: Message[],
    _options?: any
  ): Promise<string> {
    // 模拟网络延迟
    if (response.delay) {
      await new Promise((resolve) => setTimeout(resolve, response.delay));
    }

    // 检查是否需要返回错误
    if (response.error) {
      throw new APIError(response.error.message, response.error.code);
    }

    // 可以在这里添加输入验证
    if (response.input) {
      // 验证输入是否符合预期（可选）
      // this.validateInput(messages, options, response.input);
    }

    return response.output;
  }

  /**
   * 重置当前场景
   */
  resetScenario(): void {
    if (this.currentScenario) {
      const scenario = this.scenarios.get(this.currentScenario)!;
      scenario.currentIndex = 0;
    }
  }

  /**
   * 获取当前场景信息
   */
  getCurrentScenarioInfo(): MockScenario | null {
    if (!this.currentScenario) {
      return null;
    }
    return this.scenarios.get(this.currentScenario) || null;
  }
}

/**
 * 创建 Mock API 适配器
 */
export function createMockAPIAdapter(config: APIConfig): MockAPIAdapter {
  return new MockAPIAdapter(config);
}
