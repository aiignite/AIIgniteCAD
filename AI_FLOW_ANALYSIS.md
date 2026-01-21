# AI处理流程分析

## 当前架构

### 1. 整体流程
```
用户输入 → RightPanel.tsx → apiService.chatWithLLM() 
  → 后端 /api/llm/chat → LLM Provider (Ollama/Google/OpenAI/Anthropic)
  → 流式返回 → RightPanel解析JSON → 应用到画布
```

### 2. 核心组件

#### 前端 (RightPanel.tsx)
- **功能**: 用户界面和聊天管理
- **位置**: `components/RightPanel.tsx` (line 516-700)
- **流程**:
  1. 用户输入消息
  2. 如果选中CAD助手，注入画布上下文
  3. 调用 `apiService.chatWithLLM()`
  4. 流式接收AI响应
  5. 尝试从响应中提取JSON
  6. 解析并应用CAD操作

**关键代码**:
```typescript
// 注入上下文 (line 582-592)
if (selectedAssistant.id === "cad-designer-id" || 
    selectedAssistant.name.toLowerCase().includes("cad")) {
  const elementContext = currentElements.length > 0
    ? `\n\n[CONTEXT] Current elements on canvas: ${prepareContext(currentElements)}`
    : "\n\n[CONTEXT] The canvas is currently empty.";
  
  messageWithContext = `${userMsg.text}${elementContext}`;
}

// 流式接收 (line 594-615)
await api.apiService.chatWithLLM(
  { message: messageWithContext, assistantId: selectedAssistant.id },
  (chunk: string) => {
    fullContent += chunk;
    setMessages(prev => prev.map(msg => 
      msg.id === aiMsgId ? { ...msg, text: msg.text + chunk } : msg
    ));
  },
  controller.signal
);

// 解析JSON (line 606-730)
const jsonRegex = /\{[\s\S]*\}/;
const jsonMatch = fullContent.match(jsonRegex);
if (jsonMatch) {
  const parsed = JSON.parse(jsonStr);
  onApplyAIAction(parsed.operation, parsed.elements, parsed.params);
}
```

#### 前端 API服务 (apiService.ts)
- **功能**: HTTP客户端，处理流式响应
- **位置**: `services/apiService.ts` (line 325-396)
- **流程**:
  1. 发送POST请求到后端 `/api/llm/chat`
  2. 读取SSE (Server-Sent Events) 流
  3. 解码数据块并调用 `onChunk` 回调

**关键代码**:
```typescript
async chatWithLLM(
  data: { message: string; assistantId?: string; modelId?: string },
  onChunk?: (chunk: string) => void,
  signal?: AbortSignal
): Promise<{ message: string; model: string }> {
  const response = await fetch(`${API_BASE_URL}/llm/chat`, {
    method: "POST",
    headers: this.getHeaders(),
    body: JSON.stringify(data),
    signal
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let fullMessage = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");
    
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const parsed = JSON.parse(line.slice(6));
        if (parsed.content) {
          fullMessage += parsed.content;
          onChunk?.(parsed.content);
        }
      }
    }
  }
  
  return { message: fullMessage, model: modelName };
}
```

#### 后端路由 (llmChat.ts)
- **功能**: 代理不同的LLM提供商
- **位置**: `backend/src/routes/llmChat.ts`
- **支持的提供商**:
  - **Ollama** (本地部署，如 qwq/qwen/deepseek)
  - **Google** (Gemini)
  - **OpenAI** (GPT-3.5/4)
  - **Anthropic** (Claude)

**流程**:
1. 验证用户身份 (`authenticate`)
2. 根据 `assistantId` 或 `modelId` 查找LLM配置
3. 解密API密钥（如果需要）
4. 设置SSE响应头
5. 根据 `provider` 调用对应的流式函数
6. 转发流式响应到前端

**关键代码**:
```typescript
router.post("/chat", async (req: AuthRequest, res: Response) => {
  const { message, assistantId, modelId } = req.body;
  
  // 查找LLM配置
  let llmModel;
  if (assistantId) {
    const assistant = await prisma.assistant.findFirst({
      where: { id: assistantId, userId },
      include: { llmModel: true }
    });
    llmModel = assistant.llmModel;
  }
  
  // 设置SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  
  // 调用对应提供商
  switch (llmModel.provider) {
    case "Ollama":
      await streamChatWithOllama(message, llmModel, res);
      break;
    case "Google":
      await streamChatWithGoogle(message, llmModel, apiKey, res);
      break;
    // ...
  }
  
  res.end();
});
```

### 3. 数据库模型

从 `prisma/schema.prisma` 可以看出：
- **LLMModel**: 存储LLM配置（provider, modelId, apiKey, configuration）
- **Assistant**: 助手配置（name, prompt, llmModelId）
- **User**: 用户管理

## 问题分析

### 当前问题
1. **AI没有CAD能力清单**: 后端只是转发消息，没有注入CAD算法能力
2. **响应格式不统一**: 依赖正则提取JSON，不可靠
3. **没有命令验证**: 前端直接应用AI生成的元素，没有参数验证
4. **geminiService.ts未使用**: 原本是直接调用Gemini的代码，现已废弃

### 理想流程（集成CAD引擎后）
```
用户输入 → RightPanel 
  → apiService.chatWithLLM() 
  → 后端 llmChat.ts [注入CAD能力清单]
  → LLM Provider (带CAD系统提示词)
  → 流式返回结构化命令
  → RightPanel接收
  → executeCommands() [验证并执行]
  → 画布更新
```

## 解决方案

### 方案1: 后端注入系统提示词（推荐）

**优点**:
- 统一管理CAD能力
- 所有LLM提供商都能使用
- 用户无需修改前端代码
- 可以根据助手类型动态调整

**修改点**:
1. 在 `llmChat.ts` 中检测CAD助手
2. 如果是CAD助手，在消息前注入 `generateCapabilitiesPrompt()`
3. 配置JSON响应格式（如果提供商支持）

**实现**:
```typescript
// backend/src/routes/llmChat.ts

import { generateCapabilitiesPrompt } from '../../services/aiEngine/capabilitiesGenerator';

router.post("/chat", async (req: AuthRequest, res: Response) => {
  let { message } = req.body;
  
  // 如果是CAD助手，注入能力清单
  if (assistantId) {
    const assistant = await prisma.assistant.findFirst({...});
    
    if (assistant.name.toLowerCase().includes('cad') || 
        assistant.id === 'cad-designer-id') {
      const cadPrompt = generateCapabilitiesPrompt();
      message = `${cadPrompt}\n\n用户消息: ${message}`;
    }
  }
  
  // 调用LLM...
});
```

### 方案2: 前端在RightPanel中注入

**优点**:
- 不需要修改后端
- 前端完全控制

**缺点**:
- 每次请求都发送大量token（能力清单很长）
- 后端无法优化或缓存

### 方案3: 创建专用CAD端点

**优点**:
- 专门优化CAD场景
- 可以直接调用 `executeCommands()`
- 返回验证后的元素

**缺点**:
- 需要大量后端改动
- 破坏现有架构

## 推荐实现步骤

### 第1步: 复制CAD引擎到后端

```bash
# 在项目根目录
cp -r services/cadEngine backend/src/services/
cp -r services/aiEngine backend/src/services/
cp services/advancedShapesService.ts backend/src/services/
cp lib/geometry.ts backend/src/lib/
cp lib/transform.ts backend/src/lib/
```

### 第2步: 更新后端 llmChat.ts

在后端注入CAD能力（方案1）：
```typescript
import { generateCompactCapabilitiesPrompt } from '../services/aiEngine/capabilitiesGenerator';

// 在 streamChatWithOllama, streamChatWithGoogle 等函数中
// 添加 systemPrompt 参数

async function streamChatWithOllama(
  message: string,
  model: any,
  res: Response,
  systemPrompt?: string  // 新增
): Promise<void> {
  const messages = [];
  
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  
  messages.push({ role: 'user', content: message });
  
  const response = await fetch(`${apiUrl}/api/chat`, {
    body: JSON.stringify({
      model: modelId,
      messages,
      stream: true
    })
  });
  // ...
}

// 在主路由中
router.post("/chat", async (req: AuthRequest, res: Response) => {
  let systemPrompt: string | undefined;
  
  // 检测CAD助手
  if (assistantId) {
    const assistant = await prisma.assistant.findFirst({...});
    
    if (assistant.name.toLowerCase().includes('cad') || 
        assistant.id === 'cad-designer-id') {
      systemPrompt = generateCompactCapabilitiesPrompt();
    }
  }
  
  // 调用时传入 systemPrompt
  switch (llmModel.provider) {
    case "Ollama":
      await streamChatWithOllama(message, llmModel, res, systemPrompt);
      break;
    // ...
  }
});
```

### 第3步: 更新前端 RightPanel.tsx

使用 `executeCommands()` 替代手动解析：
```typescript
import { executeCommands } from '../services/aiEngine/commandExecutor';

// 在 handleSend 中解析AI响应后
if (jsonMatch) {
  const parsed = JSON.parse(jsonStr);
  
  // 使用命令执行器
  if (parsed.commands && Array.isArray(parsed.commands)) {
    const result = await executeCommands(
      parsed.commands,
      currentElements
    );
    
    if (result.success) {
      onApplyAIAction('ADD', result.elements);
    } else {
      console.error('命令执行失败:', result.error);
      // 显示错误消息
    }
  } else {
    // 兼容旧格式 (operation + elements)
    onApplyAIAction(parsed.operation, parsed.elements, parsed.params);
  }
}
```

### 第4步: 测试

1. 启动后端: `cd backend && npm run dev`
2. 启动前端: `npm run dev`
3. 创建CAD助手（如果没有）
4. 测试命令：
   - "画一个圆"
   - "把选中的元素向右移动50"
   - "创建一个3x3的圆形阵列"
   - "计算选中元素的面积"

## 优化建议

### 1. 缓存能力清单
```typescript
// 避免每次请求都生成
let cachedCapabilities: string | null = null;

function getCapabilities(): string {
  if (!cachedCapabilities) {
    cachedCapabilities = generateCompactCapabilitiesPrompt();
  }
  return cachedCapabilities;
}
```

### 2. 响应格式约束

对于支持JSON Schema的模型（如Gemini），添加输出约束：
```typescript
// 在调用Gemini时
const response = await fetch(`${apiUrl}/${modelId}:streamGenerateContent`, {
  body: JSON.stringify({
    contents: [...],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          commands: {
            type: "array",
            items: { ... }
          },
          explanation: { type: "string" }
        }
      }
    }
  })
});
```

### 3. 命令日志

在后端记录所有AI生成的命令：
```typescript
await prisma.cadCommand.create({
  data: {
    userId,
    assistantId,
    userMessage: message,
    aiCommands: JSON.stringify(parsed.commands),
    success: result.success,
    error: result.error
  }
});
```

## 迁移checklist

- [ ] 复制CAD引擎文件到后端
- [ ] 更新后端路由注入系统提示词
- [ ] 修改流式函数支持系统提示
- [ ] 更新前端使用 `executeCommands()`
- [ ] 添加错误处理和用户反馈
- [ ] 测试所有LLM提供商（Ollama/Gemini/OpenAI/Claude）
- [ ] 优化：缓存能力清单
- [ ] 优化：添加JSON Schema约束
- [ ] 优化：命令执行日志
- [ ] 文档：更新AGENTS.md说明新流程

## 总结

- **废弃**: `geminiService.ts` (不再使用)
- **核心**: `backend/src/routes/llmChat.ts` (实际的AI处理入口)
- **集成点**: 在后端注入CAD能力，前端使用 `executeCommands()` 验证执行
- **兼容性**: 支持任何LLM提供商（Ollama/Google/OpenAI/Anthropic）
