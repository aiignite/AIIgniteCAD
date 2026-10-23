# 正弦波显示问题分析与修复

## 问题描述
用户要求画正弦波，AI返回了以下响应，但界面上没有显示该波形：
```json
{
  "message": "I have drawn a blue sine wave for you.",
  "operation": "ADD",
  "elements": [
    {
      "id": "sine_wave_blue",
      "type": "LINE",
      "layer": "AI_GENERATED",
      "color": "#0000FF",
      "points": [
        {"x": 50, "y": 300},
        {"x": 70, "y": 270.9},
        ...（36个点）
      ]
    }
  ]
}
```

## 根本原因分析

### 问题 1: 数据格式不匹配
- AI生成的数据使用 `type: "LINE"` 但包含 `points` 数组
- Canvas的LINE类型渲染逻辑**只支持 `start` 和 `end` 两个点**
- 多点曲线应该使用 `type: "LWPOLYLINE"` 类型
- 结果：LINE元素被正确添加到画布，但由于没有start/end属性，渲染时被跳过

### 问题 2: Gemini Schema限制
- geminiService.ts中的responseSchema只允许三种类型：LINE、RECTANGLE、CIRCLE
- LINE必须遵循 `{start, end}` 格式，无法生成多点曲线
- AI无法正确表达复杂曲线（如正弦波、螺旋线等）

## 解决方案

### 1. 扩展Gemini Schema (geminiService.ts)
**修改内容：**
- 在responseSchema中添加LWPOLYLINE类型
- 在支持的element types中添加说明：LWPOLYLINE需要 `points` 数组
- 增加points属性的schema定义

**代码变更：**
```typescript
// 在支持的element types说明中添加
- LWPOLYLINE: needs points array [{x,y}, {x,y}, ...] for multi-point curves

// 在responseSchema的type enum中添加
type: { type: Type.STRING, enum: ["LINE", "LWPOLYLINE", "RECTANGLE", "CIRCLE"] }

// 在properties中添加points支持
points: {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } }
    }
}
```

### 2. 规范化AI返回的元素 (App.tsx)
**修改内容：**
- 在handleAIAction函数中添加数据规范化逻辑
- 自动转换 `LINE + points` → `LWPOLYLINE`
- 确保即使AI按照旧schema返回数据，也能正确显示

**代码变更：**
```typescript
const handleAIAction = (
  operation: string,
  aiElements?: CADElement[],
  params?: any,
) => {
  // Normalize AI elements: convert LINE with points to LWPOLYLINE
  const normalizedElements = aiElements?.map(el => {
    if (el.type === 'LINE' && el.points && el.points.length > 0) {
      // Convert LINE with multiple points to LWPOLYLINE
      return {
        ...el,
        type: 'LWPOLYLINE' as const
      };
    }
    return el;
  });
  
  // 后续所有操作使用normalizedElements替代aiElements
  if (operation === "ADD" && normalizedElements) {
    commitAction([...elements, ...normalizedElements]);
  }
  // ...其他操作也使用normalizedElements
}
```

### 3. Canvas渲染逻辑（已存在，无需修改）
Canvas.tsx中LWPOLYLINE的渲染已经完整实现：
```typescript
if (el.type === 'LWPOLYLINE' && el.points) {
    const pts = el.points.map(p => `${p.x},${p.y}`).join(' ');
    return <polyline key={el.id} points={pts} fill="none" {...style} transform={transform} vectorEffect="non-scaling-stroke" />;
}
```

## 修复后的行为

1. **新AI请求（使用Gemini-3.5）**：
   - AI可以直接生成LWPOLYLINE类型
   - 正弦波等曲线会自动以正确的type返回
   - 界面正常显示

2. **向后兼容性**：
   - 即使AI仍然返回 `type: "LINE" + points`
   - App.tsx中的规范化逻辑会自动转换为LWPOLYLINE
   - 用户看不到任何差别

## 测试建议

1. 尝试画正弦波：`"Draw a sine wave"`
2. 尝试画螺旋：`"Draw a spiral curve"`
3. 验证波形完整显示在画布上
4. 验证波形颜色为AI_GENERATED蓝色（#137fec）
5. 验证可以选中、移动、删除波形

## 相关文件修改
- ✅ `services/geminiService.ts` - 扩展schema支持LWPOLYLINE
- ✅ `App.tsx` - 添加元素规范化逻辑
- ✅ `components/Canvas.tsx` - 无需修改（已支持LWPOLYLINE渲染）
