/**
 * 工具调用验证测试
 * 不依赖真实 API，直接验证工具调用的准确性和参数验证
 */

import { createToolEngine } from '../src/core/tool-engine';
import { getBuiltinTools } from '../src/tools';
import * as path from 'path';
import * as fs from 'fs/promises';

const TEST_DIR = path.join(process.cwd(), 'tests', 'temp');

interface ToolCallTest {
  toolName: string;
  parameters: any;
  shouldSucceed: boolean;
  description: string;
  expectedOutput?: string;
  expectedError?: string;
}

describe('工具调用准确性验证', () => {
  let toolEngine: ReturnType<typeof createToolEngine>;

  beforeAll(async () => {
    // 创建测试目录和文件
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.writeFile(path.join(TEST_DIR, 'test.txt'), 'Hello, World!', 'utf-8');
    await fs.writeFile(
      path.join(TEST_DIR, 'test.json'),
      JSON.stringify({ name: 'test', value: 42 }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(TEST_DIR, 'code.ts'),
      `const x = 1;
const y = 2;
console.log(x + y);`,
      'utf-8'
    );
  });

  beforeEach(async () => {
    toolEngine = createToolEngine();
    const tools = await getBuiltinTools();
    toolEngine.registerTools(tools);
  });

  describe('文件操作工具', () => {
    const tests: ToolCallTest[] = [
      {
        toolName: 'Read',
        parameters: { filePath: path.join(TEST_DIR, 'test.txt') },
        shouldSucceed: true,
        description: '读取存在的文本文件',
        expectedOutput: 'Hello, World!',
      },
      {
        toolName: 'Read',
        parameters: { filePath: path.join(TEST_DIR, 'nonexistent.txt') },
        shouldSucceed: false,
        description: '读取不存在的文件',
        expectedError: '找不到文件',
      },
      {
        toolName: 'Write',
        parameters: { filePath: path.join(TEST_DIR, 'new.txt'), content: 'New content' },
        shouldSucceed: true,
        description: '写入新文件',
      },
      {
        toolName: 'Edit',
        parameters: {
          filePath: path.join(TEST_DIR, 'test.txt'),
          oldString: 'Hello',
          newString: 'Hi',
        },
        shouldSucceed: true,
        description: '编辑文件内容',
      },
      {
        toolName: 'Edit',
        parameters: {
          filePath: path.join(TEST_DIR, 'test.txt'),
          oldString: 'NotExists',
          newString: 'NewValue',
        },
        shouldSucceed: false,
        description: '编辑不存在的字符串',
        expectedError: '未找到',
      },
    ];

    tests.forEach(test => {
      it(test.description, async () => {
        const result = await toolEngine.executeToolCall({
          tool: test.toolName,
          parameters: test.parameters,
        });

        if (test.shouldSucceed) {
          expect(result.success).toBe(true);
          expect(result.error).toBeUndefined();

          if (test.expectedOutput) {
            expect(result.output).toContain(test.expectedOutput);
          }
        } else {
          if (test.expectedError) {
            expect(result.error).toContain(test.expectedError);
          } else {
            expect(result.success).toBe(false);
          }
        }
      });
    });
  });

  describe('搜索工具', () => {
    const tests: ToolCallTest[] = [
      {
        toolName: 'Glob',
        parameters: { pattern: '*.txt', path: TEST_DIR },
        shouldSucceed: true,
        description: '搜索 txt 文件',
      },
      {
        toolName: 'Grep',
        parameters: { pattern: 'const', path: TEST_DIR, type: 'ts' },
        shouldSucceed: true,
        description: '搜索代码中的关键字',
      },
      {
        toolName: 'Grep',
        parameters: { pattern: 'const', path: TEST_DIR, outputMode: 'count' },
        shouldSucceed: true,
        description: '统计关键字出现次数',
      },
    ];

    tests.forEach(test => {
      it(test.description, async () => {
        const result = await toolEngine.executeToolCall({
          tool: test.toolName,
          parameters: test.parameters,
        });

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
        expect(result.output).toBeDefined();
      });
    });
  });

  describe('参数验证', () => {
    it('应该拒绝缺少必需参数的 Read 调用', async () => {
      const result = await toolEngine.executeToolCall({
        tool: 'Read',
        parameters: {} as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('filePath');
    });

    it('应该拒绝缺少必需参数的 Write 调用', async () => {
      const result = await toolEngine.executeToolCall({
        tool: 'Write',
        parameters: { filePath: 'test.txt' } as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('content');
    });

    it('应该拒绝无效的 Edit 调用（oldString 为空）', async () => {
      const result = await toolEngine.executeToolCall({
        tool: 'Edit',
        parameters: {
          filePath: path.join(TEST_DIR, 'test.txt'),
          oldString: '',
          newString: 'test',
        },
      });

      expect(result.success).toBe(false);
    });
  });

  describe('边界情况', () => {
    it('应该处理空文件读取', async () => {
      const emptyFile = path.join(TEST_DIR, 'empty.txt');
      await fs.writeFile(emptyFile, '', 'utf-8');

      const result = await toolEngine.executeToolCall({
        tool: 'Read',
        parameters: { filePath: emptyFile },
      });

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });

    it('应该处理特殊字符路径', async () => {
      const specialFile = path.join(TEST_DIR, 'file with spaces.txt');
      await fs.writeFile(specialFile, 'content', 'utf-8');

      const result = await toolEngine.executeToolCall({
        tool: 'Read',
        parameters: { filePath: specialFile },
      });

      expect(result.success).toBe(true);
    });

    it('应该处理大文件', async () => {
      const largeContent = 'x'.repeat(10000);
      const largeFile = path.join(TEST_DIR, 'large.txt');
      await fs.writeFile(largeFile, largeContent, 'utf-8');

      const result = await toolEngine.executeToolCall({
        tool: 'Read',
        parameters: { filePath: largeFile },
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain(largeContent.substring(0, 100));
    });
  });

  describe('工具权限验证', () => {
    it('应该正确标记 safe 权限工具', async () => {
      const tools = await getBuiltinTools();
      const readTool = tools.find(t => t.name === 'Read');
      expect(readTool?.permission).toBe('safe');
    });

    it('应该正确标记 local-modify 权限工具', async () => {
      const tools = await getBuiltinTools();
      const writeTool = tools.find(t => t.name === 'Write');
      expect(writeTool?.permission).toBe('local-modify');
    });

    it('应该正确标记 dangerous 权限工具', async () => {
      const tools = await getBuiltinTools();
      const bashTool = tools.find(t => t.name === 'Bash');
      expect(bashTool?.permission).toBe('dangerous');
    });
  });
});
