/**
 * 录制/回放 API 适配器
 * 在内网环境录制真实的 API 请求和响应
 * 在外网环境回放录制的交互，实现离线测试
 */

import type { Message, APIConfig } from '../types';
import { ChatAPIAdapter, APIError } from './adapter';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface RecordedInteraction {
  timestamp: number;
  request: {
    messages: Message[];
    options?: {
      userId?: string;
      temperature?: number;
      topP?: number;
      topK?: number;
      repetitionPenalty?: number;
    };
  };
  response: {
    output: string;
    duration: number; // 请求耗时（毫秒）
  };
  error?: {
    message: string;
    code?: string;
  };
}

export interface RecordingSession {
  name: string;
  description?: string;
  createdAt: number;
  interactions: RecordedInteraction[];
}

export class RecordingAPIAdapter extends ChatAPIAdapter {
  private recordingMode: 'live' | 'record' | 'playback';
  private currentSession: RecordingSession | null;
  private recordingDir: string;
  private playbackIndex: number;

  constructor(
    config: APIConfig,
    options: {
      mode?: 'live' | 'record' | 'playback';
      recordingDir?: string;
      sessionName?: string;
    } = {}
  ) {
    super(config);
    this.recordingMode = options.mode || 'live';
    this.recordingDir = options.recordingDir || path.join(process.cwd(), 'recordings');
    this.currentSession = null;
    this.playbackIndex = 0;

    if (options.sessionName) {
      this.loadSession(options.sessionName);
    }
  }

  /**
   * 开始新的录制会话
   */
  async startRecording(sessionName: string, description?: string): Promise<void> {
    this.recordingMode = 'record';
    this.currentSession = {
      name: sessionName,
      description,
      createdAt: Date.now(),
      interactions: [],
    };

    // 确保录制目录存在
    await fs.mkdir(this.recordingDir, { recursive: true });
  }

  /**
   * 停止录制并保存
   */
  async stopRecording(): Promise<void> {
    if (this.recordingMode !== 'record' || !this.currentSession) {
      throw new Error('当前没有正在进行的录制');
    }

    const filePath = path.join(this.recordingDir, `${this.currentSession.name}.json`);
    await fs.writeFile(filePath, JSON.stringify(this.currentSession, null, 2), 'utf-8');

    this.recordingMode = 'live';
    console.log(`\n✅ 录制已保存: ${filePath}`);
    console.log(`   共录制 ${this.currentSession.interactions.length} 次交互`);
  }

  /**
   * 加载录制会话用于回放
   */
  async loadSession(sessionName: string): Promise<void> {
    const filePath = path.join(this.recordingDir, `${sessionName}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.currentSession = JSON.parse(content);
      this.recordingMode = 'playback';
      this.playbackIndex = 0;
      console.log(`\n✅ 已加载录制会话: ${sessionName}`);
      console.log(`   共 ${this.currentSession!.interactions.length} 次交互`);
    } catch (error) {
      throw new Error(`无法加载录制会话 "${sessionName}": ${(error as Error).message}`);
    }
  }

  /**
   * 获取所有可用的录制会话
   */
  async listSessions(): Promise<string[]> {
    try {
      await fs.mkdir(this.recordingDir, { recursive: true });
      const files = await fs.readdir(this.recordingDir);
      return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  /**
   * 删除录制会话
   */
  async deleteSession(sessionName: string): Promise<void> {
    const filePath = path.join(this.recordingDir, `${sessionName}.json`);
    await fs.unlink(filePath);
  }

  /**
   * 覆盖 chat 方法以支持录制和回放
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
    if (this.recordingMode === 'record') {
      return this.chatWithRecording(messages, options);
    } else if (this.recordingMode === 'playback') {
      return this.chatWithPlayback(messages, options);
    } else {
      // live 模式直接调用原始方法
      return super.chat(messages, options);
    }
  }

  /**
   * 录制模式：调用真实 API 并记录交互
   */
  private async chatWithRecording(messages: Message[], options?: any): Promise<string> {
    const startTime = Date.now();

    try {
      const output = await super.chat(messages, options);
      const duration = Date.now() - startTime;

      // 记录成功的交互
      if (this.currentSession) {
        this.currentSession.interactions.push({
          timestamp: Date.now(),
          request: {
            messages,
            options: {
              userId: options?.userId,
              temperature: options?.temperature,
              topP: options?.topP,
              topK: options?.topK,
              repetitionPenalty: options?.repetitionPenalty,
            },
          },
          response: {
            output,
            duration,
          },
        });
      }

      return output;
    } catch (error) {
      // 记录失败的交互
      if (this.currentSession && error instanceof APIError) {
        this.currentSession.interactions.push({
          timestamp: Date.now(),
          request: { messages, options },
          error: {
            message: error.message,
            code: error.code,
          },
          response: {
            output: '',
            duration: Date.now() - startTime,
          },
        });
      }
      throw error;
    }
  }

  /**
   * 回放模式：返回录制的响应
   */
  private async chatWithPlayback(messages: Message[], options?: any): Promise<string> {
    if (!this.currentSession) {
      throw new Error('未加载录制会话');
    }

    if (this.playbackIndex >= this.currentSession.interactions.length) {
      throw new Error(
        `回放索引超出范围: ${this.playbackIndex} >= ${this.currentSession.interactions.length}`
      );
    }

    const interaction = this.currentSession.interactions[this.playbackIndex];
    this.playbackIndex++;

    // 模拟原始请求的耗时（可选，加速回放可以去掉）
    // await new Promise(resolve => setTimeout(resolve, Math.min(interaction.response.duration, 100)));

    // 如果有错误，抛出相同的错误
    if (interaction.error) {
      throw new APIError(interaction.error.message, interaction.error.code);
    }

    // 可以在这里验证输入是否匹配（可选）
    // this.validatePlaybackInput(messages, options, interaction.request);

    console.log(`\n[回放 ${this.playbackIndex}/${this.currentSession.interactions.length}]`);

    return interaction.response.output;
  }

  /**
   * 获取当前录制/回放状态
   */
  getStatus(): {
    mode: string;
    sessionName: string | null;
    interactionCount: number;
    currentIndex: number;
  } {
    return {
      mode: this.recordingMode,
      sessionName: this.currentSession?.name || null,
      interactionCount: this.currentSession?.interactions.length || 0,
      currentIndex: this.playbackIndex,
    };
  }

  /**
   * 导出录制会话为可读的 Markdown 文档
   */
  async exportToMarkdown(sessionName: string, outputPath?: string): Promise<void> {
    const filePath = outputPath || path.join(this.recordingDir, `${sessionName}.md`);

    // 加载会话（如果还没加载）
    if (!this.currentSession || this.currentSession.name !== sessionName) {
      await this.loadSession(sessionName);
    }

    const lines: string[] = [];
    lines.push(`# 录制会话: ${this.currentSession!.name}\n`);
    lines.push(`**创建时间**: ${new Date(this.currentSession!.createdAt).toLocaleString()}\n`);
    lines.push(`**交互次数**: ${this.currentSession!.interactions.length}\n`);

    if (this.currentSession!.description) {
      lines.push(`**描述**: ${this.currentSession!.description}\n`);
    }

    lines.push('---\n\n');

    this.currentSession!.interactions.forEach((interaction, index) => {
      lines.push(`## 交互 #${index + 1}\n`);
      lines.push(`**时间**: ${new Date(interaction.timestamp).toLocaleString()}\n`);

      if (interaction.error) {
        lines.push(`❌ **错误**: ${interaction.error.message} (code: ${interaction.error.code})\n`);
      } else {
        lines.push(`⏱️ **耗时**: ${interaction.response.duration}ms\n`);
      }

      lines.push('\n### 请求\n');
      lines.push('```json\n');
      lines.push(JSON.stringify(interaction.request.messages, null, 2));
      lines.push('\n```\n\n');

      if (!interaction.error) {
        lines.push('### 响应\n');
        lines.push('```text\n');
        lines.push(interaction.response.output);
        lines.push('\n```\n\n');
      }

      lines.push('---\n\n');
    });

    await fs.writeFile(filePath, lines.join(''), 'utf-8');
    console.log(`\n✅ 已导出 Markdown: ${filePath}`);
  }
}

/**
 * 创建录制/回放 API 适配器
 */
export function createRecordingAPIAdapter(
  config: APIConfig,
  options?: {
    mode?: 'live' | 'record' | 'playback';
    recordingDir?: string;
    sessionName?: string;
  }
): RecordingAPIAdapter {
  return new RecordingAPIAdapter(config, options);
}
