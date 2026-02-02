/**
 * 工具提示词加载器测试
 */

import {
  loadToolPrompt,
  loadToolPrompts,
  hasToolPrompt,
  getPromptModTime,
  clearPromptCache,
} from '../../src/utils/tool-prompt-loader';

describe('工具提示词加载器', () => {
  const TEST_TOOL_ID = 'read';
  const NONEXISTENT_TOOL_ID = 'nonexistent-tool';

  afterEach(() => {
    // 每个测试后清除缓存
    clearPromptCache();
  });

  describe('loadToolPrompt', () => {
    it('应该成功加载存在的工具提示词', async () => {
      const prompt = await loadToolPrompt(TEST_TOOL_ID);

      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('应该包含预期的内容', async () => {
      const prompt = await loadToolPrompt(TEST_TOOL_ID);

      expect(prompt).toContain('Reads a file');
      expect(prompt).toContain('Usage');
    });

    it('应该在文件不存在时返回空字符串', async () => {
      const prompt = await loadToolPrompt(NONEXISTENT_TOOL_ID);

      expect(prompt).toBe('');
    });

    it('应该缓存加载结果', async () => {
      const prompt1 = await loadToolPrompt(TEST_TOOL_ID);
      const prompt2 = await loadToolPrompt(TEST_TOOL_ID);

      expect(prompt1).toBe(prompt2);
      expect(prompt1).toBe(prompt2);
    });
  });

  describe('loadToolPrompts', () => {
    it('应该批量加载多个工具提示词', async () => {
      const toolIds = ['read', 'write', 'edit'];
      const prompts = await loadToolPrompts(toolIds);

      expect(prompts).toBeDefined();
      expect(Object.keys(prompts).length).toBe(3);
      expect(prompts.read).toBeDefined();
      expect(prompts.write).toBeDefined();
      expect(prompts.edit).toBeDefined();
    });

    it('应该为不存在的工具返回空字符串', async () => {
      const toolIds = ['read', NONEXISTENT_TOOL_ID];
      const prompts = await loadToolPrompts(toolIds);

      expect(prompts.read).toBeDefined();
      expect(prompts.read.length).toBeGreaterThan(0);
      expect(prompts[NONEXISTENT_TOOL_ID]).toBe('');
    });

    it('应该并行加载以提高性能', async () => {
      const toolIds = ['read', 'write', 'edit', 'glob', 'grep', 'bash'];
      const startTime = Date.now();

      await loadToolPrompts(toolIds);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // 并行加载应该很快（< 1秒）
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('hasToolPrompt', () => {
    it('应该对存在的提示词文件返回 true', async () => {
      const exists = await hasToolPrompt(TEST_TOOL_ID);

      expect(exists).toBe(true);
    });

    it('应该对不存在的提示词文件返回 false', async () => {
      const exists = await hasToolPrompt(NONEXISTENT_TOOL_ID);

      expect(exists).toBe(false);
    });
  });

  describe('getPromptModTime', () => {
    it('应该返回存在的文件的修改时间', async () => {
      const modTime = await getPromptModTime(TEST_TOOL_ID);

      expect(modTime).toBeDefined();
      expect(typeof modTime?.getTime).toBe('function');
      expect(modTime!.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('应该对不存在的文件返回 null', async () => {
      const modTime = await getPromptModTime(NONEXISTENT_TOOL_ID);

      expect(modTime).toBeNull();
    });
  });

  describe('clearPromptCache', () => {
    it('应该清除所有缓存的提示词', async () => {
      // 加载提示词以填充缓存
      await loadToolPrompt(TEST_TOOL_ID);

      // 清除缓存
      clearPromptCache();

      // 重新加载应该能成功
      const prompt = await loadToolPrompt(TEST_TOOL_ID);
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('提示词内容验证', () => {
    it('read 提示词应该包含所有必需部分', async () => {
      const prompt = await loadToolPrompt('read');

      expect(prompt).toContain('Usage');
      expect(prompt).toContain('Best Practices');
      expect(prompt).toContain('filePath');
    });

    it('write 提示词应该包含使用说明', async () => {
      const prompt = await loadToolPrompt('write');

      expect(prompt).toContain('Usage');
      expect(prompt).toContain('filePath');
      expect(prompt).toContain('content');
      expect(prompt).toContain('Creates a new file');
    });

    it('edit 提示词应该包含替换说明', async () => {
      const prompt = await loadToolPrompt('edit');

      expect(prompt).toContain('Usage');
      expect(prompt).toContain('oldString');
      expect(prompt).toContain('newString');
      expect(prompt).toContain('must match file content exactly');
    });

    it('glob 提示词应该包含模式示例', async () => {
      const prompt = await loadToolPrompt('glob');

      expect(prompt).toContain('Usage');
      expect(prompt).toContain('pattern');
      expect(prompt).toContain('Glob Pattern Examples');
    });

    it('grep 提示词应该包含正则表达式示例', async () => {
      const prompt = await loadToolPrompt('grep');

      expect(prompt).toContain('Usage');
      expect(prompt).toContain('pattern');
      expect(prompt).toContain('Regex Examples');
    });

    it('bash 提示词应该包含使用场景', async () => {
      const prompt = await loadToolPrompt('bash');

      expect(prompt).toContain('Usage');
      expect(prompt).toContain('Best Practices');
      expect(prompt).toContain('When NOT to use');
    });
  });
});
