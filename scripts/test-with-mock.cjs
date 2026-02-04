#!/usr/bin/env node
/**
 * Mock API 测试脚本
 * 用于在外网环境下测试工具的准确性
 */

const { createMockAPIAdapter } = require('../dist/api');
const { getBuiltinTools } = require('../dist/tools');
const { createToolEngine } = require('../dist/core/tool-engine');
const path = require('path');

// 配置
const MOCK_SCENARIOS_DIR = path.join(__dirname, '../tests/fixtures/mock-scenarios');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message) {
  log(`✓ ${message}`, 'green');
}

function error(message) {
  log(`✗ ${message}`, 'red');
}

function info(message) {
  log(`ℹ ${message}`, 'blue');
}

async function testScenario(scenarioName, apiAdapter, toolEngine) {
  log(`\n${'='.repeat(60)}`, 'cyan');
  log(`测试场景: ${scenarioName}`, 'cyan');
  log('='.repeat(60), 'cyan');

  try {
    // 选择场景
    apiAdapter.selectScenario(scenarioName);
    const scenario = apiAdapter.getCurrentScenarioInfo();
    success(`已加载场景: ${scenario.description}`);
    info(`预期响应数: ${scenario.responses.length}`);

    // 模拟 AI 对话
    const testMessage = { role: 'user', content: `测试场景: ${scenarioName}` };
    const response = await apiAdapter.chat([testMessage]);

    success(`收到 AI 响应`);
    info(`响应内容: ${response.substring(0, 100)}...`);

    return true;
  } catch (err) {
    error(`场景测试失败: ${err.message}`);
    return false;
  }
}

async function testToolCallParsing(apiAdapter) {
  log(`\n${'='.repeat(60)}`, 'cyan');
  log('测试工具调用解析', 'cyan');
  log('='.repeat(60), 'cyan');

  try {
    // 明确选择工具调用解析测试场景
    apiAdapter.selectScenario('tool-call-parsing');

    const message = {
      role: 'user',
      content: '请读取 src/test.ts 文件',
    };

    const response = await apiAdapter.chat([message]);

    info(`响应内容: ${response.substring(0, 100)}...`);

    // 检查响应中是否包含工具调用标记
    const hasToolCall = response.includes('<tool>') || response.includes('⮐');
    if (hasToolCall) {
      success('检测到工具调用标记');
      return true;
    } else {
      error('未检测到工具调用标记');
      info(`完整响应: ${response}`);
      return false;
    }
  } catch (err) {
    error(`工具调用解析测试失败: ${err.message}`);
    return false;
  }
}

async function testMultiTurnConversation(apiAdapter) {
  log(`\n${'='.repeat(60)}`, 'cyan');
  log('测试多轮对话', 'cyan');
  log('='.repeat(60), 'cyan');

  try {
    apiAdapter.selectScenario('file-read');

    const messages = [
      { role: 'user', content: '读取文件' },
    ];

    // 第一轮
    let response = await apiAdapter.chat(messages);
    success(`第1轮对话成功`);
    messages.push({ role: 'assistant', content: response });

    // 第二轮（模拟工具结果）
    response = await apiAdapter.chat(messages);
    success(`第2轮对话成功`);
    messages.push({ role: 'assistant', content: response });

    // 第三轮
    response = await apiAdapter.chat(messages);
    success(`第3轮对话成功`);

    return true;
  } catch (err) {
    error(`多轮对话测试失败: ${err.message}`);
    return false;
  }
}

async function main() {
  log('\n🧪 Mock API 测试工具\n', 'cyan');

  // 创建 Mock API 适配器
  const config = {
    base_url: 'http://mock-api',
    model: 'mock-model',
    access_key_id: 'mock-key',
    tx_code: 'mock-tx',
    sec_node_no: 'mock-node',
  };

  const apiAdapter = createMockAPIAdapter(config);

  // 加载所有测试场景
  info(`加载测试场景: ${MOCK_SCENARIOS_DIR}`);
  await apiAdapter.loadScenariosFromDir(MOCK_SCENARIOS_DIR);

  const scenarios = apiAdapter.getScenarioNames();
  success(`已加载 ${scenarios.length} 个测试场景: ${scenarios.join(', ')}`);

  // 创建工具引擎
  const tools = await getBuiltinTools();
  const toolEngine = createToolEngine();
  toolEngine.registerTools(tools);
  success(`已注册 ${tools.length} 个工具`);

  // 运行测试
  const results = {
    scenarioTests: [],
    toolCallParsing: false,
    multiTurn: false,
  };

  // 测试各个场景
  for (const scenario of scenarios) {
    const passed = await testScenario(scenario, apiAdapter, toolEngine);
    results.scenarioTests.push({ scenario, passed });
  }

  // 测试工具调用解析
  results.toolCallParsing = await testToolCallParsing(apiAdapter);

  // 测试多轮对话
  results.multiTurn = await testMultiTurnConversation(apiAdapter);

  // 输出测试报告
  log(`\n${'='.repeat(60)}`, 'cyan');
  log('测试报告', 'cyan');
  log('='.repeat(60), 'cyan');

  const totalTests =
    results.scenarioTests.length + 1 + 1; // scenarios + tool call + multi-turn
  const passedTests =
    results.scenarioTests.filter(t => t.passed).length +
    (results.toolCallParsing ? 1 : 0) +
    (results.multiTurn ? 1 : 0);

  log(`\n场景测试:`, 'yellow');
  results.scenarioTests.forEach(({ scenario, passed }) => {
    if (passed) {
      success(`  ${scenario}`);
    } else {
      error(`  ${scenario}`);
    }
  });

  log(`\n其他测试:`, 'yellow');
  if (results.toolCallParsing) {
    success('  工具调用解析');
  } else {
    error('  工具调用解析');
  }

  if (results.multiTurn) {
    success('  多轮对话');
  } else {
    error('  多轮对话');
  }

  log(`\n总计: ${passedTests}/${totalTests} 通过`, 'yellow');

  if (passedTests === totalTests) {
    log('\n✅ 所有测试通过！', 'green');
    process.exit(0);
  } else {
    log('\n❌ 部分测试失败', 'red');
    process.exit(1);
  }
}

main().catch(err => {
  error(`测试失败: ${err.message}`);
  console.error(err);
  process.exit(1);
});
