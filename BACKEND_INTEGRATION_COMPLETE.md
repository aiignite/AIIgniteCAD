# 后端CAD引擎集成完成

## 更新内容

### 1. 复制文件到后端 ✅

已复制以下文件到后端：
- `services/cadEngine/registry.ts` → `backend/src/services/cadEngine/registry.ts`
- `services/cadEngine/geometry.ts` → `backend/src/services/cadEngine/geometry.ts`
- `services/cadEngine/primitives.ts` → `backend/src/services/cadEngine/primitives.ts`
- `services/aiEngine/capabilitiesGenerator.ts` → `backend/src/services/aiEngine/capabilitiesGenerator.ts` (已修改)

### 2. 更新 llmChat.ts ✅

**文件位置**: `backend/src/routes/llmChat.ts`

**修改内容**:

1. **导入CAD能力生成器**:
```typescript
import { generateCompactCapabilitiesPrompt } from "../services/aiEngine/capabilitiesGenerator";
```

2. **检测CAD助手** (line ~20-35):
```typescript
let systemPrompt: string | undefined;
let isCADAssistant = false;

if (assistantId) {
  const assistant = await prisma.assistant.findFirst({...});
  
  // Check if this is a CAD assistant
  if (assistant.id === 'cad-designer-id' || 
      assistant.name.toLowerCase().includes('cad')) {
    isCADAssistant = true;
    systemPrompt = generateCompactCapabilitiesPrompt();
    console.log('[CAD Assistant] Injecting CAD capabilities into prompt');
  }
}
```

3. **更新流式函数签名**:
```typescript
// Ollama
async function streamChatWithOllama(
  message: string,
  model: any,
  res: Response,
  systemPrompt?: string  // ✅ 新增参数
): Promise<void>

// Google Gemini
async function streamChatWithGoogle(
  message: string,
  model: any,
  apiKey: string,
  res: Response,
  systemPrompt?: string  // ✅ 新增参数
): Promise<void>

// OpenAI
async function streamChatWithOpenAI(
  message: string,
  model: any,
  apiKey: string,
  res: Response,
  systemPrompt?: string  // ✅ 新增参数
): Promise<void>

// Anthropic
async function streamChatWithAnthropic(
  message: string,
  model: any,
  apiKey: string,
  res: Response,
  systemPrompt?: string  // ✅ 新增参数
): Promise<void>
```

4. **在请求中包含系统提示词**:

**Ollama** (line ~115-140):
```typescript
const messages = [];
if (systemPrompt) {
  messages.push({
    role: "system",
    content: systemPrompt,
  });
}
messages.push({
  role: "user",
  content: message,
});

const response = await fetch(`${apiUrl}/api/chat`, {
  body: JSON.stringify({
    model: modelId,
    messages,
    stream: true
  })
});
```

**Google Gemini** (line ~220-245):
```typescript
const requestBody: any = {
  contents: [
    {
      parts: [{ text: message }],
    },
  ],
};

if (systemPrompt) {
  requestBody.systemInstruction = {
    parts: [{ text: systemPrompt }],
  };
}

const response = await fetch(
  `${apiUrl}/${modelId}:streamGenerateContent?key=${apiKey}`,
  {
    method: "POST",
    body: JSON.stringify(requestBody),
  }
);
```

**OpenAI** (line ~310-335):
```typescript
const messages = [];
if (systemPrompt) {
  messages.push({
    role: "system",
    content: systemPrompt,
  });
}
messages.push({
  role: "user",
  content: message,
});

const response = await fetch(`${apiUrl}/chat/completions`, {
  body: JSON.stringify({
    model: modelId,
    messages,
    stream: true,
  })
});
```

**Anthropic** (line ~395-420):
```typescript
const requestBody: any = {
  model: modelId,
  max_tokens: 128000,
  messages: [
    {
      role: "user",
      content: message,
    },
  ],
  stream: true,
};

if (systemPrompt) {
  requestBody.system = systemPrompt;
}

const response = await fetch(`${apiUrl}/v1/messages`, {
  body: JSON.stringify(requestBody)
});
```

## 工作原理

### 流程图

```
用户发送消息 → RightPanel.tsx
  ↓
apiService.chatWithLLM({
  message: "画一个圆",
  assistantId: "cad-assistant-id"
})
  ↓
后端 /api/llm/chat
  ↓
检测助手: assistant.name.includes('cad')?
  ↓ YES
生成CAD能力清单: generateCompactCapabilitiesPrompt()
  ↓
注入系统提示词到LLM请求
  ↓
LLM Provider (Ollama/Gemini/OpenAI/Claude)
  带着CAD算法知识
  ↓
返回结构化JSON:
{
  "commands": [
    {
      "action": "DRAW_CIRCLE",
      "params": {
        "center": {"x": 400, "y": 300},
        "radius": 50
      }
    }
  ],
  "explanation": "在画布中心绘制一个半径为50的圆"
}
  ↓
前端接收流式响应
  ↓
解析JSON并执行命令
```

### 系统提示词内容

`generateCompactCapabilitiesPrompt()` 生成的内容包括：

1. **输出格式说明**: JSON schema
2. **算法列表**: 14个可用算法
   - `DRAW_LINE`: 绘制直线
   - `DRAW_CIRCLE`: 绘制圆
   - `DRAW_RECTANGLE`: 绘制矩形
   - `DRAW_POLYGON`: 绘制多边形
   - `FIND_INTERSECTION`: 查找交点
   - `MEASURE_DISTANCE`: 测量距离
   - `MOVE_ELEMENTS`: 移动元素
   - `ROTATE_ELEMENTS`: 旋转元素
   - `MIRROR_ELEMENTS`: 镜像元素
   - `ARRAY_LINEAR`: 线性阵列
   - `ARRAY_CIRCULAR`: 圆形阵列
   - `OFFSET_ELEMENT`: 偏移元素
   - `MEASURE_AREA`: 测量面积
   - `MEASURE_PERIMETER`: 测量周长
3. **参数说明**: 每个算法的参数类型和要求
4. **特殊语法**: "selected" 和 "result:id"

## 测试

### 1. 启动后端

```bash
cd backend
npm run dev
```

应该看到:
```
Server running on port 3410
```

### 2. 启动前端

```bash
npm run dev
```

### 3. 创建或选择CAD助手

1. 打开右侧面板
2. 切换到"Assistants"标签
3. 确保有一个名称包含"CAD"的助手，或者ID为`cad-designer-id`

### 4. 发送测试消息

在聊天框中输入以下命令测试：

**基础绘图**:
- "画一个圆"
- "在坐标(200, 200)画一条到(400, 400)的直线"
- "画一个边长100的正方形"

**变换操作**:
- 先选中一个元素，然后说"向右移动50"
- "旋转选中的元素45度"
- "镜像选中的元素"

**阵列**:
- "创建一个3x3的矩形阵列"
- "把这个圆形复制8次排列成圆形"

**测量**:
- "测量选中元素的面积"
- "计算两个点之间的距离"

### 5. 查看日志

后端应该输出：
```
[CAD Assistant] Injecting CAD capabilities into prompt
[Ollama] Using system prompt (1234 chars)
```

前端控制台应该看到：
```
Analyzing AI response for CAD actions...
Applying CAD action: ADD [...]
```

## 常见问题

### Q1: 后端报错 "Cannot find module '../services/aiEngine/capabilitiesGenerator'"

**解决**: 确保已复制所有文件到后端
```bash
ls backend/src/services/aiEngine/
ls backend/src/services/cadEngine/
```

### Q2: AI返回的不是JSON格式

**解决**: 
1. 检查助手的自定义prompt是否干扰了系统提示词
2. 尝试在前端prompt中明确说明: "请以JSON格式返回"
3. 对于Gemini，可以添加 `responseMimeType: "application/json"` 约束

### Q3: AI不理解CAD命令

**检查**:
1. 确认助手名称包含"cad"（不区分大小写）
2. 查看后端日志是否有 "[CAD Assistant] Injecting CAD capabilities"
3. 尝试使用 `generateCapabilitiesPrompt()` (完整版) 替代紧凑版

### Q4: 命令执行失败

**问题**: 前端尝试应用AI生成的命令时出错

**下一步**: 需要在前端集成 `executeCommands()` 函数（见下一节）

## 下一步：前端集成

虽然后端已经注入了CAD能力，但前端还在使用旧的手动解析方式。

**需要更新**:
- `components/RightPanel.tsx` (handleSend函数)
- 使用 `executeCommands()` 替代手动解析和应用

详见: `FRONTEND_INTEGRATION_GUIDE.md` (待创建)

## 总结

✅ 已完成:
- 后端CAD引擎文件复制
- llmChat.ts更新支持系统提示词
- 所有4个LLM提供商支持CAD能力
- 自动检测CAD助手

⏳ 待完成:
- 前端使用 `executeCommands()` 验证命令
- 添加命令执行日志
- 优化token使用（缓存能力清单）
- 添加测试用例

🎯 效果:
- 任何LLM (Ollama/Gemini/OpenAI/Claude) 现在都能理解CAD命令
- AI会输出结构化的JSON命令
- 支持14种CAD算法
- 自动注入，无需手动配置
