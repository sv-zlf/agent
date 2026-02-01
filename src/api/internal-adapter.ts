/**
 * 内网聊天API适配器（A4011LM01 模式）
 * 适用场景：内网环境、双 JSON 序列化格式
 */

import axios, { AxiosError } from 'axios';
import type {
  Message,
  InternalAPIConfig,
  InternalAPIRequest,
  InternalAPIResponse,
  ParsedResult,
} from '../types';
import { APIError, ErrorCode } from '../errors';
import { withRetry, RETRY_CONFIG } from '../utils/retry';

/**
 * 内网API适配器
 */
export class InternalAPIAdapter {
  private config: InternalAPIConfig;

  constructor(config: InternalAPIConfig) {
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
      userId?: string;
      temperature?: number;
      topP?: number;
      topK?: number;
      repetitionPenalty?: number;
      abortSignal?: AbortSignal;
      stream?: boolean;
      onChunk?: (chunk: string) => void;
      onToken?: (token: string) => void;
    }
  ): Promise<string> {
    // 如果启用了流式响应
    if (options?.stream) {
      return this.chatStream(messages, options);
    }

    const traceId = this.generateTraceId();
    const serialNo = this.generateSerialNo();

    const innerRequest: InternalAPIRequest = {
      user_id: options?.userId,
      messages,
      stream: false,
      model_config: {
        model: this.config.model,
        repetition_penalty: options?.repetitionPenalty ?? 1.1,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.topP ?? 0.8,
        top_k: options?.topK ?? 20,
      },
    };

    const requestBody = {
      Data_cntnt: JSON.stringify(innerRequest),
      Fst_Attr_Rmrk: this.config.access_key_id,
    };

    if (options?.abortSignal?.aborted) {
      throw new APIError('请求已被用户中断', ErrorCode.API_ABORTED);
    }

    const chatFn = async (): Promise<string> => {
      const response = await axios.post<InternalAPIResponse>(
        `${this.config.base_url}/ai-service/ainlpllm/chat`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            Access_key_Id: this.config.access_key_id,
            'Tx-Code': this.config.tx_code,
            'Sec-Node-No': this.config.sec_node_no,
            'Trace-Id': traceId,
            'Serial-No': serialNo,
          },
          timeout: this.config.timeout || 30000,
          signal: options?.abortSignal,
        }
      );

      if (response.data['C-API-Status'] !== '00') {
        throw new APIError(
          `API错误: ${response.data['C-Response-Desc']}`,
          ErrorCode.API_AUTH_FAILED,
          undefined,
          { apiStatus: response.data['C-API-Status'] }
        );
      }

      const responseBody = response.data['C-Response-Body'];
      if (responseBody.codeid !== '20000') {
        throw new APIError(
          `业务错误: codeid=${responseBody.codeid}`,
          ErrorCode.API_AUTH_FAILED,
          undefined,
          { codeid: responseBody.codeid }
        );
      }

      const result: ParsedResult = JSON.parse(responseBody['Data_Enqr_Rslt']);

      if (!result?.choices?.[0]?.messages?.content) {
        throw new APIError('API 返回了空的响应内容', ErrorCode.API_EMPTY_RESPONSE);
      }

      const content = result.choices[0].messages.content;

      if (!content || content.trim().length === 0) {
        throw new APIError('AI 模型返回了空白内容', ErrorCode.API_BLANK_CONTENT);
      }

      return content;
    };

    try {
      const result = await withRetry(chatFn, {
        ...RETRY_CONFIG.API,
        abortSignal: options?.abortSignal,
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
        if (error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED') {
          throw new APIError('请求已被用户中断', ErrorCode.API_ABORTED);
        }
        if (error.response) {
          const status = error.response.status;
          const data = error.response.data as any;
          throw new APIError(
            `API调用失败: ${JSON.stringify(data)}`,
            ErrorCode.API_NETWORK_ERROR,
            status,
            { responseData: data }
          );
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
      throw new APIError(
        `API调用异常: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.UNKNOWN_ERROR
      );
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
      userId?: string;
      temperature?: number;
      topP?: number;
      topK?: number;
      repetitionPenalty?: number;
      abortSignal?: AbortSignal;
      onChunk?: (chunk: string) => void;
      onToken?: (token: string) => void;
    }
  ): Promise<string> {
    const traceId = this.generateTraceId();
    const serialNo = this.generateSerialNo();

    const innerRequest: InternalAPIRequest = {
      user_id: options?.userId,
      messages,
      stream: true,
      model_config: {
        model: this.config.model,
        repetition_penalty: options?.repetitionPenalty ?? 1.1,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.topP ?? 0.8,
        top_k: options?.topK ?? 20,
      },
    };

    const requestBody = {
      Data_cntnt: JSON.stringify(innerRequest),
      Fst_Attr_Rmrk: this.config.access_key_id,
    };

    if (options?.abortSignal?.aborted) {
      throw new APIError('请求已被用户中断', ErrorCode.API_ABORTED);
    }

    let fullContent = '';

    try {
      const response = await axios.post(
        `${this.config.base_url}/ai-service/ainlpllm/chat`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            Access_key_Id: this.config.access_key_id,
            'Tx-Code': this.config.tx_code,
            'Sec-Node-No': this.config.sec_node_no,
            'Trace-Id': traceId,
            'Serial-No': serialNo,
          },
          responseType: 'stream',
          timeout: this.config.timeout || 60000,
          signal: options?.abortSignal,
        }
      );

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
              if (options?.onToken) {
                options.onToken(content);
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
              if (options?.onToken) {
                options.onToken(content);
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
          throw new APIError(
            `API调用失败: ${JSON.stringify(data)}`,
            ErrorCode.API_NETWORK_ERROR,
            status,
            { responseData: data }
          );
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
   * 内网API使用双JSON序列化格式
   */
  private parseSSEChunk(line: string): string | null {
    if (!line || line.trim() === '' || line === '[DONE]') {
      return null;
    }

    try {
      // 尝试直接解析为 JSON
      const parsed = JSON.parse(line);
      if (parsed.choices && parsed.choices[0]?.delta?.content) {
        return parsed.choices[0].delta.content;
      }
      // 检查内网双 JSON 格式
      if (parsed['C-Response-Body']) {
        const responseBody = parsed['C-Response-Body'];
        if (responseBody.codeid === '20000' && responseBody['Data_Enqr_Rslt']) {
          const result = JSON.parse(responseBody['Data_Enqr_Rslt']);
          if (result?.choices?.[0]?.delta?.content) {
            return (result as any).choices[0].delta.content;
          }
        }
      }
    } catch (e) {
      // 忽略解析错误
    }

    return null;
  }

  /**
   * 生成追踪ID
   */
  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 生成序列号
   */
  private generateSerialNo(): string {
    return `${Date.now()}`;
  }
}

/**
 * 创建内网API适配器实例
 */
export function createInternalAPIAdapter(config: InternalAPIConfig): InternalAPIAdapter {
  return new InternalAPIAdapter(config);
}
