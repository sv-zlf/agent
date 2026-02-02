/**
 * Question 工具测试脚本
 *
 * 测试向用户提问功能的单选、多选和文本输入模式
 */

const { QuestionTool } = require('./dist/tools/question');

async function testQuestion() {
  console.log('=== Question 工具测试 ===\n');

  // 初始化工具
  const info = await QuestionTool.init();

  console.log('工具描述:', info.description.substring(0, 100) + '...');
  console.log('\n参数示例:');
  console.log(JSON.stringify(info.parameters.shape, null, 2));

  console.log('\n=== 测试单选问题 ===');
  const singleChoiceResult = await info.execute(
    {
      questions: [
        {
          question: '您想使用哪个数据库？',
          header: '数据库',
          options: [
            { label: 'PostgreSQL', description: '强大的开源关系数据库' },
            { label: 'MySQL', description: '流行的开源数据库' },
            { label: 'SQLite', description: '轻量级嵌入式数据库' },
            { label: 'MongoDB', description: 'NoSQL 文档数据库' },
          ],
          custom: true,
        },
      ],
    },
    {
      sessionID: 'test-session',
      messageID: 'test-message',
      agent: 'default',
      metadata: () => {},
    }
  );

  console.log('\n结果:', singleChoiceResult);

  console.log('\n=== 测试多选问题 ===');
  const multiChoiceResult = await info.execute(
    {
      questions: [
        {
          question: '您需要哪些功能？（多选）',
          header: '功能选择',
          options: [
            { label: '用户认证', description: '登录、注册、权限管理' },
            { label: '数据库', description: '数据持久化存储' },
            { label: 'API接口', description: 'RESTful API 设计' },
            { label: '前端界面', description: '用户交互界面' },
          ],
          multiple: true,
          custom: true,
        },
      ],
    },
    {
      sessionID: 'test-session',
      messageID: 'test-message',
      agent: 'default',
      metadata: () => {},
    }
  );

  console.log('\n结果:', multiChoiceResult);

  console.log('\n=== 测试无选项问题（文本输入）===');
  const textInputResult = await info.execute(
    {
      questions: [
        {
          question: '请输入项目名称：',
          header: '项目名称',
          options: [],
        },
      ],
    },
    {
      sessionID: 'test-session',
      messageID: 'test-message',
      agent: 'default',
      metadata: () => {},
    }
  );

  console.log('\n结果:', textInputResult);

  console.log('\n=== 测试完成 ===');
}

testQuestion().catch(console.error);
