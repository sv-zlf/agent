/**
 * Edit Utilities
 * 编辑工具共享函数 - 智能匹配算法
 */

/**
 * 转义正则表达式特殊字符
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 计算 Levenshtein 距离（编辑距离）
 * 用于模糊字符串匹配
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // 创建距离矩阵
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  // 初始化边界
  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  // 填充矩阵
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // 删除
          dp[i][j - 1] + 1, // 插入
          dp[i - 1][j - 1] + 1 // 替换
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * 计算字符串相似度 (0-1)
 * 1 表示完全相同，0 表示完全不同
 */
export function similarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(str1, str2);
  return 1 - distance / maxLen;
}

/**
 * 规范化转义字符
 * 处理不同格式的转义序列
 */
function normalizeEscapes(text: string): string {
  return (
    text
      // 统一换行符
      .replace(/\\r\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\\n/g, '\n')
      // 统一制表符
      .replace(/\\t/g, '\t')
      // 统一其他常见转义
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
  );
}

/**
 * 查找最佳匹配块（基于相似度）
 */
function findBestMatchBlock(
  content: string,
  search: string,
  threshold: number = 0.8
): { block: string; similarity: number; index: number } | null {
  const searchLines = search.split('\n').filter((line) => line.trim().length > 0);
  if (searchLines.length === 0) return null;

  const contentLines = content.split('\n');
  let bestMatch: { block: string; similarity: number; index: number } | null = null;

  // 滑动窗口搜索
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidateLines = contentLines.slice(i, i + searchLines.length);
    const candidate = candidateLines.join('\n');

    // 计算相似度
    const sim = similarity(candidate, search);

    if (sim >= threshold && (!bestMatch || sim > bestMatch.similarity)) {
      bestMatch = {
        block: candidate,
        similarity: sim,
        index: i,
      };
    }
  }

  return bestMatch;
}

/**
 * 移除字符串两端的空白字符
 */
function trimBoundaries(text: string): string {
  return text.replace(/^\s+/, '').replace(/\s+$/, '');
}

/**
 * 归一化空白字符（多个空格/制表符 → 单个空格）
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 移除公共缩进
 */
function removeCommonIndent(text: string): string {
  const lines = text.split('\n');
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) return text;

  const minIndent = Math.min(
    ...nonEmptyLines.map((line) => {
      const match = line.match(/^(\s*)/);
      return match ? match[1].length : 0;
    })
  );

  return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join('\n');
}

/**
 * 尝试在内容中查找匹配的字符串
 * 支持多种匹配策略以提高编辑成功率
 *
 * @returns 找到的匹配字符串和使用的策略，或未找到时返回尝试过的策略
 */
export function findMatch(
  content: string,
  search: string
):
  | { found: true; matchedString: string; strategy: string }
  | { found: false; strategies: string[] } {
  const strategies: Array<{ name: string; match: () => string | null }> = [];

  // 1. 精确匹配
  strategies.push({
    name: 'exact match',
    match: () => (content.includes(search) ? search : null),
  });

  // 2. 边界修剪匹配（处理首尾多余空格）- 高优先级
  strategies.push({
    name: 'trimmed boundaries',
    match: () => {
      const trimmedSearch = trimBoundaries(search);
      if (trimmedSearch !== search && content.includes(trimmedSearch)) {
        return trimmedSearch;
      }
      return null;
    },
  });

  // 3. 换行符规范化匹配
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

  // 4. 行修剪匹配（处理行首尾多余空格）
  strategies.push({
    name: 'trimmed lines',
    match: () => {
      const contentLines = content.split('\n');
      const searchLines = search.split('\n');

      // 移除搜索行的尾随空行
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
          // 找到匹配，返回原始内容中的实际字符串（保留缩进和空格）
          return contentLines.slice(i, i + searchLines.length).join('\n');
        }
      }
      return null;
    },
  });

  // 5. 缩进灵活匹配（忽略缩进差异）
  strategies.push({
    name: 'indentation flexible',
    match: () => {
      const normalizedSearch = removeCommonIndent(search);
      const contentLines = content.split('\n');
      const searchLines = search.split('\n');

      for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
        const block = contentLines.slice(i, i + searchLines.length).join('\n');
        if (removeCommonIndent(block) === normalizedSearch) {
          return block;
        }
      }
      return null;
    },
  });

  // 6. 空白规范化匹配（多个空格/制表符 → 单个空格）
  strategies.push({
    name: 'whitespace normalized',
    match: () => {
      const normalizedSearch = normalizeWhitespace(search);
      const normalizedContent = normalizeWhitespace(content);

      if (normalizedContent.includes(normalizedSearch)) {
        // 处理多行匹配
        const findLines = search.split('\n');
        if (findLines.length > 1) {
          const contentLines = content.split('\n');
          for (let i = 0; i <= contentLines.length - findLines.length; i++) {
            const block = contentLines.slice(i, i + findLines.length).join('\n');
            if (normalizeWhitespace(block) === normalizedSearch) {
              return block;
            }
          }
          return null;
        }

        // 单行匹配：尝试在原始内容中找到精确位置
        const words = normalizedSearch.split(' ');
        if (words.length >= 2) {
          // 至少两个词，构建灵活的匹配模式
          let pattern = words.map((word) => escapeRegExp(word)).join('\\s+');
          try {
            const regex = new RegExp(pattern);
            const match = content.match(regex);
            if (match) {
              return match[0];
            }
          } catch (e) {
            // 忽略正则表达式错误
          }
        }

        return null;
      }
      return null;
    },
  });

  // 7. 上下文感知匹配（使用首尾行作为锚点）
  strategies.push({
    name: 'context aware',
    match: () => {
      const searchLines = search.split('\n');
      if (searchLines.length < 2) {
        return null; // 至少需要2行才能使用锚点
      }

      // 移除尾随空行
      while (searchLines.length > 0 && searchLines[searchLines.length - 1] === '') {
        searchLines.pop();
      }

      if (searchLines.length < 2) return null;

      const firstLineTrimmed = searchLines[0].trim();
      const lastLineTrimmed = searchLines[searchLines.length - 1].trim();
      const contentLines = content.split('\n');

      // 查找首尾行匹配的位置
      for (let i = 0; i < contentLines.length - searchLines.length + 1; i++) {
        if (contentLines[i].trim() !== firstLineTrimmed) {
          continue;
        }

        // 检查对应位置是否有匹配的尾行
        const endIndex = i + searchLines.length - 1;
        if (endIndex >= contentLines.length) continue;

        if (contentLines[endIndex].trim() !== lastLineTrimmed) {
          continue;
        }

        // 找到锚点匹配，返回完整块
        return contentLines.slice(i, endIndex + 1).join('\n');
      }

      return null;
    },
  });

  // 8. 容错多行匹配（允许某些行有额外空格）
  strategies.push({
    name: 'lenient multiline',
    match: () => {
      const searchLines = search.split('\n');
      if (searchLines.length < 2) return null;

      // 移除尾随空行
      while (searchLines.length > 0 && searchLines[searchLines.length - 1] === '') {
        searchLines.pop();
      }

      if (searchLines.length === 0) return null;

      const contentLines = content.split('\n');

      for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
        let matchCount = 0;
        const requiredMatches = Math.ceil(searchLines.length * 0.7); // 70% 的行匹配即可

        for (let j = 0; j < searchLines.length; j++) {
          const contentLine = contentLines[i + j];
          const searchLine = searchLines[j];

          // 修剪后比较
          if (contentLine.trim() === searchLine.trim()) {
            matchCount++;
          } else if (contentLine.trim().includes(searchLine.trim())) {
            // 包含关系也算部分匹配
            matchCount += 0.5;
          }
        }

        if (matchCount >= requiredMatches) {
          // 足够匹配，返回原始块
          return contentLines.slice(i, i + searchLines.length).join('\n');
        }
      }

      return null;
    },
  });

  // 9. 转义字符规范化匹配（处理转义序列差异）
  strategies.push({
    name: 'escape normalized',
    match: () => {
      const normalizedSearch = normalizeEscapes(search);
      const normalizedContent = normalizeEscapes(content);

      if (normalizedContent.includes(normalizedSearch)) {
        // 找到匹配，尝试在原始内容中定位
        const searchLines = normalizedSearch.split('\n');
        const contentLines = content.split('\n');

        for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
          const block = contentLines.slice(i, i + searchLines.length).join('\n');
          if (normalizeEscapes(block) === normalizedSearch) {
            return block;
          }
        }
      }
      return null;
    },
  });

  // 10. 块锚点匹配（基于 Levenshtein 距离）
  strategies.push({
    name: 'block anchor (levenshtein)',
    match: () => {
      const searchLines = search.split('\n').filter((line) => line.trim().length > 0);
      if (searchLines.length < 2) return null;

      const contentLines = content.split('\n');
      const firstLine = searchLines[0].trim();
      const lastLine = searchLines[searchLines.length - 1].trim();

      // 使用锚点快速定位候选位置
      for (let i = 0; i < contentLines.length - searchLines.length + 1; i++) {
        // 检查首行锚点（使用相似度而非精确匹配）
        const firstLineSim = similarity(contentLines[i].trim(), firstLine);
        if (firstLineSim < 0.8) continue;

        // 检查尾行锚点
        const endIndex = i + searchLines.length - 1;
        if (endIndex >= contentLines.length) continue;

        const lastLineSim = similarity(contentLines[endIndex].trim(), lastLine);
        if (lastLineSim < 0.8) continue;

        // 锚点匹配成功，检查整个块的相似度
        const candidateBlock = contentLines.slice(i, endIndex + 1).join('\n');
        const blockSim = similarity(candidateBlock, search);

        if (blockSim >= 0.85) {
          return candidateBlock;
        }
      }

      return null;
    },
  });

  // 11. 相似度阈值匹配（最后一道防线，使用 90% 相似度）
  strategies.push({
    name: 'similarity threshold (90%)',
    match: () => {
      const bestMatch = findBestMatchBlock(content, search, 0.9);
      if (bestMatch) {
        return bestMatch.block;
      }
      return null;
    },
  });

  // 12. 宽松相似度匹配（使用 80% 相似度作为最后尝试）
  strategies.push({
    name: 'similarity threshold (80%)',
    match: () => {
      const bestMatch = findBestMatchBlock(content, search, 0.8);
      if (bestMatch) {
        return bestMatch.block;
      }
      return null;
    },
  });

  // 按顺序尝试所有策略
  for (const strategy of strategies) {
    const matched = strategy.match();
    if (matched) {
      return { found: true, matchedString: matched, strategy: strategy.name };
    }
  }

  // 都失败了，返回尝试过的策略
  return {
    found: false,
    strategies: strategies.map((s) => s.name),
  };
}
