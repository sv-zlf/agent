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

const DANGEROUS_PATTERNS = [
  /\brsync\s+.*--delete/i,
  /\brm\s+-rf\b/i,
  /\bdd\b/i,
  /\bmkfs\b/i,
  /\bformat\b/i,
  /\bchmod\s+777\b/i,
  /\bchmod\s+-r\s+777\b/i,
  /\buseradd\b.*\bsudo\b/i,
  /\bpasswd\b.*\b--stdin\b/i,
  /\becho\b.*\|\s*sudo\b/i,
  /\bcurl\b.*\|\s*sh\b/i,
  /\bwget\b.*\|\s*sh\b/i,
  /\$\(.*\)\s*\|\s*sh/i,
];

const SENSITIVE_ENV = [
  'API_KEY',
  'API_SECRET',
  'ACCESS_KEY',
  'SECRET_KEY',
  'TOKEN',
  'PASSWORD',
  'CREDENTIAL',
  'PRIVATE_KEY',
  'AUTH',
];

function isDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { dangerous: true, reason: '检测到危险命令模式' };
    }
  }
  return { dangerous: false };
}

function sanitizeEnvironment(): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    const isSensitive = SENSITIVE_ENV.some((s) => key.toUpperCase().includes(s));
    sanitized[key] = isSensitive ? '***REDACTED***' : value || '';
  }
  return sanitized;
}

export const BashTool = defineTool('bash', {
  description: '执行 shell 命令并返回输出。适用于运行构建、测试、git 操作等命令。',
  parameters: z.object({
    command: z.string().describe('要执行的 shell 命令'),
  }),
  async execute(args, _ctx) {
    const { command } = args;

    const dangerCheck = isDangerousCommand(command);
    if (dangerCheck.dangerous) {
      return {
        title: 'Command Blocked',
        output: `命令被阻止: ${dangerCheck.reason}\n\n出于安全考虑，此命令无法执行。`,
        metadata: {
          command,
          blocked: true,
          reason: dangerCheck.reason,
          error: true,
        },
      };
    }

    try {
      const sanitizedEnv = sanitizeEnvironment();
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 10,
        env: { ...sanitizedEnv, PATH: process.env.PATH },
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
        silent: true, // 静默模式
      });

      const finalOutput = truncateResult.content;

      return {
        title: `Command: ${command.substring(0, 50)}${command.length > 50 ? '...' : ''}`,
        output: finalOutput,
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
        silent: true, // 静默模式
      });

      return {
        success: false,
        error: `Command failed with exit code ${error.code || 1}`,
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
