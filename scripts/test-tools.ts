/**
 * 工具系统快速测试脚本
 * 用于开发时快速验证工具系统功能
 */

import { createToolEngine } from '../src/core/tool-engine';
import { getBuiltinTools, generateToolsDescription } from '../src/tools';
import { clearPromptCache, hasToolPrompt } from '../src/utils/tool-prompt-loader';
import * as fs from 'fs/promises';
import * as path from 'path';

const TEST_DIR = path.join(process.cwd(), 'tests', 'temp');

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration?: number;
}

class ToolSystemTester {
  private results: TestResult[] = [];

  constructor(private toolEngine = createToolEngine()) {}

  async setup(): Promise<void> {
    console.log('🔧 设置测试环境...\n');
    clearPromptCache();
    await this.toolEngine.initialize();

    // 创建测试目录和文件
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.writeFile(path.join(TEST_DIR, 'test.txt'), 'Hello, World!\nLine 2\nLine 3', 'utf-8');
    await fs.writeFile(path.join(TEST_DIR, 'data.json'), JSON.stringify({ key: 'value', count: 42 }), 'utf-8');
  }

  async cleanup(): Promise<void> {
    console.log('\n🧹 清理测试环境...');
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }

  private addResult(name: string, passed: boolean, message: string, duration?: number): void {
    this.results.push({ name, passed, message, duration });
  }

  private printResult(result: TestResult): void {
    const icon = result.passed ? '✓' : '✗';
    const color = result.passed ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';

    console.log(`${color}${icon} ${result.name}${reset}`);
    if (result.duration !== undefined) {
      console.log(`  耗时: ${result.duration}ms`);
    }
    if (result.message) {
      console.log(`  ${result.message}`);
    }
  }

  async testToolRegistration(): Promise<void> {
    console.log('📦 测试工具注册...');
    const startTime = Date.now();

    try {
      const tools = await getBuiltinTools();

      // 检查工具数量
      const expectedCount = 13;
      const passed = tools.length === expectedCount;
      this.addResult(
        '工具数量',
        passed,
        passed ? `注册了 ${tools.length} 个工具` : `期望 ${expectedCount} 个，实际 ${tools.length} 个`,
        Date.now() - startTime
      );

      // 检查必需工具
      const requiredTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];
      const toolNames = tools.map(t => t.name);
      const missingTools = requiredTools.filter(t => !toolNames.includes(t));

      this.addResult(
        '必需工具',
        missingTools.length === 0,
        missingTools.length === 0 ? '所有必需工具已注册' : `缺失: ${missingTools.join(', ')}`
      );

      // 检查工具权限
      const readTool = tools.find(t => t.name === 'Read');
      this.addResult(
        'Read 工具权限',
        readTool?.permission === 'safe',
        readTool?.permission === 'safe' ? 'safe' : `实际: ${readTool?.permission}`
      );

      const bashTool = tools.find(t => t.name === 'Bash');
      this.addResult(
        'Bash 工具权限',
        bashTool?.permission === 'dangerous',
        bashTool?.permission === 'dangerous' ? 'dangerous' : `实际: ${bashTool?.permission}`
      );
    } catch (error) {
      this.addResult('工具注册', false, `错误: ${(error as Error).message}`);
    }
  }

  async testPromptLoading(): Promise<void> {
    console.log('\n📄 测试提示词加载...');
    const startTime = Date.now();

    try {
      // 测试单个工具提示词加载
      const readPrompt = await hasToolPrompt('read');
      this.addResult(
        'Read 提示词文件',
        readPrompt,
        readPrompt ? 'prompts/tools/read.txt 存在' : '文件不存在'
      );

      // 测试工具描述生成
      const description = await generateToolsDescription();
      const hasUsage = description.includes('Usage:');
      this.addResult(
        '描述生成',
        hasUsage && description.length > 1000,
        `生成了 ${description.length} 字符，包含详细说明`
      );

      // 检查是否包含关键工具
      const hasReadDesc = description.includes('## read');
      const hasWriteDesc = description.includes('## write');
      const hasEditDesc = description.includes('## edit');

      this.addResult(
        '工具描述完整性',
        hasReadDesc && hasWriteDesc && hasEditDesc,
        hasReadDesc && hasWriteDesc && hasEditDesc ? '包含所有主要工具描述' : '部分工具描述缺失'
      );
    } catch (error) {
      this.addResult('提示词加载', false, `错误: ${(error as Error).message}`);
    }
  }

  async testToolExecution(): Promise<void> {
    console.log('\n⚙️ 测试工具执行...');
    const startTime = Date.now();

    try {
      // 注册工具
      const tools = await getBuiltinTools();
      this.toolEngine.registerTools(tools);

      // 测试 Glob 工具
      const globResult = await this.toolEngine.executeToolCall({
        tool: 'Glob',
        parameters: {
          pattern: '*.txt',
          path: TEST_DIR
        }
      });
      this.addResult(
        'Glob 工具',
        globResult.success && globResult.output.includes('test.txt'),
        globResult.success ? '成功找到文件' : globResult.error || '执行失败'
      );

      // 测试 Read 工具
      const readResult = await this.toolEngine.executeToolCall({
        tool: 'Read',
        parameters: {
          filePath: path.join(TEST_DIR, 'test.txt')
        }
      });
      this.addResult(
        'Read 工具',
        readResult.success && readResult.output.includes('Hello'),
        readResult.success ? '成功读取文件' : readResult.error || '执行失败'
      );

      // 测试错误处理
      const errorResult = await this.toolEngine.executeToolCall({
        tool: 'Read',
        parameters: {
          filePath: '/nonexistent/file.txt'
        }
      });
      this.addResult(
        '错误处理',
        !errorResult.success && errorResult.error,
        '正确返回错误信息'
      );

      // 测试参数验证
      const invalidResult = await this.toolEngine.executeToolCall({
        tool: 'Read',
        parameters: {}
      } as any);
      this.addResult(
        '参数验证',
        !invalidResult.success,
        '正确拒绝无效参数'
      );
    } catch (error) {
      this.addResult('工具执行', false, `错误: ${(error as Error).message}`);
    }
  }

  async testToolEngineFeatures(): Promise<void> {
    console.log('\n🔍 测试工具引擎功能...');
    const startTime = Date.now();

    try {
      const tools = await getBuiltinTools();
      this.toolEngine.registerTools(tools);

      // 测试工具查询
      const readTool = this.toolEngine.getTool('Read');
      this.addResult(
        '工具查询',
        readTool !== undefined && readTool.name === 'Read',
        '成功查询工具'
      );

      // 测试类别查询
      const fileTools = this.toolEngine.getToolsByCategory('file');
      this.addResult(
        '类别查询',
        fileTools.length > 0,
        `找到 ${fileTools.length} 个文件类工具`
      );

      // 测试所有工具
      const allTools = this.toolEngine.getAllTools();
      this.addResult(
        '获取所有工具',
        allTools.length === tools.length,
        `返回 ${allTools.length} 个工具`
      );
    } catch (error) {
      this.addResult('工具引擎功能', false, `错误: ${(error as Error).message}`);
    }
  }

  printSummary(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 测试总结');
    console.log('='.repeat(60));

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => r !. r.passed).length;
    const total = this.results.length;

    console.log(`总计: ${total} | 通过: ${passed} | 失败: ${failed}`);
    console.log(`成功率: ${((passed / total) * 100).toFixed(1)}%`);

    if (failed > 0) {
      console.log('\n失败的测试:');
      this.results.filter(r => !r.passed).forEach(r => this.printResult(r));
    }

    console.log('='.repeat(60));

    if (failed === 0) {
      console.log('✅ 所有测试通过！');
    } else {
      console.log('❌ 部分测试失败，请检查上述错误');
    }
  }

  async runAll(): Promise<void> {
    const startTime = Date.now();

    try {
      await this.setup();

      // 打印所有结果
      this.results.forEach(r => this.printResult(r));

      await this.cleanup();
      this.printSummary();
    } catch (error) {
      console.error('\n❌ 测试运行失败:', error);
      await this.cleanup();
    }

    const duration = Date.now() - startTime;
    console.log(`\n⏱️ 总耗时: ${duration}ms`);
  }
}

// 运行测试
async function main() {
  console.log('🧪 GG CODE 工具系统测试\n');
  const tester = new ToolSystemTester();
  await tester.runAll();
}

main().catch(error => {
  console.error('测试执行失败:', error);
  process.exit(1);
});
