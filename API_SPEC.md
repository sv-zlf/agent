# 内网AI聊天API接口规范

## API基本信息

| 项目 | 值 |
|------|-----|
| 接口地址 | `http://10.252.167.50:8021/ai-service/ainlpllm/chat` |
| 请求方法 | POST |
| Content-Type | application/json |

## 认证信息

| Header字段 | 值 | 说明 |
|------------|-----|------|
| Access_Key_Id | 1305842310935769088 | 访问密钥ID |
| Tx-Code | A4011LM01 | 交易代码 |
| Sec-Node-No | 400136 | 安全节点号 |
| Trace-Id | 唯一ID | 追踪ID，每次请求唯一 |
| Tx-Serial-No | 序列号 | 交易序列号 |

## 请求格式

### 请求体结构
```json
{
  "Data_cntnt": "JSON_STRING",
  "Fst_Attr_Rmrk": "AK_VALUE"
}
```

### Data_cntnt内部结构（JSON字符串化）
```json
{
  "user_id": "optional_user_id",
  "messages": [
    {
      "role": "system",
      "content": "System Prompt，可设定角色"
    },
    {
      "role": "user",
      "content": "User Prompt，用户指令"
    }
  ],
  "stream": false,
  "echo": false,
  "model_config": {
    "model": "MODEL_ID",
    "repetition_penalty": 1.1,
    "temperature": 0.7,
    "top_p": 0.8,
    "top_k": 20
  }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | string | 否 | 用户ID |
| messages | array | 是 | 消息数组 |
| messages[].role | string | 是 | system/user/assistant |
| messages[].content | string | 是 | 消息内容 |
| stream | boolean | 否 | 是否流式返回，默认false |
| echo | boolean | 否 | 是否回显，默认false |
| model_config | object | 是 | 模型配置 |
| model_config.model | string | 是 | 模型ID，如 F-G-9B-V20241220-0000-00 |
| model_config.repetition_penalty | number | 否 | 重复惩罚，默认1.1 |
| model_config.temperature | number | 否 | 温度参数，默认0.7 |
| model_config.top_p | number | 否 | top_p采样，默认0.8 |
| model_config.top_k | number | 否 | top_k采样，默认20 |

## 响应格式

### 响应体结构
```json
{
  "C-API-Status": "00",
  "C-Response-Code": "000000000000",
  "C-Response-Desc": "成功",
  "C-Response-Body": {
    "codeid": "20000",
    "Data_Enqr_Rslt": "JSON_STRING"
  }
}
```

### Data_Enqr_Rslt内部结构（JSON字符串化）
```json
{
  "traceId": "UNIQUE_TRACE_ID",
  "notes": "提示信息",
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "messages": {
        "content": "AI回复内容",
        "role": "assistant"
      }
    }
  ],
  "created": 1751010428862,
  "usage": {
    "completion_tokens": 5,
    "prompt_tokens": 10,
    "total_tokens": 29
  }
}
```

### 响应字段说明

| 字段 | 说明 |
|------|------|
| C-API-Status | API状态码，"00"表示成功 |
| C-Response-Code | 响应代码 |
| C-Response-Desc | 响应描述 |
| C-Response-Body.codeid | 业务代码，"20000"表示成功 |
| choices | AI生成结果数组 |
| choices[0].messages.content | AI回复的内容 |
| usage.completion_tokens | 生成的token数 |
| usage.prompt_tokens | 输入的token数 |
| usage.total_tokens | 总token数 |

## 完整请求示例

### curl示例
```bash
curl -X POST "http://10.252.167.50:8021/ai-service/ainlpllm/chat" \
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

### Node.js Axios示例
```typescript
import axios from 'axios';

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  user_id?: string;
  messages: Message[];
  stream?: boolean;
  echo?: boolean;
  model_config: {
    model: string;
    repetition_penalty?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
  };
}

interface ChatResponse {
  C-API-Status: string;
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
        repetition_penalty: 1.1,
        temperature: 0.7,
        top_p: 0.8,
        top_k: 20
      }
    }),
    Fst_Attr_Rmrk: "1305842310935769088"
  };

  const response = await axios.post<ChatResponse>(
    'http://10.252.167.50:8021/ai-service/ainlpllm/chat',
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

  // 解嵌套的JSON字符串
  const resultBody = JSON.parse(response.data['C-Response-Body']['Data_Enqr_Rslt']);

  return resultBody.choices[0].messages.content;
}

function generateTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateSerialNo(): string {
  return `${Date.now()}`;
}
```

## 错误处理

| C-API-Status | 含义 |
|--------------|------|
| 00 | 成功 |
| 非00 | API调用失败 |

| codeid | 含义 |
|--------|------|
| 20000 | 成功 |
| 其他 | 业务处理失败 |

## 注意事项

1. **JSON字符串化**: `Data_cntnt` 和 `Data_Enqr_Rslt` 都是JSON字符串，需要额外解析
2. **追踪ID**: 每次请求需要生成唯一的 `Trace-Id`
3. **模型ID**: 需要使用正确的模型ID，如 `F-G-9B-V20241220-0000-00`
4. **双层数据**: 响应数据有两层嵌套需要解析
