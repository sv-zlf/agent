/**
 * GG CODE - Bash Tool
 * 执行命令行工具
 */

import * as z from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { defineTool } from './tool';
import { truncateOutput } from '../utils/truncation';

const execAsync = promisify(exec);

export const BashTool = defineTool('bash', {
  description: '执行 shell 命令并返回输出。适用于运行构建、测试、git 操作等命令。',
  parameters: z.object({
    command: z.string().describe('要执行的 shell 命令'),
  }),
  async execute(args, ctx) {
    const { command } = args;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        timeout: 30000, // 30 秒超时
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });

      let output = stdout;
      if (stderr) {
        output += output ? '\n' + stderr : stderr;
      }

      // 使用智能截断
      const truncateResult = await truncateOutput(output || '(Command produced no output)', {
        maxLines: 500,
        maxBytes: 50 * 1024,
        direction: 'head',
      });

      return {
        title: `Command: ${command.substring(0, 50)}${command.length > 50 ? '...' : ''}`,
        output: truncateResult.content,
        metadata: {
          command,
          truncated: truncateResult.truncated,
          truncationFile: truncateResult.truncated ? (truncateResult as any).outputPath : undefined,
          exitCode: 0,
        },
      };
    } catch (error: any) {
      const output = error.stderr || error.stdout || error.message;
      const truncateResult = await truncateOutput(`Command failed: ${output}`, {
        maxLines: 100,
        maxBytes: 10 * 1024,
        direction: 'head',
      });

      return {
        title: `Command failed: ${command.substring(0, 50)}`,
        output: truncateResult.content,
        metadata: {
          command,
          exitCode: error.code || 1,
          error: true,
        },
      };
    }
  },
});
