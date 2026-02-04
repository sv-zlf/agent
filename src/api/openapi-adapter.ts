/**
 * OpenAPI 适配器
 * 支持标准的 OpenAI API 格式
 * 适用场景：外网开发、通用 OpenAPI 兼容接口
 */

import axios, { AxiosError } from 'axios';
import type { Message, OpenAPIConfig, OpenAPIRequest, OpenAPIResponse } from '../types';
import { APIError, ErrorCode } from '../errors';
import { withRetry, RETRY_CONFIG } from '../utils/retry';

/**
 * OpenAPI 聊天适配器
 */
export class OpenAPIAdapter {
  private config: OpenAPIConfig;

  constructor(config: OpenAPIConfig) {
    this.config = config;
  }

  /**
   * 发送聊天请求（带自动重试）
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
      stream?: boolean;
      onChunk?: (chunk: string) => void;
      timeout?: number; // 支持动态超时
    }
  ): Promise<string> {
    if (options?.abortSignal?.aborted) {
      throw new APIError('请求已被用户中断', ErrorCode.API_ABORTED);
    }

    // 如果启用了流式响应
    if (options?.stream) {
      return this.chatStream(messages, options);
    }

    const chatFn = async (): Promise<string> => {
      const requestBody: OpenAPIRequest = {
        model: this.config.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.topP ?? 0.8,
        stream: options?.stream ?? false,
      };

      try {
        const response = await axios.post<OpenAPIResponse>(
          `${this.config.base_url}/chat/completions`,
          requestBody,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.api_key}`,
            },
            // 支持动态超时，如果未指定则使用配置的默认值
            timeout: options?.timeout ?? this.config.timeout ?? 30000,
            signal: options?.abortSignal,
          }
        );

        if (response.data.choices && response.data.choices.length > 0) {
          return response.data.choices[0].message.content;
        }

        throw new APIError('API 返回了空响应');
      } catch (axiosError) {
        if (axiosError instanceof AxiosError && axiosError.response) {
          const status = axiosError.response.status;
          const data = axiosError.response.data as any;

          if (status === 401) {
            throw new APIError(
              `认证失败: ${JSON.stringify(data)}`,
              ErrorCode.API_AUTH_FAILED,
              status,
              { responseData: data }
            );
          }
          if (status === 429) {
            throw new APIError(
              `请求频率超限: ${JSON.stringify(data)}`,
              ErrorCode.API_RATE_LIMIT,
              status,
              { responseData: data }
            );
          }
          if (status >= 500) {
            throw new APIError(
              `服务器错误: ${JSON.stringify(data)}`,
              ErrorCode.API_NETWORK_ERROR,
              status,
              { responseData: data }
            );
          }
          throw new APIError(
            `API 错误: ${JSON.stringify(data)}`,
            data.error?.code as ErrorCode,
            status,
            { responseData: data }
          );
        }
        throw axiosError;
      }
    };

    try {
      const result = await withRetry(chatFn, {
        ...RETRY_CONFIG.API,
        abortSignal: options?.abortSignal, // 传递 abortSignal
        retryOn: (error) => {
          if (error instanceof APIError) {
            const code = error.code;
            return (
              code === ErrorCode.API_NETWORK_ERROR ||
              code === ErrorCode.API_RATE_LIMIT ||
              code === ErrorCode.API_TIMEOUT
            );
          }
          if (error instanceof AxiosError) {
            return !error.response || error.response.status >= 500 || error.response.status === 429;
          }
          return true;
        },
      });
      return result.data;
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      if (error instanceof AxiosError) {
        if (
          error.code === 'ECONNABORTED' ||
          error.code === 'ERR_CANCELED' ||
          (error.name && error.name.includes('cancel')) ||
          (error.message && error.message.includes('cancel'))
        ) {
          throw new APIError('请求已被用户中断', ErrorCode.API_ABORTED);
        }
        if (error.request && !error.response) {
          throw new APIError(
            `网络错误: 无法连接到 API 服务器 (${this.config.base_url}): ${error.code || 'unknown'}`,
            ErrorCode.API_NETWORK_ERROR,
            undefined,
            { axiosCode: error.code }
          );
        }
      }
      throw error;
    }
  }

  /**
   * 流式聊天方法
   * @param messages 消息数组
   * @param options 额外选项
   * @returns AI回复内容
   */
  private async chatStream(
    messages: Message[],
    options: {
      temperature?: number;
      topP?: number;
      abortSignal?: AbortSignal;
      stream?: boolean;
      onChunk?: (chunk: string) => void;
    }
  ): Promise<string> {
    const requestBody: OpenAPIRequest = {
      model: this.config.model,
      messages,
      temperature: options?.temperature ?? 0.7,
      top_p: options?.topP ?? 0.8,
      stream: true,
    };

    if (options?.abortSignal?.aborted) {
      throw new APIError('请求已被用户中断', ErrorCode.API_ABORTED);
    }

    let fullContent = '';

    try {
      const response = await axios.post(`${this.config.base_url}/chat/completions`, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.api_key}`,
        },
        responseType: 'stream',
        timeout: this.config.timeout ?? 60000,
        signal: options?.abortSignal,
      });

      return new Promise<string>((resolve, reject) => {
        let buffer = '';

        response.data.on('data', (chunk: Buffer) => {
          if (options?.abortSignal?.aborted) {
            response.data.destroy();
            reject(new APIError('请求已被用户中断', ErrorCode.API_ABORTED));
            return;
          }

          buffer += chunk.toString();

          // 尝试解析 SSE 格式
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const content = this.parseSSEChunk(line);
            if (content) {
              fullContent += content;
              if (options?.onChunk) {
                options.onChunk(content);
              }
            }
          }
        });

        response.data.on('end', () => {
          // 处理剩余的 buffer
          if (buffer) {
            const content = this.parseSSEChunk(buffer);
            if (content) {
              fullContent += content;
              if (options?.onChunk) {
                options.onChunk(content);
              }
            }
          }

          if (!fullContent || fullContent.trim().length === 0) {
            reject(new APIError('AI 模型返回了空白内容', ErrorCode.API_BLANK_CONTENT));
          } else {
            resolve(fullContent);
          }
        });

        response.data.on('error', (error: Error) => {
          // 用户取消时不显示错误
          if (error.message.includes('canceled') || error.message.includes('abort')) {
            return;
          }
          reject(new APIError(`流式响应错误: ${error.message}`, ErrorCode.API_NETWORK_ERROR));
        });
      });
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      if (error instanceof AxiosError) {
        if (error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED') {
          throw new APIError('请求已被用户中断', ErrorCode.API_ABORTED);
        }
        if (error.response) {
          const status = error.response.status;
          const data = error.response.data as any;
          let dataStr: string;
          try {
            dataStr = JSON.stringify(data);
          } catch {
            dataStr = '[无法序列化的响应数据]';
          }
          throw new APIError(`API调用失败: ${dataStr}`, ErrorCode.API_NETWORK_ERROR, status, {
            responseData: data,
          });
        }
        if (error.request) {
          throw new APIError(
            `网络错误: 无法连接到API服务器 (${this.config.base_url}): ${error.code || 'unknown'}`,
            ErrorCode.API_NETWORK_ERROR,
            undefined,
            { axiosCode: error.code }
          );
        }
      }
      throw error;
    }
  }

  /**
   * 解析 SSE 格式的数据块
   * OpenAPI 使用标准的 SSE 格式: data: {...}
   */
  private parseSSEChunk(line: string): string | null {
    if (!line || line.trim() === '' || line === '[DONE]') {
      return null;
    }

    // SSE 格式: data: {...}
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        return null;
      }

      try {
        const parsed = JSON.parse(data);
        if (parsed.choices && parsed.choices[0]?.delta?.content) {
          return parsed.choices[0].delta.content;
        }
      } catch (e) {
        // 忽略解析错误
      }
    }

    return null;
  }
}

/**
 * 创建 OpenAPI 适配器实例
 */
export function createOpenAPIAdapter(config: OpenAPIConfig): OpenAPIAdapter {
  return new OpenAPIAdapter(config);
}
