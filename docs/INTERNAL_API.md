# 内网 AI 聊天 API 接口文档

## 接口信息

| 项目 | 值 |
|------|-----|
| 接口地址 | `POST /A4011LM01` |
| 交易码 | A4011LM01 |
| 功能描述 | 执行大语言模型推理任务，支持同步、流式/非流式调用 |

## 环境配置

### 环境要求
- 协议要求：HTTP/HTTPS
- 请求超时：同步模式 ≤ 60s
- 接入流程参考：《人工智能接口使用说明及接入流程》

### 测试环境
| 配置项 | 值 |
|--------|-----|
| AK (Access Key) | 1305842310935769088（临时，接入后需申请正式AK） |
| 请求频率限制 | ≤ 3 QPS（资源紧张，请控制频率） |

### 生产环境
| 配置项 | 值 |
|--------|-----|
| AK | 参考《人工智能接口使用说明及接入流程》申请 |
| 限流规则 | 基于 AK 实现 TPM 维度的限流 |
| 流量预报 | 新增流量需 T-14 进行沟通 |

## 认证信息

| Header 字段 | 值 | 说明 |
|-------------|-----|------|
| Access_Key_Id | AK 值 | 访问密钥ID |
| Tx-Code | A4011LM01 | 交易代码 |
| Sec-Node-No | 安全节点号 | 安全节点编号 |
| Trace-Id | 唯一ID | 追踪ID，每次请求唯一 |
| Tx-Serial-No | 序列号 | 交易序列号 |

## 请求格式

### 请求体结构

```json
{
  "Data_cntnt": "REQUEST_JSON_STRING",
  "Fst_Attr_Rmrk": "AK_VALUE"
}
```

### Data_cntnt 内部结构（JSON 字符串）

```json
{
  "user_id": "optional_user_id",
  "messages": [
    {
      "role": "system",
      "content": "System Prompt，可设定角色，如：你是有帮助的AI助手"
    },
    {
      "role": "user",
      "content": "User Prompt，用户指令，如：写一首春天的诗"
    },
    {
      "role": "assistant",
      "content": "Assistant 的回复内容"
    },
    {
      "role": "tool",
      "content": "工具的输出信息"
    }
  ],
  "stream": false,
  "echo": false,
  "model_config": {
    "model": "MODEL_ID",
    "repetition_penalty": 1.05,
    "temperature": 0.95,
    "top_p": 0.9,
    "top_k": 20,
    "max_tokens": 2048
  }
}
```

### 请求参数说明

#### 基础参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| user_id | string | 否 | - | 用户ID（行内：员工编号；行外：客户编号） |
| messages | object[] | 是 | - | 对话消息列表（含历史对话） |
| stream | boolean | 否 | false | 流式开关 |
| echo | boolean | 否 | false | 返回历史对话开关 |

#### messages 参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| role | string | 是 | system（可选）：系统提示词，放在 messages 列表第一位<br>user：用户发送的消息<br>assistant：模型回复的消息<br>tool：工具的输出信息 |
| content | string | 是 | 长度 < 选用模型的上下文长度 |

**注意**：最新的历史对话信息请放在数组对象最后。

#### model_config 参数

| 参数 | 类型 | 必填 | 默认值 | 约束说明 |
|------|------|------|--------|----------|
| model | string | 是 | - | 合法模型ID（见附录） |
| repetition_penalty | float | 否 | 1.05 | 控制模型生成文本时的内容重复度。越高越不会输出重复内容。<br>推荐区间：(1.0, 2.0] |
| max_tokens | integer | 否 | - | 本次请求返回的最大token数。需要限制模型输出时设置该字段，一般无需设置（特别是输入较长的场景），默认为当前模型能支持的最大输出长度。<br>注：prompt_tokens + max_tokens > 模型上下文会推理失败 |
| temperature | float | 否 | 0.95 | 采样温度，控制输出的随机性。值越大，生成的文本更多样；值越小，生成的文本更确定。<br>取值范围：(0, 1.0] |
| top_p | float | 否 | 0.9 | 核采样的概率阈值，控制模型生成文本的多样性。top_p 越高，生成的文本更多样，反之，生成的文本更确定。<br>取值范围：(0.0, 1.0] |

**注意**：top_p 与 temperature 均可以控制生成文本的多样性，因此建议您只设置其中一个值。

| 参数 | 类型 | 必填 | 默认值 | 约束说明 |
|------|------|------|--------|----------|
| top_k | integer | 否 | 20 | 从 k 个候选 token 中挑选生成内容，K 越大，模型预测时候选值越多。<br>取值范围：[1, 50]，大于 50 会被修改为 50 |

#### Tool Calling 参数（仅 Qwen3 支持）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| tools | object[] | 否 | 可供模型选择的工具数组，tools 功能目前仅适配 Qwen3 |
| tools[].type | string | 是 | tools 的类型，当前仅支持传入 'function' |
| tools[].function | object | 是 | 工具函数详情 |
| tools[].function.name | string | 是 | 工具函数的名称，必须是字母、数字 |
| tools[].function.description | string | 是 | 工具函数的描述 |
| tools[].function.parameters | object | 是 | 工具函数的参数描述，结构需为一个合法的 JSON Schema |
| tool_choice | string | 否 | "auto" | 模型采取的工具选择策略：<br>"auto" - 由大模型进行选择<br>"none" - 无论输入什么问题，都不进行工具调用<br>"required" - 强制使用工具调用<br>{"type": "function", "function": {"name": "the_function_to_call"}} - 强制调用某个工具 |

#### 其他参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| enable_thinking | boolean | 否 | false | 是否开启推理思考模式，默认关闭（除 qwen3-32B 默认开启），当前仅适配 qwen3 |

## 响应格式

### 顶层报文结构

| 参数名 | 参数类型 | 描述 |
|--------|----------|------|
| C-Response-Body | json | 响应体，详见下方 C-Response-Body 响应体字段说明 |
| C-Response-Code | string | 响应码，000000000000：成功 |
| C-Response-Desc | string | 响应描述 |
| C-API-Status | string | 响应状态，00：成功 01：失败 |

### C-Response-Body 响应参数说明

| 字段项目名称 | 中文名称 | 数据类型 | 必填 | 说明 |
|-------------|---------|---------|------|------|
| Data_Enqr_Rslt | 数据项查询结果 | string | 是 | 返回的数据，内容为字符串。具体见下方 Data_Enqr_Rslt 规范 |
| codeid | 代码编号 | string | 是 | 大模型服务的成功失败状态码，错误码详情可见下方响应状态码列表。<br>20000：成功，其他：失败 |

### Data_Enqr_Rslt 响应结构

#### 完整数据结构

```json
{
  "codeid": "20000",
  "Data_Enqr_Rslt": "RESULT_JSON_STRING"
}
```

#### JSON 格式展示（实际返回为 JSON 字符串格式）

```json
{
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "message": {
        "reasoning_content": "仅推理模型存在的推理过程输出",
        "content": "1+1等于2。",
        "role": "assistant",
        "tool_calls": []
      }
    }
  ],
  "created": 1750928176956,
  "notes": "提示: 接口传入模型名称成功匹配模型列表！",
  "traceId": "UNIQUE_TRACE_ID",
  "usage": {
    "completion_tokens": 7,
    "prompt_tokens": 17,
    "total_tokens": 24
  }
}
```

### Data_Enqr_Rslt 字段详情

| 参数 | 类型 | 示例 | 说明 |
|------|------|------|------|
| traceId | string | "1234" | 业务流水id |
| notes | string | "模型匹配成功" | 提示信息，展示模型名称是否匹配 |
| created | int64 | 17098670941 | Unix 毫秒时间戳 |
| choices | object[] | - | 响应结果集 |
| choices[].finish_reason | string | "stop" | 模型推理终止的原因：<br>stop - 代表推理自然结束<br>length - 代表到达 tokens 长度上限<br>tool_calls - 需要调用工具而结束 |
| choices[].index | integer | 0 | 结果索引 |
| choices[].message | object | - | 消息内容 |
| choices[].message.role | string | "assistant" | 角色标识 |
| choices[].message.content | string | "2" | 模型输出内容 |
| choices[].message.reasoning_content | string | "推理过程..." | 深度思考模型特有的推理过程中思维链的响应 |
| choices[].message.tool_calls | object[] | [] | 工具调用信息 |
| choices[].message.tool_calls[].id | string | "id-123" | 本次工具响应的 id |
| choices[].message.tool_calls[].type | string | "function" | 工具的类型，当前只支持 "function" |
| choices[].message.tool_calls[].function | object | - | 需要被调用的函数 |
| choices[].message.tool_calls[].function.name | string | - | 需要被调用的函数名称 |
| choices[].message.tool_calls[].function.arguments | string | - | 需要传入被调用函数的参数，为 JSON 字符串 |
| usage | object | - | 本次模型调用的 tokens 数统计（流式响应的 usage 只在最后一个响应体） |
| usage.prompt_tokens | integer | 15 | 输入 token 数 |
| usage.completion_tokens | integer | 25 | 输出 token 数 |
| usage.total_tokens | integer | 40 | 总 token 数 |
| history_messages | array | [["Q", "A"], ["Q", "A"]] | 历史对话信息（流式响应无返回该字段） |

## 响应状态码列表

### C-API-Status

| 值 | 含义 |
|-----|------|
| 00 | 成功 |
| 01 | 失败 |

### codeid

| 值 | 含义 |
|-----|------|
| 20000 | 成功 |
| 其他 | 业务处理失败 |

## 完整请求示例

### curl 示例

```bash
curl -X POST "http://api-endpoint/A4011LM01" \
-H "Content-Type: application/json" \
-H "Access_Key_Id: 1305842310935769088" \
-H "Tx-Code: A4011LM01" \
-H "Sec-Node-No: 400136" \
-H "Trace-Id: UNIQUE_TRACE_ID" \
-H "Tx-Serial-No: SEQUENCE_NUMBER" \
-d '{
  "Data_cntnt": "{\"messages\":[{\"role\":\"user\",\"content\":\"1+1等于几\"}],\"stream\":false,\"model_config\":{\"model\":\"F-G-9B-V20241220-0000-00\"}}",
  "Fst_Attr_Rmrk": "1305842310935769088"
}'
```

### Node.js Axios 示例

```typescript
import axios from 'axios';

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

interface ChatRequest {
  user_id?: string;
  messages: Message[];
  stream?: boolean;
  echo?: boolean;
  enable_thinking?: boolean;
  model_config: {
    model: string;
    repetition_penalty?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    max_tokens?: number;
  };
  tools?: any[];
  tool_choice?: string | object;
}

interface ChatResponse {
  'C-API-Status': string;
  'C-Response-Code': string;
  'C-Response-Desc': string;
  'C-Response-Body': {
    codeid: string;
    'Data_Enqr_Rslt': string;
  };
}

async function chat(messages: Message[]): Promise<string> {
  const traceId = generateTraceId();
  const serialNo = generateSerialNo();

  const requestBody = {
    Data_cntnt: JSON.stringify({
      messages,
      stream: false,
      model_config: {
        model: "F-G-9B-V20241220-0000-00",
        repetition_penalty: 1.05,
        temperature: 0.95,
        top_p: 0.9,
        top_k: 20
      }
    }),
    Fst_Attr_Rmrk: "1305842310935769088"
  };

  const response = await axios.post<ChatResponse>(
    'http://api-endpoint/A4011LM01',
    requestBody,
    {
      headers: {
        'Content-Type': 'application/json',
        'Access_Key_Id': '1305842310935769088',
        'Tx-Code': 'A4011LM01',
        'Sec-Node-No': '400136',
        'Trace-Id': traceId,
        'Tx-Serial-No': serialNo
      }
    }
  );

  // 检查响应状态
  if (response.data['C-API-Status'] !== '00') {
    throw new Error(`API错误: ${response.data['C-Response-Desc']}`);
  }

  // 检查业务状态码
  if (response.data['C-Response-Body'].codeid !== '20000') {
    throw new Error(`业务错误: codeid=${response.data['C-Response-Body'].codeid}`);
  }

  // 解嵌套的JSON字符串
  const resultBody = JSON.parse(response.data['C-Response-Body']['Data_Enqr_Rslt']);

  return resultBody.choices[0].message.content;
}

function generateTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateSerialNo(): string {
  return `${Date.now()}`;
}
```

## 注意事项

1. **双 JSON 序列化**：
   - `Data_cntnt` 是 JSON 字符串，需要 JSON.stringify()
   - `Data_Enqr_Rslt` 也是 JSON 字符串，需要 JSON.parse()

2. **追踪ID**：每次请求需要生成唯一的 `Trace-Id`

3. **消息顺序**：最新的历史对话信息请放在 messages 数组的最后

4. **模型ID**：需要使用正确的模型ID，参考模型列表附录

5. **参数选择**：top_p 与 temperature 建议只设置其中一个

6. **流式响应**：流式响应的 usage 只在最后一个响应体中返回

7. **tool_calls**：工具调用功能目前仅适配 Qwen3 模型

8. **推理模式**：enable_thinking 参数当前仅适配 qwen3 模型，qwen3-32B 默认开启

9. **Token 限制**：prompt_tokens + max_tokens 不能超过模型上下文长度

10. **频率限制**：测试环境 ≤ 3 QPS，生产环境基于 AK 的 TPM 限流
