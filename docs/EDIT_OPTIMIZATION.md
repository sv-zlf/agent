# 批量编辑工具优化

## 📋 优化概述

已对 `Edit` 和 `MultiEdit` 工具进行全面优化，显著提高编辑成功率。

## 🔧 新增匹配策略

参考 opencode 实现，添加了 **8 种智能匹配策略**（按优先级尝试）：

### 策略列表

| #   | 策略                        | 说明           | 解决的问题                           |
| --- | --------------------------- | -------------- | ------------------------------------ |
| 1   | **exact match**             | 精确字符串匹配 | 基础匹配                             |
| 2   | **trimmed boundaries**      | 边界修剪匹配   | AI 在 oldString 首尾加多余空格       |
| 3   | **normalized line endings** | 换行符规范化   | Windows (`\r\n`) vs Unix (`\n`) 差异 |
| 4   | **trimmed lines**           | 行首尾空格修剪 | AI 提供的行有多余空格                |
| 5   | **indentation flexible**    | 缩进灵活匹配   | 缩进不一致（tabs vs spaces）         |
| 6   | **whitespace normalized**   | 空白规范化     | 多个空格/制表符混合                  |
| 7   | **context aware**           | 上下文感知匹配 | 使用首尾行作为锚点，精确匹配代码块   |
| 8   | **lenient multiline**       | 容错多行匹配   | 允许部分行不匹配（70% 阈值）         |

### 策略详解

#### 1. Trimmed Boundaries（高优先级）

处理 AI 在 `oldString` 首尾添加额外空格的情况：

```typescript
// AI 提供
oldString = '  function hello() {  ';

// 实际文件
content = 'function hello() {';

// 策略：移除首尾空格后匹配
```

#### 2. Context Aware（上下文感知）

对于多行代码块，使用首尾行作为"锚点"进行匹配：

```typescript
// AI 提供
oldString = `
function test() {
  return true;
}
`;

// 策略：使用首行和尾行作为锚点
// 匹配：function test() {...} 结构
```

#### 3. Lenient Multiline（容错多行）

允许部分行不匹配，降低 AI 的精确度要求：

```typescript
// 要求：70% 的行匹配即可通过
// 适用于：AI 遗漏某些注释或格式化的情况
```

## 📊 优化效果

### 匹配成功率提升

| 场景       | 优化前 | 优化后   |
| ---------- | ------ | -------- |
| 精确匹配   | ✅     | ✅       |
| 首尾空格   | ❌     | ✅（新） |
| 换行符差异 | ✅     | ✅       |
| 缩进不一致 | ✅     | ✅       |
| 多个空格   | ❌     | ✅（新） |
| 上下文匹配 | ❌     | ✅（新） |
| 部分匹配   | ❌     | ✅（新） |

**预期成功率提升：30-50%**

## 🔍 错误提示改进

### 失败时的详细信息

```typescript
{
  found: false,
  strategies: [
    'exact match',
    'trimmed boundaries',
    'normalized line endings',
    'trimmed lines',
    'indentation flexible',
    'whitespace normalized',
    'context aware',
    'lenient multiline'
  ]
}
```

### AI 可获取的反馈

工具执行失败时，AI 会收到：

```
未找到要替换的内容: "function hello() {...}"

尝试的匹配策略:
  - exact match
  - trimmed boundaries
  - normalized line endings
  - trimmed lines
  - indentation flexible
  - whitespace normalized
  - context aware
  - lenient multiline

建议:
1. 使用 Read 工具先查看文件内容
2. 确保包含精确的缩进（空格/制表符）
3. 提供更多上下文（周围的代码行）使匹配唯一
4. 检查是否有首尾多余空格
```

### 成功时的策略信息

```typescript
{
  output: "成功替换 1 处（context aware 策略）",
  metadata: {
    matchStrategy: "context aware"  // AI 可以学习哪个策略有效
  }
}
```

## 💡 使用示例

### 示例 1：边界修剪

```typescript
// AI 可能提供（首尾有空格）
oldString = "  function hello() {\n    console.log('world');\n  }";

// 工具使用 trimmed boundaries 策略
// 自动去除首尾空格，找到匹配
```

### 示例 2：上下文感知

```typescript
// AI 提供（缺少某些内部空格）
oldString = 'function test() {\nreturn true;\n}';

// 文件实际内容
content = 'function test() {\n  return true;\n}';

// 策略：使用首尾行匹配，成功找到
```

### 示例 3：缩进灵活

```typescript
// AI 提供（2 个空格缩进）
oldString = '  function() {\n    return true;\n  }';

// 文件实际（4 个空格缩进）
content = '    function() {\n        return true;\n    }';

// 策略：忽略缩进差异，成功匹配
```

## 🎯 设计原则

### 1. 渐进式策略

从最精确到最容错：

1. 先尝试精确匹配（最快）
2. 再尝试规范化匹配（处理格式差异）
3. 最后尝试容错匹配（处理 AI 的不精确输入）

### 2. 保留原始格式

找到匹配后，返回**原始内容中的实际字符串**：

- ✅ 保留缩进
- ✅ 保留空格
- ✅ 保留换行符

### 3. 性能优化

- 短路优先：找到匹配立即返回
- 避免重复计算：缓存规范化结果
- 最小化字符串操作：直接在原始内容上定位

## 📝 代码结构

```
src/
├── utils/
│   └── edit-utils.ts        # 新增：匹配策略和工具函数
├── tools/
│   ├── edit.ts               # 优化：使用 findMatch
│   └── multiedit.ts          # 优化：使用 findMatch
```

## ✅ 验证

- ✅ TypeScript 类型检查通过
- ✅ 项目编译成功
- ✅ 与现有工具集成
- ✅ 错误提示详细

## 🚀 后续优化方向

如果需要进一步提高成功率，可以考虑：

1. **Block Anchor Replacer** - 使用 Levenshtein 距离计算相似度
2. **Escape Normalized** - 处理转义字符（\n, \t, \\ 等）
3. **Diff 集成** - 显示 diff 视图，帮助 AI 理解修改
4. **智能上下文扩展** - 自动扩展匹配范围
5. **LSP 集成** - 利用语言服务器信息辅助匹配

## 📖 参考

- **opencode 实现**: `temp/opencode/packages/opencode/src/tool/edit.ts`
- **核心思想**: 提供多种匹配策略，适应 AI 的输入变化
- **关键差异**: 保持简洁，只实现高价值策略
