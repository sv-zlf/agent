/**
 * 提示词加载测试脚本
 */

const path = require('path');

async function testPromptLoading() {
  console.log('\n🧪 测试提示词加载...\n');

  try {
    // 模拟 PromptBuilder 的加载逻辑
    const promptsDir = path.join(process.cwd(), 'src/prompts');
    const fs = require('fs/promises');

    // 测试加载 Agent 提示词
    const agentFiles = ['build', 'explore', 'plan'];
    for (const agent of agentFiles) {
      const filePath = path.join(promptsDir, 'agents', `${agent}.txt`);
      const content = await fs.readFile(filePath, 'utf-8');
      console.log(`✓ ${agent}.txt 加载成功 (${content.length} 字符)`);
    }

    // 测试加载工具描述
    const toolFiles = ['read', 'write', 'edit', 'glob', 'grep', 'bash'];
    for (const tool of toolFiles) {
      const filePath = path.join(promptsDir, '_tools', `${tool}.txt`);
      const content = await fs.readFile(filePath, 'utf-8');
      console.log(`✓ _tools/${tool}.txt 加载成功 (${content.length} 字符)`);
    }

    // 测试加载基础组件
    const baseFiles = ['header', 'tool-format', 'workflow', 'security'];
    for (const base of baseFiles) {
      const filePath = path.join(promptsDir, '_base', `${base}.txt`);
      const content = await fs.readFile(filePath, 'utf-8');
      console.log(`✓ _base/${base}.txt 加载成功 (${content.length} 字符)`);
    }

    // 测试加载系统提示词
    const systemFiles = ['compaction', 'summary', 'title', 'max-steps', 'init'];
    for (const sys of systemFiles) {
      const filePath = path.join(promptsDir, 'system', `${sys}.txt`);
      const content = await fs.readFile(filePath, 'utf-8');
      console.log(`✓ system/${sys}.txt 加载成功 (${content.length} 字符)`);
    }

    // 测试 PromptBuilder 索引文件
    const indexPath = path.join(promptsDir, 'index.ts');
    const indexContent = await fs.readFile(indexPath, 'utf-8');
    console.log(`✓ index.ts 加载成功 (${indexContent.length} 字符)`);

    console.log('\n✅ 所有提示词文件加载成功！\n');
  } catch (error) {
    console.error('\n❌ 提示词加载失败:', error.message);
    process.exit(1);
  }
}

testPromptLoading();
