import axios, { AxiosError } from 'axios';
import type {
  Message,
  APIConfig,
  InternalAPIRequest,
  InternalAPIResponse,
  ParsedResult,
} from '../types';

/**
 * API错误类
 */
export class APIError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'APIError';
  }
}

/**
 * 内网聊天API适配器
 */
export class ChatAPIAdapter {
  private config: APIConfig;

  constructor(config: APIConfig) {
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
      userId?: string;
      temperature?: number;
      topP?: number;
      topK?: number;
      repetitionPenalty?: number;
    }
  ): Promise<string> {
    const traceId = this.generateTraceId();
    const serialNo = this.generateSerialNo();

    // 构建内层请求体
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

    // 构建外层请求体（Data_cntnt需要JSON字符串化）
    const requestBody = {
      Data_cntnt: JSON.stringify(innerRequest),
      Fst_Attr_Rmrk: this.config.access_key_id,
    };

    try {
      const response = await axios.post<InternalAPIResponse>(
        `${this.config.base_url}/ai-service/ainlpllm/chat`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'Access_Key_Id': this.config.access_key_id,
            'Tx-Code': this.config.tx_code,
            'Sec-Node-No': this.config.sec_node_no,
            'Trace-Id': traceId,
            'Tx-Serial-No': serialNo,
          },
          timeout: this.config.timeout ?? 30000,
        }
      );

      // 检查API状态
      if (response.data['C-API-Status'] !== '00') {
        throw new APIError(
          `API错误: ${response.data['C-Response-Desc']}`,
          response.data['C-Response-Code']
        );
      }

      // 检查业务状态
      const responseBody = response.data['C-Response-Body'];
      if (responseBody.codeid !== '20000') {
        throw new APIError(`业务错误: codeid=${responseBody.codeid}`, responseBody.codeid);
      }

      // 解嵌套的JSON字符串
      const result: ParsedResult = JSON.parse(responseBody['Data_Enqr_Rslt']);

      // 返回AI回复内容
      return result.choices[0].messages.content;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<InternalAPIResponse>;
        if (axiosError.response) {
          // 服务器返回了错误响应
          throw new APIError(
            `API调用失败: ${axiosError.response.status} ${axiosError.response.statusText}`,
            undefined,
            axiosError.response.status
          );
        } else if (axiosError.request) {
          // 请求已发出但没有收到响应
          throw new APIError(`网络错误: 无法连接到API服务器 (${this.config.base_url})`);
        }
      }
      // 其他错误
      throw error;
    }
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
 * 创建API适配器实例
 */
export function createAPIAdapter(config: APIConfig): ChatAPIAdapter {
  return new ChatAPIAdapter(config);
}
