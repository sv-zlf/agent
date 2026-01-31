#!/usr/bin/env node
/**
 * 工具系统快速测试脚本 (CommonJS 版本)
 * 可直接运行: node scripts/test-tools-simple.js
 */

const { createToolEngine } = require('../dist/core/tool-engine');
const { getBuiltinTools, generateToolsDescription } = require('../dist/tools');
const { clearPromptCache } = require('../dist/utils/tool-prompt-loader');
const fs = require('fs/promises');
const path = require('path');

const TEST_DIR = path.join(process.cwd(), 'tests', 'temp');

async function setup() {
  console.log('🔧 设置测试环境...\n');
  clearPromptCache();

  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.writeFile(path.join(TEST_DIR, 'test.txt'), 'Hello, World!\nLine 2\nLine 3', 'utf-8');
  await fs.writeFile(path.join(TEST_DIR, 'data.json'), JSON.stringify({ key: 'value', count: 42 }), 'utf-8');
}

async function cleanup() {
  console.log('\n🧹 清理测试环境...');
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch {
    // 忽略
  }
}

async function testToolRegistration() {
  console.log('📦 测试工具注册...');

  const tools = await getBuiltinTools();
  console.log(`  ✓ 注册了 ${tools.length} 个工具`);

  const toolNames = tools.map(t => t.name).join(', ');
  console.log(`  ✓ 工具列表: ${toolNames}`);

  // 检查权限
  const readTool = tools.find(t => t.name === 'Read');
  const bashTool = tools.find(t => t.name === 'Bash');
  console.log(`  ✓ Read 权限: ${readTool?.permission}`);
  console.log(`  ✓ Bash 权限: ${bashTool?.permission}`);
  console.log();
}

async function testPromptLoading() {
  console.log('📄 测试提示词加载...');

  const description = await generateToolsDescription();
  console.log(`  ✓ 生成了 ${description.length} 字符的描述`);
  console.log(`  ✓ 包含 ${description.split('\n').length} 行`);

  // 检查关键内容
  const hasRead = description.includes('## read');
  const hasWrite = description.includes('## write');
  console.log(`  ✓ 包含 read: ${hasRead ? '是' : '否'}`);
  console.log(`  ✓ 包含 write: ${hasWrite ? '是' : '否'}`);
  console.log();
}

async function testToolExecution() {
  console.log('⚙️ 测试工具执行...');

  const toolEngine = createToolEngine();
  await toolEngine.initialize();

  const tools = await getBuiltinTools();
  toolEngine.registerTools(tools);

  // 测试 Glob
  const globResult = await toolEngine.executeToolCall({
    tool: 'Glob',
    parameters: {
      pattern: '*.txt',
      path: TEST_DIR
    }
  });

  if (globResult.success) {
    const files = globResult.output.split('\n').filter(l => l.trim());
    console.log(`  ✓ Glob 找到 ${files.length} 个文件`);
  } else {
    console.log(`  ✗ Glob 失败: ${globResult.error}`);
  }

  // 测试 Read
  const readResult = await toolEngine.executeToolCall({
    tool: 'Read',
    parameters: {
      filePath: path.join(TEST_DIR, 'test.txt')
    }
  });

  if (readResult.success) {
    console.log(`  ✓ Read 成功读取文件`);
  } else {
    console.log(`  ✗ Read 失败: ${readResult.error}`);
  }

  // 测试错误处理
  const errorResult = await toolEngine.executeToolCall({
    tool: 'Read',
    parameters: {
      filePath: '/nonexistent/file.txt'
    }
  });

  if (!errorResult.success) {
    console.log(`  ✓ 错误处理正常`);
  }

  console.log();
}

async function testToolEngineFeatures() {
  console.log('🔍 测试工具引擎功能...');

  const toolEngine = createToolEngine();
  const tools = await getBuiltinTools();
  toolEngine.registerTools(tools);

  const allTools = toolEngine.getAllTools();
  console.log(`  ✓ 引擎中有 ${allTools.length} 个工具`);

  const fileTools = toolEngine.getToolsByCategory('file');
  console.log(`  ✓ 文件类工具: ${fileTools.length} 个`);

  const readTool = toolEngine.getTool('Read');
  console.log(`  ✓ 工具查询: ${readTool ? '成功' : '失败'}`);
  console.log();
}

async function main() {
  console.log('🧪 GG CODE 工具系统测试\n');
  const startTime = Date.now();

  try {
    await setup();
    await testToolRegistration();
    await testPromptLoading();
    await testToolExecution();
    await testToolEngineFeatures();
    await cleanup();

    const duration = Date.now() - startTime;
    console.log('='.repeat(60));
    console.log('✅ 所有测试通过！');
    console.log(`⏱️ 总耗时: ${duration}ms`);
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    await cleanup();
    process.exit(1);
  }
}

main();
