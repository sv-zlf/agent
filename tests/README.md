# 工具系统测试

本目录包含工具系统的测试套件，用于验证工具注册、描述加载、执行等功能。

## 测试文件结构

```
tests/
├── tools.test.ts              # 主测试套件（Jest）
├── tools/
│   └── prompt-loader.test.ts  # 提示词加载器测试
└── temp/                      # 临时测试目录（自动创建）
```

## 快速测试

### 运行所有测试
```bash
npm test
```

### 运行工具系统快速测试
```bash
npm run test:tools
```

这个脚本会：
- ✓ 测试工具注册（13个工具）
- ✓ 测试提示词加载（从 `prompts/tools/*.txt`）
- ✓ 测试工具执行（Glob、Read 等）
- ✓ 测试工具引擎功能
- ✓ 测试错误处理和参数验证

### 运行测试并生成覆盖率报告
```bash
npm run test:coverage
```

### 监视模式（开发时使用）
```bash
npm run test:watch
```

## 测试脚本

### 1. 快速测试脚本
**文件**: `scripts/test-tools-simple.js`

快速验证工具系统基本功能，无需 Jest 依赖。

```bash
npm run build          # 先编译
npm run test:tools     # 运行测试
```

### 2. 完整测试套件
**文件**: `tests/tools.test.ts`

使用 Jest 框架的完整测试套件。

```bash
npm test               # 运行所有 Jest 测试
```

### 3. TypeScript 测试脚本
**文件**: `scripts/test-tools.ts`

使用 ts-node 直接运行的测试脚本。

```bash
npx ts-node scripts/test-tools.ts
```

## 测试覆盖

### 工具注册测试
- ✓ 工具数量验证（13个）
- ✓ 必需工具存在性
- ✓ 工具权限配置
- ✓ 工具分类设置

### 提示词加载测试
- ✓ 从文件加载提示词
- ✓ 提示词内容完整性
- ✓ 缓存机制
- ✓ 批量加载
- ✓ 文件不存在处理

### 工具执行测试
- ✓ Glob 工具文件搜索
- ✓ Read 工具文件读取
- ✓ Write 工具文件写入
- ✓ Edit 工具文件编辑
- ✓ 错误处理
- ✓ 参数验证

### 工具引擎功能测试
- ✓ 工具注册
- ✓ 工具查询
- ✓ 类别查询
- ✓ 批量操作

## 开发工作流

### 1. 修改工具后验证
```bash
# 1. 编译
npm run build

# 2. 运行快速测试
npm run test:tools

# 3. 如果测试通过，提交代码
git add .
git commit -m "feat: update tool"
```

### 2. 添加新工具时
1. 在 `src/tools/` 创建工具文件
2. 在 `prompts/tools/` 创建对应的 `.txt` 提示词文件
3. 在 `src/tools/index.ts` 导出新工具
4. 运行测试验证：
   ```bash
   npm run build
   npm run test:tools
   ```

### 3. 修改提示词后
1. 编辑 `prompts/tools/*.txt` 文件
2. 运行测试验证加载：
   ```bash
   npm run build
   npm run test:tools
   ```

## 测试输出示例

```
🧪 GG CODE 工具系统测试

🔧 设置测试环境...

📦 测试工具注册...
  ✓ 注册了 13 个工具
  ✓ 工具列表: Read, Write, Edit, Glob, Grep, Bash, ...

📄 测试提示词加载...
  ✓ 生成了 267 字符的描述
  ✓ 包含 15 行
  ✓ 包含 read: 是
  ✓ 包含 write: 是

⚙️ 测试工具执行...
  ✓ Glob 找到 2 个文件
  ✓ Read 成功读取文件
  ✓ 错误处理正常
  ✓ 参数验证正常

🔍 测试工具引擎功能...
  ✓ 引擎中有 13 个工具
  ✓ 文件类工具: 3 个
  ✓ 工具查询: 成功

============================================================
📊 测试总结
============================================================
总计: 15 | 通过: 15 | 失败: 0
成功率: 100.0%
============================================================
✅ 所有测试通过！
⏱️ 总耗时: 523ms
```

## 故障排查

### 测试失败：找不到工具
**原因**: 工具未在 `src/tools/index.ts` 中导出

**解决**: 确保新工具已添加到 `tools` 对象和导出列表

### 测试失败：提示词文件不存在
**原因**: `prompts/tools/*.txt` 文件缺失

**解决**: 创建对应的提示词文件

### 测试失败：编译错误
**原因**: TypeScript 编译失败

**解决**: 运行 `npm run build` 查看详细错误信息

## CI/CD 集成

在 CI 管道中运行测试：

```yaml
- name: Build
  run: npm run build

- name: Run tests
  run: npm run test:tools
```

## 贡献指南

添加新测试时：
1. 使用 `describe` 分组相关测试
2. 使用 `it` 描述单个测试用例
3. 测试名称应该清晰描述测试内容
4. 每个测试应该独立运行
5. 使用 `beforeEach`/`afterEach` 进行设置/清理
6. 测试失败时提供清晰的错误信息
