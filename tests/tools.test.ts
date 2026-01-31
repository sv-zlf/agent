/**
 * 工具系统测试套件
 * 测试工具注册、描述加载、执行等功能
 */

import { createToolEngine } from '../src/core/tool-engine';
import { getBuiltinTools, generateToolsDescription } from '../src/tools';
import { clearPromptCache } from '../src/utils/tool-prompt-loader';
import * as fs from 'fs/promises';
import * as path from 'path';

const TEST_DIR = path.join(process.cwd(), 'tests', 'temp');

describe('工具系统测试', () => {
  let toolEngine: ReturnType<typeof createToolEngine>;

  beforeAll(async () => {
    // 清除缓存，确保测试使用最新数据
    clearPromptCache();

    // 创建测试目录
    await fs.mkdir(TEST_DIR, { recursive: true });

    // 创建测试文件
    await fs.writeFile(path.join(TEST_DIR, 'test.txt'), 'Hello, World!', 'utf-8');
    await fs.writeFile(path.join(TEST_DIR, 'test.json'), JSON.stringify({ key: 'value' }), 'utf-8');
  });

  beforeEach(() => {
    toolEngine = createToolEngine();
  });

  describe('工具注册', () => {
    it('应该注册所有内置工具', async () => {
      const tools = await getBuiltinTools();

      expect(tools.length).toBeGreaterThan(0);
      expect(tools).toBeDefined();

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('Read');
      expect(toolNames).toContain('Write');
      expect(toolNames).toContain('Edit');
      expect(toolNames).toContain('Glob');
      expect(toolNames).toContain('Grep');
      expect(toolNames).toContain('Bash');
    });

    it('应该正确设置工具权限', async () => {
      const tools = await getBuiltinTools();

      const readTool = tools.find(t => t.name === 'Read');
      expect(readTool?.permission).toBe('safe');

      const writeTool = tools.find(t => t.name === 'Write');
      expect(writeTool?.permission).toBe('local-modify');

      const bashTool = tools.find(t => t.name === 'Bash');
      expect(bashTool?.permission).toBe('dangerous');
    });

    it('应该正确设置工具分类', async () => {
      const tools = await getBuiltinTools();

      const readTool = tools.find(t => t.name === 'Read');
      expect(readTool?.category).toBe('file');

      const globTool = tools.find(t => t.name === 'Glob');
      expect(globTool?.category).toBe('search');

      const bashTool = tools.find(t => t.name === 'Bash');
      expect(bashTool?.category).toBe('command');
    });
  });

  describe('工具引擎', () => {
    it('应该成功注册工具到引擎', async () => {
      const tools = await getBuiltinTools();

      expect(() => {
        toolEngine.registerTools(tools);
      }).not.toThrow();

      expect(toolEngine.size()).toBe(tools.length);
    });

    it('应该能够查询已注册的工具', async () => {
      const tools = await getBuiltinTools();
      toolEngine.registerTools(tools);

      const readTool = toolEngine.getTool('Read');
      expect(readTool).toBeDefined();
      expect(readTool?.name).toBe('Read');
    });

    it('应该能够按类别获取工具', async () => {
      const tools = await getBuiltinTools();
      toolEngine.registerTools(tools);

      const fileTools = toolEngine.getToolsByCategory('file');
      expect(fileTools.length).toBeGreaterThan(0);

      const fileToolNames = fileTools.map(t => t.name);
      expect(fileToolNames).toContain('Read');
      expect(fileToolNames).toContain('Write');
    });
  });

  describe('工具描述生成', () => {
    it('应该生成非空的工具描述', async () => {
      const description = await generateToolsDescription();

      expect(description).toBeDefined();
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(0);
    });

    it('应该包含所有工具的描述', async () => {
      const description = await generateToolsDescription();

      expect(description).toContain('read');
      expect(description).toContain('write');
      expect(description).toContain('edit');
      expect(description).toContain('glob');
    });

    it('应该从外部文件加载详细描述', async () => {
      const tools = await getBuiltinTools();
      const readTool = tools.find(t => t.name === 'Read');

      expect(readTool?.description).toBeDefined();
      // 详细描述应该包含 Usage 部分
      expect(readTool!.description).toMatch(/Usage|参数|Parameters/i);
    });
  });

  describe('工具执行', () => {
    beforeEach(async () => {
      const tools = await getBuiltinTools();
      toolEngine.registerTools(tools);
    });

    it('应该成功执行 Glob 工具', async () => {
      const result = await toolEngine.executeToolCall({
        tool: 'Glob',
        parameters: {
          pattern: '*.txt',
          path: TEST_DIR
        }
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('test.txt');
    });

    it('应该成功执行 Read 工具', async () => {
      const testFile = path.join(TEST_DIR, 'test.txt');

      const result = await toolEngine.executeToolCall({
        tool: 'Read',
        parameters: {
          filePath: testFile
        }
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello, World!');
    });

    it('应该正确处理工具执行错误', async () => {
      const result = await toolEngine.executeToolCall({
        tool: 'Read',
        parameters: {
          filePath: '/nonexistent/file.txt'
        }
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('应该验证必需参数', async () => {
      const result = await toolEngine.executeToolCall({
        tool: 'Read',
        parameters: {} // 缺少必需的 filePath 参数
      } as any);

      expect(result.success).toBe(false);
    });
  });

  describe('提示词加载器', () => {
    it('应该正确加载工具提示词文件', async () => {
      const { loadToolPrompt } = await import('../src/utils/tool-prompt-loader');

      const readPrompt = await loadToolPrompt('read');
      expect(readPrompt).toBeDefined();
      expect(readPrompt.length).toBeGreaterThan(0);
      expect(readPrompt).toContain('Reads a file');
    });

    it('应该缓存已加载的提示词', async () => {
      const { loadToolPrompt } = await import('../src/utils/tool-prompt-loader');

      const prompt1 = await loadToolPrompt('read');
      const prompt2 = await loadToolPrompt('read');

      expect(prompt1).toBe(prompt2);
    });

    it('应该在文件不存在时返回空字符串', async () => {
      const { loadToolPrompt } = await import('../src/utils/tool-prompt-loader');

      const prompt = await loadToolPrompt('nonexistent-tool');
      expect(prompt).toBe('');
    });
  });

  describe('参数验证', () => {
    beforeEach(async () => {
      const tools = await getBuiltinTools();
      toolEngine.registerTools(tools);
    });

    it('应该拒绝无效的工具名称', async () => {
      const result = await toolEngine.executeToolCall({
        tool: 'NonExistentTool',
        parameters: {}
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });

    it('应该接受有效的工具调用', async () => {
      const result = await toolEngine.executeToolCall({
        tool: 'Glob',
        parameters: {
          pattern: '*',
          path: TEST_DIR
        }
      });

      expect(result.success).toBe(true);
    });
  });

  describe('输出截断', () => {
    beforeEach(async () => {
      const tools = await getBuiltinTools();
      toolEngine.registerTools(tools);
    });

    it('应该截断过长的输出', async () => {
      // 创建一个大文件
      const largeContent = 'Line\n'.repeat(5000);
      const largeFile = path.join(TEST_DIR, 'large.txt');
      await fs.writeFile(largeFile, largeContent, 'utf-8');

      const result = await toolEngine.executeToolCall({
        tool: 'Read',
        parameters: {
          filePath: largeFile
        }
      });

      expect(result.success).toBe(true);
      // 应该被截断
      expect(result.metadata?.truncated).toBe(true);
    });
  });

  afterAll(async () => {
    // 清理测试文件
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });
});
