// 简单测试智能匹配功能

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\]/g, '\\$&');
}

function findMatch(content, search) {
  const strategies = [];

  strategies.push({
    name: 'exact match',
    match: () => (content.includes(search) ? search : null),
  });

  strategies.push({
    name: 'normalized line endings',
    match: () => {
      const normalizedSearch = search.replace(/\r\n/g, '\n');
      const normalizedContent = content.replace(/\r\n/g, '\n');
      if (normalizedContent.includes(normalizedSearch)) {
        return search.replace(/\r\n/g, '\n');
      }
      return null;
    },
  });

  strategies.push({
    name: 'trimmed lines',
    match: () => {
      const contentLines = content.split('\n');
      const searchLines = search.split('\n');

      while (searchLines.length > 0 && searchLines[searchLines.length - 1] === '') {
        searchLines.pop();
      }

      if (searchLines.length === 0) return null;

      for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
        let matches = true;
        for (let j = 0; j < searchLines.length; j++) {
          if (contentLines[i + j].trim() !== searchLines[j].trim()) {
            matches = false;
            break;
          }
        }
        if (matches) {
          return contentLines.slice(i, i + searchLines.length).join('\n');
        }
      }
      return null;
    },
  });

  for (const strategy of strategies) {
    const matched = strategy.match();
    if (matched) {
      return { found: true, matchedString: matched, strategy: strategy.name };
    }
  }

  return { found: false, strategies: strategies.map((s) => s.name) };
}

const content = 'function hello() {\n  console.log("world");\n}\n';

const tests = [
  { name: '精确匹配', search: 'function hello() {' },
  { name: '缩进差异', search: 'function hello() {\n  console.log("world");' },
  { name: '行修剪', search: 'function hello() {\n  console.log("world");\n}\n' },
  { name: '未找到', search: 'function goodbye() {' },
];

console.log('=== 智能匹配测试 ===\n');

tests.forEach((test, i) => {
  const result = findMatch(content, test.search);
  console.log(`\n测试 ${i +1}: ${test.name}`);
  if (result.found) {
    console.log(`  ✓ 找到匹配 (策略: ${result.strategy})`);
  } else {
    console.log(`  ✗ 未找到`);
    console.log(`  尝试的策略: ${result.strategies.join(', ')}`);
  }
});
