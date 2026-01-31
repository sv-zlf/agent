# API 双模式实现总结

## 📋 实现概述

GG CODE 现在支持两种 API 模式：
1. **A4011LM01** - 内网 API（原有模式）
2. **OpenApi** - 标准 OpenAPI 格式（新增）

## 🔧 核心变更

### 1. 类型系统更新 (`src/types/index.ts`)

新增 API 模式类型和配置接口：

```typescript
// API 模式类型
export type APIMode = 'A4011LM01' | 'OpenApi';

// 内网 API 配置
export interface InternalAPIConfig {
  base_url: string;
  access_key_id: string;
  tx_code: string;
  sec_node_no: string;
  model: string;
  timeout?: number;
}

// OpenAPI 配置
export interface OpenAPIConfig {
  base_url: string;
  api_key: string;
  model: string;
  timeout?: number;
}

// 联合配置类型
export type APIConfig = InternalAPIConfig & {
  mode?: APIMode;
};
```

### 2. 新增 OpenAPI 适配器 (`src/api/openapi-adapter.ts`)

实现标准的 OpenAI API 格式适配器：

```typescript
export class OpenAPIAdapter {
  async chat(messages: Message[], options?: {
    temperature?: number;
    topP?: number;
    abortSignal?: AbortSignal;
  }): Promise<string> {
    const requestBody: OpenAPIRequest = {
      model: this.config.model,
      messages,
      temperature: options?.temperature ?? 0.7,
      top_p: options?.topP ?? 0.8,
      stream: false,
    };

    const response = await axios.post<OpenAPIResponse>(
      `${this.config.base_url}/chat/completions`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.api_key}`,
        },
      }
    );

    return response.data.choices[0].message.content;
  }
}
```

### 3. 重构内网 API 适配器

将原 `adapter.ts` 重命名为 `internal-adapter.ts`，并更新类名：

```typescript
// 之前：ChatAPIAdapter
// 现在：InternalAPIAdapter
export class InternalAPIAdapter { ... }
```

### 4. 统一适配器工厂 (`src/api/index.ts`)

创建 `APIAdapterFactory` 类，根据配置自动选择适配器：

```typescript
export class APIAdapterFactory {
  create(): IAPIAdapter {
    const mode = this.options.mode || 'live';
    const apiMode = this.config.mode || 'A4011LM01';

    switch (mode) {
      case 'live':
        if (apiMode === 'OpenApi') {
          return new OpenAPIAdapter(this.config);
        } else {
          return new InternalAPIAdapter(this.config);
        }
      // ...
    }
  }

  getAPIMode(): APIMode {
    return this.config.mode || 'A4011LM01';
  }
}
```

### 5. 配置系统更新 (`src/config/schema.ts`)

支持两种模式的配置和验证：

```typescript
const DEFAULT_CONFIG: AgentConfig = {
  api: {
    mode: (process.env.API_MODE as 'A4011LM01' | 'OpenApi') || 'A4011LM01',
    base_url: process.env.INTERNAL_API_BASE || '...',
    access_key_id: process.env.ACCESS_KEY_ID || '...',
    // ...
  },
};

validate(): { valid: boolean; errors: string[] } {
  const apiMode = this.config.api.mode || 'A4011LM01';

  if (apiMode === 'OpenApi') {
    // 验证 OpenAPI 所需字段
    if (!this.config.api.api_key) {
      errors.push('OpenAPI 模式需要 api_key');
    }
  } else {
    // 验证内网 API 所需字段
    // ...
  }
}
```

## 📁 文件结构

```
src/
├── api/
│   ├── internal-adapter.ts    # 内网 API 适配器（原 adapter.ts）
│   ├── openapi-adapter.ts      # OpenAPI 适配器（新增）
│   ├── mock-api-adapter.ts     # Mock 适配器
│   ├── recording-api-adapter.ts # 录制/回放适配器
│   └── index.ts                # 统一导出和工厂类
├── types/
│   └── index.ts                # 类型定义（新增 APIMode 等）
└── config/
    └── schema.ts               # 配置管理（更新验证逻辑）

config/
└── .env.example               # 环境变量示例

scripts/
└── test-api-mode.js           # API 模式测试脚本（新增）

docs/
└── API_MODES.md               # 本文档
```

## 🚀 使用方式

### 配置文件方式

```json
{
  "api": {
    "mode": "OpenApi",
    "base_url": "https://open.bigmodel.cn/api/paas/v4",
    "api_key": "your_api_key",
    "model": "glm-4.7"
  }
}
```

### 环境变量方式

```bash
export API_MODE=OpenApi
export OPENAPI_BASE=https://open.bigmodel.cn/api/paas/v4
export OPENAPI_KEY=your_api_key
export MODEL_ID=glm-4.7
```

### 代码方式

```typescript
import { createAPIAdapterFactory } from './api';

const factory = createAPIAdapterFactory({
  mode: 'OpenApi',
  base_url: 'https://open.bigmodel.cn/api/paas/v4',
  api_key: 'your_api_key',
  model: 'glm-4.7',
});

const adapter = factory.create();
const response = await adapter.chat(messages);
```

## 🧪 测试

运行 API 模式测试：

```bash
npm run build
npm run test:api
```

编辑 `scripts/test-api-mode.js` 启用需要测试的模式。

## 📚 相关文档

- [CONFIG.md](../CONFIG.md) - 详细配置说明
- [INSTALL.md](docs/INSTALL.md) - 安装指南
- [README.md](../README.md) - 项目说明

## ✅ 兼容性

- ✅ 向后兼容：现有配置继续有效
- ✅ 默认模式：A4011LM01（内网模式）
- ✅ 灵活切换：通过配置文件或环境变量切换
- ✅ 标准兼容：OpenAPI 模式兼容所有 OpenAI 格式的服务

## 🎯 支持的 OpenAPI 服务

- 智谱 AI (GLM-4)
- OpenAI (GPT-4, GPT-3.5)
- Azure OpenAI
- 通义千问
- DeepSeek
- Moonshot
- 其他所有兼容 OpenAI API 格式的服务
