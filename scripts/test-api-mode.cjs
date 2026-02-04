#!/usr/bin/env node
/**
 * API 模式测试脚本
 * 用于测试 A4011LM01 和 OpenApi 两种模式是否配置正确
 */

const { createAPIAdapterFactory } = require('../dist/api');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
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
  log(`ℹ ${message}`, 'cyan');
}

async function testAPIMode(config, modeName) {
  log(`\n${'='.repeat(60)}`, 'cyan');
  log(`测试 ${modeName} 模式`, 'cyan');
  log('='.repeat(60), 'cyan');

  try {
    // 创建适配器工厂
    const factory = createAPIAdapterFactory(config);
    const adapter = factory.create();

    info(`API 模式: ${factory.getAPIMode()}`);
    info(`适配器模式: ${factory.getMode()}`);

    // 测试简单的聊天请求
    const testMessage = [{ role: 'user', content: '你好' }];
    info('发送测试请求...');

    const response = await adapter.chat(testMessage);
    success(`收到响应: ${response.substring(0, 50)}...`);
    success(`${modeName} 模式测试通过！`);
    return true;
  } catch (err) {
    error(`${modeName} 模式测试失败: ${err.message}`);
    return false;
  }
}

async function main() {
  log('\n🧪 GG CODE API 模式测试工具\n', 'cyan');

  // 测试配置
  const testConfigs = [
    {
      name: '内网 API (A4011LM01)',
      config: {
        mode: 'A4011LM01',
        base_url: 'http://10.252.167.50:8021',
        access_key_id: '1305842310935769088',
        tx_code: 'A4011LM01',
        sec_node_no: '400136',
        model: 'DeepSeek-V3-671B_20250725',
        timeout: 10000,
      },
      enabled: true, // 根据实际情况修改
    },
    {
      name: 'OpenAPI (智谱 GLM)',
      config: {
        mode: 'OpenApi',
        base_url: 'https://open.bigmodel.cn/api/paas/v4',
        api_key: 'your_api_key_here', // 替换为真实的 API key
        model: 'glm-4.7',
        timeout: 10000,
      },
      enabled: false, // 默认不测试，需要配置 API key
    },
  ];

  const results = [];

  for (const test of testConfigs) {
    if (!test.enabled) {
      info(`跳过 ${test.name}（未启用）`);
      continue;
    }

    const passed = await testAPIMode(test.config, test.name);
    results.push({ name: test.name, passed });
  }

  // 输出测试报告
  log(`\n${'='.repeat(60)}`, 'cyan');
  log('测试报告', 'cyan');
  log('='.repeat(60), 'cyan');

  const enabledTests = results.filter(r => r);
  if (enabledTests.length === 0) {
    log('\n⚠️  未启用任何测试', 'yellow');
    log('\n请编辑 scripts/test-api-mode.js，启用需要测试的模式并配置正确的 API 密钥', 'yellow');
    return;
  }

  const passedTests = enabledTests.filter(r => r.passed);
  log(`\n总计: ${passedTests.length}/${enabledTests.length} 通过`, 'yellow');

  if (passedTests.length === enabledTests.length) {
    log('\n✅ 所有测试通过！', 'green');
  } else {
    log('\n❌ 部分测试失败', 'red');
  }
}

main().catch(err => {
  error(`测试失败: ${err.message}`);
  console.error(err);
  process.exit(1);
});
