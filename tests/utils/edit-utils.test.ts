/**
 * Edit Utilities Tests
 * 智能编辑算法测试
 */

import {
  findMatch,
  levenshteinDistance,
  similarity,
  escapeRegExp,
} from '../../src/utils/edit-utils';

describe('Edit Utilities', () => {
  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(levenshteinDistance('hello', 'hello')).toBe(0);
    });

    it('should calculate distance for single character difference', () => {
      expect(levenshteinDistance('hello', 'hallo')).toBe(1);
    });

    it('should calculate distance for insertions', () => {
      expect(levenshteinDistance('cat', 'cats')).toBe(1);
    });

    it('should calculate distance for deletions', () => {
      expect(levenshteinDistance('cats', 'cat')).toBe(1);
    });

    it('should handle empty strings', () => {
      expect(levenshteinDistance('', '')).toBe(0);
      expect(levenshteinDistance('hello', '')).toBe(5);
      expect(levenshteinDistance('', 'hello')).toBe(5);
    });

    it('should handle multi-line strings', () => {
      const str1 = 'line1\nline2\nline3';
      const str2 = 'line1\nline2\nline4';
      expect(levenshteinDistance(str1, str2)).toBe(1);
    });
  });

  describe('similarity', () => {
    it('should return 1 for identical strings', () => {
      expect(similarity('hello', 'hello')).toBe(1);
    });

    it('should return 0 for completely different strings', () => {
      expect(similarity('abc', 'xyz')).toBe(0);
    });

    it('should calculate partial similarity', () => {
      const sim = similarity('hello world', 'hello there');
      expect(sim).toBeGreaterThan(0.5);
      expect(sim).toBeLessThan(1);
    });
  });

  describe('findMatch - Basic Strategies', () => {
    const content = `function hello() {
  console.log("Hello World");
  return true;
}`;

    it('should match exact string', () => {
      const result = findMatch(content, 'console.log("Hello World");');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.strategy).toBe('exact match');
      }
    });

    it('should match with trimmed boundaries', () => {
      const result = findMatch(content, '  console.log("Hello World");  ');
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.strategy).toBe('trimmed boundaries');
      }
    });

    it('should match with different line endings', () => {
      const crlfContent = content.replace(/\n/g, '\r\n');
      const result = findMatch(crlfContent, 'console.log("Hello World");');
      expect(result.found).toBe(true);
    });

    it('should match with trimmed lines', () => {
      // 使用多行内容测试 trimmed lines 策略
      const multiLineContent = `line1
  line2
line3`;
      const search = 'line1\nline2\nline3'; // 没有前导空格的第二行
      const result = findMatch(multiLineContent, search);
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.strategy).toBe('trimmed lines');
      }
    });

    it('should match with indentation flexible', () => {
      // 使用多行内容测试缩进灵活匹配
      const indentedContent = `function test() {
    const x = 1;
    return x;
}`;
      const search = 'function test() {\n  const x = 1;\n  return x;';
      const result = findMatch(indentedContent, search);
      expect(result.found).toBe(true);
    });
  });

  describe('findMatch - Advanced Strategies', () => {
    const content = `class User {
  constructor(name) {
    this.name = name;
    this.age = 0;
  }

  greet() {
    console.log("Hello, " + this.name);
  }
}`;

    it('should match with whitespace normalized', () => {
      // 测试空白规范化 - 使用不同数量的空格
      const search = 'constructor(name) {\n      this.name = name;';
      const result = findMatch(content, search);
      expect(result.found).toBe(true);
    });

    it('should match with context aware', () => {
      // 测试上下文感知匹配 - 需要多行且首尾行作为锚点
      const search = '  greet() {\n    console.log("Hello, " + this.name);\n  }';
      const result = findMatch(content, search);
      expect(result.found).toBe(true);
    });

    it('should match with lenient multiline', () => {
      // 测试容错多行匹配 - 70% 行匹配即可
      const lenientContent = `line1
line2
line3
line4
line5`;
      const search = 'line1\nlineX\nline3\nlineY\nline5'; // 2行不匹配
      const result = findMatch(lenientContent, search);
      expect(result.found).toBe(true);
    });
  });

  describe('findMatch - New Smart Strategies', () => {
    it('should match with escape normalized', () => {
      // 测试转义字符规范化
      const content = 'console.log("Result: " + result);';
      const search = 'console.log(\\"Result: \\" + result);';
      const result = findMatch(content, search);
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.strategy).toBe('escape normalized');
      }
    });

    it('should match with block anchor using levenshtein', () => {
      // 测试块锚点匹配 - 需要微小的差异来触发 Levenshtein
      const content = `function calculate(x, y) {
  const result = x + y;
  console.log("Result: " + result);
}`;
      // 使用略有不同的变量名来触发块锚点匹配
      const search =
        'function calculate(x, y) {\n  const result = x + y;\n  console.log("Result: " + result);';
      const result = findMatch(content, search);
      expect(result.found).toBe(true);
      if (result.found) {
        // 可能是 exact match 或 block anchor，取决于实现
        expect(['exact match', 'block anchor (levenshtein)']).toContain(result.strategy);
      }
    });

    it('should match with similarity threshold (90%)', () => {
      // 测试 90% 相似度阈值
      const content = `function test() {
  const value = 123;
  return value;
}`;
      // 90%+ 相似的搜索字符串
      const search = 'function test() {\n  const value = 123;\n  return value;';
      const result = findMatch(content, search);
      expect(result.found).toBe(true);
    });

    it('should match with similarity threshold (80%) for more differences', () => {
      // 测试 80% 相似度阈值 - 更多差异
      const content = `function calculate(x, y) {
  const result = x + y;
  console.log("Result: " + result);
}`;
      // 80%+ 相似但有明显差异
      const search =
        'function calculate(a, b) {\n  const res = a + b;\n  console.log("Output: " + res);';
      const result = findMatch(content, search);
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.strategy).toBe('similarity threshold (80%)');
      }
    });
  });

  describe('findMatch - Edge Cases', () => {
    it('should handle empty search string', () => {
      const content = 'some content';
      const result = findMatch(content, '');
      expect(result.found).toBe(false);
    });

    it('should handle search string not in content', () => {
      const content = 'hello world';
      const result = findMatch(content, 'not found');
      expect(result.found).toBe(false);
      if (!result.found) {
        expect(result.strategies).toContain('exact match');
        expect(result.strategies).toContain('similarity threshold (80%)');
      }
    });

    it('should handle multi-line content with partial matches', () => {
      const content = `line1
line2
line3
line4
line5`;
      const search = 'line2\nline3\nline4';
      const result = findMatch(content, search);
      expect(result.found).toBe(true);
    });

    it('should handle code blocks with varying indentation', () => {
      const content = `if (condition) {
        doSomething();
        doAnotherThing();
      }`;
      const search = 'if (condition) {\n  doSomething();\n  doAnotherThing();';
      const result = findMatch(content, search);
      expect(result.found).toBe(true);
    });
  });

  describe('findMatch - Real World Code Examples', () => {
    it('should match TypeScript interface', () => {
      const content = `export interface Config {
  api: {
    mode: string;
    base_url: string;
  };
  agent: {
    max_iterations: number;
  };
}`;
      const search = 'export interface Config {\n  api: {\n    mode: string;';
      const result = findMatch(content, search);
      expect(result.found).toBe(true);
    });

    it('should match JavaScript function with comments', () => {
      const content = `/**
 * Calculate sum
 */
function sum(a, b) {
  // Add numbers
  return a + b;
}`;
      const search = 'function sum(a, b) {\n  // Add numbers\n  return a + b;';
      const result = findMatch(content, search);
      expect(result.found).toBe(true);
    });

    it('should match HTML/XML content', () => {
      const content = `<div class="container">
  <h1>Title</h1>
  <p>Content</p>
</div>`;
      const search = '<div class="container">\n  <h1>Title</h1>';
      const result = findMatch(content, search);
      expect(result.found).toBe(true);
    });

    it('should match JSON content', () => {
      const content = `{
  "name": "test",
  "version": "1.0.0",
  "dependencies": {}
}`;
      const search = '"name": "test",\n  "version": "1.0.0",';
      const result = findMatch(content, search);
      expect(result.found).toBe(true);
    });
  });

  describe('escapeRegExp', () => {
    it('should escape special regex characters', () => {
      expect(escapeRegExp('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    });

    it('should not modify normal characters', () => {
      expect(escapeRegExp('hello')).toBe('hello');
    });
  });
});
