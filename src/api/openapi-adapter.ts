/**
 * OpenAPI 适配器
 * 支持标准的 OpenAI API 格式
 * 适用场景：外网开发、通用 OpenAPI 兼容接口
 */

import axios, { AxiosError } from 'axios';
import type { Message, OpenAPIConfig, OpenAPIRequest, OpenAPIResponse } from '../types';
import { APIError } from './internal-adapter';

/**
 * OpenAPI 聊天适配器
 */
export class OpenAPIAdapter {
  private config: OpenAPIConfig;

  constructor(config: OpenAPIConfig) {
    this.config = config;
  }

  /**
   * 发送聊天请求
   * @param messages 消息数组
   * @param options 额外选项
   * @returns AI回复内容
   */
  async chat(
    messages: Message[],
    options?: {
      temperature?: number;
      topP?: number;
      abortSignal?: AbortSignal;
    }
  ): Promise<string> {
    // 检查是否已中断
    if (options?.abortSignal?.aborted) {
      throw new APIError('请求已被用户中断', 'ABORTED');
    }

    try {
      // 构建 OpenAPI 请求体
      const requestBody: OpenAPIRequest = {
        model: this.config.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.topP ?? 0.8,
        stream: false,
      };

      // 发送请求
      const response = await axios.post<OpenAPIResponse>(
        `${this.config.base_url}/chat/completions`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.api_key}`,
          },
          timeout: this.config.timeout ?? 30000,
          signal: options?.abortSignal,
        }
      );

      // 提取响应内容
      if (response.data.choices && response.data.choices.length > 0) {
        return response.data.choices[0].message.content;
      }

      throw new APIError('API 返回了空响应');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        // 检查是否是中断错误
        if (
          axiosError.code === 'ECONNABORTED' ||
          axiosError.code === 'ERR_CANCELED' ||
          (axiosError.name && axiosError.name.includes('cancel')) ||
          (axiosError.message && axiosError.message.includes('cancel')) ||
          options?.abortSignal?.aborted
        ) {
          throw new APIError('请求已被用户中断', 'ABORTED');
        }

        if (axiosError.response) {
          // 服务器返回了错误响应
          const status = axiosError.response.status;
          const data = axiosError.response.data as any;

          throw new APIError(
            `API 错误: ${status} ${data.error?.message || axiosError.response.statusText}`,
            data.error?.code,
            status
          );
        } else if (axiosError.request) {
          // 请求已发出但没有收到响应
          throw new APIError(`网络错误: 无法连接到 API 服务器 (${this.config.base_url})`);
        }
      }

      // 其他错误
      throw error;
    }
  }
}

/**
 * 创建 OpenAPI 适配器实例
 */
export function createOpenAPIAdapter(config: OpenAPIConfig): OpenAPIAdapter {
  return new OpenAPIAdapter(config);
}
