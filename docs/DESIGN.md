# 内网代码编辑Agent设计方案

## 一、系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     用户交互层                                │
│  CLI工具 / VSCode插件 / Web界面                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   Agent核心层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  任务解析器   │  │  代码操作器   │  │  上下文管理器 │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                 提示词工程层                                  │
│  代码分析模板 / 编辑指令模板 / 系统提示词                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│               内网聊天API适配器                               │
│  API客户端 / 消息格式转换 / 错误处理                          │
└─────────────────────────────────────────────────────────────┘
```

## 二、核心组件设计

### 1. **API适配器层**
```typescript
interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatAPIAdapter {
  chat(messages: Message[]): Promise<string>;
  streamChat?(messages: Message[]): AsyncIterable<string>;
}
```

### 2. **代码操作器**
```typescript
interface CodeOperator {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  editFile(path: string, old: string, new: string): Promise<void>;
  searchCode(pattern: string, options?: SearchOptions): Promise<string[]>;
  analyzeFile(path: string): Promise<FileAnalysis>;
}
```

### 3. **上下文管理器**
```typescript
interface ContextManager {
  addMessage(role: 'user' | 'assistant', content: string): void;
  getContext(maxTokens?: number): Message[];
  addFileContext(filePath: string): void;
  clearContext(): void;
  getHistory(): Message[];
}
```

### 4. **任务解析器**
```typescript
interface TaskParser {
  parseEditRequest(input: string): ParsedTask;
  buildSystemPrompt(taskType: TaskType): string;
  extractCodeChanges(response: string): CodeChange[];
}
```

## 三、提示词设计

### 系统提示词模板
```typescript
const SYSTEM_PROMPT = `你是一个专业的代码编辑助手。你的职责是：
1. 理解用户的代码修改需求
2. 分析现有代码结构
3. 提供精确的代码修改建议
4. 以结构化格式返回修改方案

输出格式要求：
- 对于简单修改：直接说明修改内容
- 对于复杂修改：使用以下格式：
  \`\`\`edit
  文件路径
  --- 原始代码 ---
  [要替换的代码]
  --- 新代码 ---
  [替换后的代码]
  \`\`\`
`;
```

## 四、工作流程

```
用户输入 → 任务解析 → 收集文件上下文 → 构建完整提示词
    ↓
调用内网API → 解析API响应 → 提取代码修改 → 应用修改
    ↓
验证结果 → 反馈给用户
```

## 五、技术栈建议 (Node.js v16)

| 组件 | 推荐技术 | 说明 |
|------|---------|------|
| 运行环境 | Node.js v16 | 内网已安装 |
| 语言 | TypeScript | 类型安全，IDE支持好 |
| CLI框架 | Commander.js | 成熟的CLI框架 |
| 交互式输入 | Inquirer.js | 丰富的交互式命令行 |
| 终端输出 | Chalk + Ora | 颜色输出和加载动画 |
| HTTP客户端 | Axios (node@16) | 简单易用的HTTP库 |
| 配置管理 | dotenv + js-yaml | 环境变量和YAML配置 |
| 文件操作 | fs-extra | 增强的文件操作 |
| 测试框架 | Jest | 完整的测试解决方案 |

### npm依赖清单
```json
{
  "dependencies": {
    "commander": "^11.0.0",
    "axios": "^1.6.0",
    "inquirer": "^8.2.5",
    "chalk": "^4.1.2",
    "ora": "^5.4.1",
    "fs-extra": "^11.1.1",
    "js-yaml": "^4.1.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "typescript": "^4.9.5",
    "@types/node": "^16.18.68",
    "@types/inquirer": "^8.2.5",
    "@types/fs-extra": "^11.0.1",
    "@types/js-yaml": "^4.0.5",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.6",
    "ts-jest": "^29.1.1",
    "ts-node": "^10.9.1"
  }
}
```

## 六、关键特性

1. **上下文感知**：自动收集相关文件内容
2. **增量编辑**：支持精确的代码片段替换
3. **安全机制**：修改前备份、可回滚
4. **多轮对话**：保持对话历史支持复杂任务
5. **批量操作**：支持一次修改多个文件

## 七、项目结构

```
agent/
├── bin/
│   └── agent.js                    # CLI入口 (shebang)
├── src/
│   ├── index.ts                    # 主入口
│   ├── config/
│   │   ├── config.ts               # 配置管理
│   │   └── schema.ts               # 配置类型定义
│   ├── api/
│   │   └── adapter.ts              # API适配器
│   ├── core/
│   │   ├── code-operator.ts        # 代码操作器
│   │   ├── context-manager.ts      # 上下文管理器
│   │   └── task-parser.ts          # 任务解析器
│   ├── utils/
│   │   ├── backup.ts               # 备份工具
│   │   ├── logger.ts               # 日志工具
│   │   └── diff.ts                 # 差异对比
│   ├── commands/
│   │   ├── agent.ts                # agent命令（主命令）
│   │   └── slash-commands.ts       # 斜杠命令（内置命令）
│   └── types/
│       └── index.ts                # 全局类型定义
├── prompts/
│   ├── system.txt                  # 系统提示词
│   └── code-edit.txt               # 代码编辑提示词
├── config/
│   └── config.yaml                 # 默认配置
├── tests/
│   ├── unit/
│   └── integration/
├── backups/                        # 备份目录
├── package.json
├── tsconfig.json
├── jest.config.js
└── README.md
```

## 八、配置文件示例

```yaml
# config/config.yaml
api:
  base_url: "http://10.252.167.50:8021"
  access_key_id: "1305842310935769088"
  tx_code: "A4011LM01"
  sec_node_no: "400136"
  model: "F-G-9B-V20241220-0000-00"
  timeout: 30000  # 毫秒

agent:
  max_context_tokens: 8000
  backup_before_edit: true
  backup_dir: "./backups"
  max_file_size: 1048576  # 1MB
  max_history: 10

prompts:
  system: "./prompts/system.txt"
  code_edit: "./prompts/code-edit.txt"
```

```bash
# .env.example
# 内网API配置（可选，可通过config.yaml配置）
INTERNAL_API_BASE=http://10.252.167.50:8021
ACCESS_KEY_ID=1305842310935769088
TX_CODE=A4011LM01
SEC_NODE_NO=400136
MODEL_ID=F-G-9B-V20241220-0000-00
```

## 九、CLI命令设计

```bash
# 交互式聊天模式
agent chat
agent chat --context ./src/app.ts

# 直接编辑代码
agent edit "修复这个函数的bug"
agent edit --file ./src/app.ts "添加错误处理"

# 搜索代码
agent search "findAll函数定义"
agent search --pattern "async.*fetch"

# 配置管理
agent config init           # 初始化配置
agent config set api.key    # 设置配置项
agent config get            # 查看当前配置

# 历史记录
agent history               # 查看对话历史
agent history clear         # 清空历史
```

## 十、实施计划

### Phase 1 - 基础框架 (第1-2周)

**目标**: 搭建项目基础，实现基本CLI框架

**任务清单**:
- [ ] 初始化项目结构
- [ ] 配置TypeScript编译
- [ ] 设置package.json脚本
- [ ] 实现配置管理模块
- [ ] 实现CLI命令框架 (Commander.js)
- [ ] 实现基本的logger工具
- [ ] 编写单元测试框架

**交付物**:
- 可执行的CLI工具
- 支持config init命令
- 基础命令行框架

---

### Phase 2 - API集成 (第3-4周)

**目标**: 实现内网API调用和上下文管理

**任务清单**:
- [ ] 实现API适配器 (adapter.ts)
- [ ] 实现上下文管理器 (context-manager.ts)
- [ ] 实现任务解析器 (task-parser.ts)
- [ ] 创建系统提示词模板
- [ ] 实现agent命令基础功能
- [ ] 添加流式响应支持 (可选)

**交付物**:
- agent命令可用
- 支持多轮对话
- API调用正常工作

---

### Phase 3 - 代码操作 (第5-6周)

**目标**: 实现代码读取、编辑和搜索功能

**任务清单**:
- [ ] 实现代码操作器 (code-operator.ts)
- [ ] 实现文件读写功能
- [ ] 实现代码搜索功能 (glob + grep)
- [ ] 实现代码编辑功能
- [ ] 实现备份工具 (backup.ts)
- [ ] 实现差异对比 (diff.ts)

**交付物**:
- agent edit命令可用
- agent search命令可用
- 安全的备份机制

---

### Phase 4 - 增强功能 (第7-8周)

**目标**: 完善功能，提升用户体验

**任务清单**:
- [ ] 交互式确认机制 (Inquirer.js)
- [ ] 美化终端输出 (Chalk + Ora)
- [ ] 添加历史记录管理
- [ ] 支持多文件批量操作
- [ ] 添加错误重试机制
- [ ] 编写完整测试用例
- [ ] 编写使用文档

**交付物**:
- 功能完整的CLI工具
- 完善的文档和测试

---

### Phase 5 - 优化与扩展 (可选)

**任务清单**:
- [ ] 性能优化 (大文件处理)
- [ ] 支持自定义提示词
- [ ] 添加代码模板功能
- [ ] 支持项目索引 (代码库分析)
- [ ] VSCode扩展 (长期目标)

## 十一、关键代码示例

### API适配器示例
```typescript
// src/api/adapter.ts
import axios from 'axios';

// 内网API配置接口
interface APIConfig {
  base_url: string;
  access_key_id: string;
  tx_code: string;
  sec_node_no: string;
  model: string;
}

// 消息类型
interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// API请求体
interface InternalAPIRequest {
  user_id?: string;
  messages: Message[];
  stream: boolean;
  echo?: boolean;
  model_config: {
    model: string;
    repetition_penalty?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
  };
}

// API响应体
interface InternalAPIResponse {
  'C-API-Status': string;
  'C-Response-Code': string;
  'C-Response-Desc': string;
  'C-Response-Body': {
    codeid: string;
    'Data_Enqr_Rslt': string;
  };
}

// 解析后的结果
interface ParsedResult {
  traceId: string;
  choices: Array<{
    finish_reason: string;
    messages: {
      content: string;
      role: string;
    };
  }>;
  usage: {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
  };
}

export class ChatAPIAdapter {
  private config: APIConfig;

  constructor(config: APIConfig) {
    this.config = config;
  }

  /**
   * 发送聊天请求
   */
  async chat(messages: Message[]): Promise<string> {
    const traceId = this.generateTraceId();
    const serialNo = this.generateSerialNo();

    // 构建内层请求体
    const innerRequest: InternalAPIRequest = {
      messages,
      stream: false,
      model_config: {
        model: this.config.model,
        repetition_penalty: 1.1,
        temperature: 0.7,
        top_p: 0.8,
        top_k: 20,
      },
    };

    // 构建外层请求体（Data_cntnt需要JSON字符串化）
    const requestBody = {
      Data_cntnt: JSON.stringify(innerRequest),
      Fst_Attr_Rmrk: this.config.access_key_id,
    };

    try {
      const response = await axios.post<InternalAPIResponse>(
        `${this.config.base_url}/ai-service/ainlpllm/chat`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'Access_Key_Id': this.config.access_key_id,
            'Tx-Code': this.config.tx_code,
            'Sec-Node-No': this.config.sec_node_no,
            'Trace-Id': traceId,
            'Tx-Serial-No': serialNo,
          },
          timeout: 30000,
        }
      );

      // 检查API状态
      if (response.data['C-API-Status'] !== '00') {
        throw new Error(
          `API错误: ${response.data['C-Response-Desc']} (${response.data['C-Response-Code']})`
        );
      }

      // 检查业务状态
      const responseBody = response.data['C-Response-Body'];
      if (responseBody.codeid !== '20000') {
        throw new Error(`业务错误: codeid=${responseBody.codeid}`);
      }

      // 解嵌套的JSON字符串
      const result: ParsedResult = JSON.parse(responseBody['Data_Enqr_Rslt']);

      // 返回AI回复内容
      return result.choices[0].messages.content;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `API调用失败: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  /**
   * 生成追踪ID
   */
  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 生成序列号
   */
  private generateSerialNo(): string {
    return `${Date.now()}`;
  }
}
```

### 代码操作器示例
```typescript
// src/core/code-operator.ts
import fs from 'fs-extra';
import { diffLines } from 'diff';

export class CodeOperator {
  async readFile(path: string): Promise<string> {
    try {
      return await fs.readFile(path, 'utf-8');
    } catch (error) {
      throw new Error(`读取文件失败: ${path}`);
    }
  }

  async editFile(
    path: string,
    oldContent: string,
    newContent: string
  ): Promise<void> {
    const content = await this.readFile(path);
    if (!content.includes(oldContent)) {
      throw new Error('未找到要替换的代码');
    }

    const newFileContent = content.replace(oldContent, newContent);
    await fs.writeFile(path, newFileContent, 'utf-8');
  }

  showDiff(oldContent: string, newContent: string): string {
    return diffLines(oldContent, newContent)
      .map(part => {
        const prefix = part.added ? '+' : part.removed ? '-' : ' ';
        return prefix + part.value;
      })
      .join('');
  }
}
```

### CLI主入口示例
```typescript
// src/index.ts
#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { chatCommand } from './commands/chat';
import { editCommand } from './commands/edit';
import { searchCommand } from './commands/search';
import { configCommand } from './commands/config';

const program = new Command();

program
  .name('agent')
  .description('内网代码编辑助手')
  .version('1.0.0');

program.addCommand(chatCommand);
program.addCommand(editCommand);
program.addCommand(searchCommand);
program.addCommand(configCommand);

program.parse();
```
