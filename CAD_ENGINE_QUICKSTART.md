# CAD引擎快速开始指南

## 概述

这份指南将帮助你快速上手使用新的CAD引擎系统。

## 核心概念

### 三层架构

```
用户输入 → AI解析 → 本地算法 → 画布渲染
```

1. **用户**: 用自然语言描述需求
2. **AI**: 理解意图并生成结构化命令
3. **本地算法**: 执行精确的数学计算
4. **画布**: 可视化展示结果

## 快速示例

### 示例 1: 绘制基础图形

```typescript
import { executeCommands } from './services/aiEngine/commandExecutor';

// AI生成的命令
const aiResponse = {
    commands: [
        {
            action: "DRAW_CIRCLE",
            params: {
                center: { x: 400, y: 300 },
                radius: 50
            }
        }
    ],
    explanation: "在画布中心绘制圆"
};

// 执行命令
const result = await executeCommands(aiResponse.commands, currentElements);

// 结果
console.log(result.success); // true
console.log(result.elements); // [CADElement]
```

### 示例 2: 几何计算

```typescript
import * as Geometry from './services/cadEngine/geometry';

// 计算两点距离
const distance = Geometry.distance(
    { x: 0, y: 0 },
    { x: 100, y: 100 }
);
console.log(distance); // 141.42...

// 求线段交点
const intersection = Geometry.segmentIntersection(
    { x: 0, y: 0 }, { x: 100, y: 100 },
    { x: 0, y: 100 }, { x: 100, y: 0 }
);
console.log(intersection); // { x: 50, y: 50 }

// 计算多边形面积
const area = Geometry.polygonArea([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
]);
console.log(area); // 10000
```

### 示例 3: 使用注册表

```typescript
import { CAD_ALGORITHM_REGISTRY, searchAlgorithms } from './services/cadEngine/registry';

// 获取算法信息
const circleAlgo = CAD_ALGORITHM_REGISTRY.DRAW_CIRCLE;
console.log(circleAlgo.name); // "绘制圆"
console.log(circleAlgo.parameters); // 参数列表

// 搜索算法
const results = searchAlgorithms('圆');
console.log(results); // [DRAW_CIRCLE, ARRAY_CIRCULAR, ...]
```

## 添加新算法

### 第1步: 在注册表中定义

```typescript
// services/cadEngine/registry.ts

export const MY_NEW_ALGORITHM: AlgorithmMetadata = {
    id: 'MY_NEW_ALGORITHM',
    name: '我的新算法',
    category: 'PRIMITIVES',
    description: '这是一个新算法',
    parameters: [
        {
            name: 'param1',
            type: 'number',
            description: '参数1',
            required: true
        }
    ],
    returns: {
        type: 'CADElement',
        description: '返回的元素'
    },
    examples: [...],
    tags: ['new', 'algorithm'],
    version: '1.0.0'
};

// 添加到注册表
export const CAD_ALGORITHM_REGISTRY = {
    // ...existing
    MY_NEW_ALGORITHM
};
```

### 第2步: 实现算法函数

```typescript
// services/cadEngine/myAlgorithm.ts

export function myNewAlgorithm(param1: number): CADElement {
    return {
        id: generateId(),
        type: 'LINE',
        start: { x: 0, y: 0 },
        end: { x: param1, y: param1 },
        layer: '0',
        color: '#8b949e'
    };
}
```

### 第3步: 在执行器中注册

```typescript
// services/aiEngine/commandExecutor.ts

case 'MY_NEW_ALGORITHM':
    return {
        success: true,
        elements: [myNewAlgorithm(resolvedParams.param1)]
    };
```

### 第4步: AI自动学习

```typescript
// 能力清单会自动包含新算法
const prompt = generateCapabilitiesPrompt();
// AI现在知道可以使用 MY_NEW_ALGORITHM 了！
```

## 常用API

### 几何计算

```typescript
import * as Geo from './services/cadEngine/geometry';

// 距离和角度
Geo.distance(p1, p2)
Geo.angleBetweenPoints(p1, p2)

// 向量运算
Geo.addVectors(v1, v2)
Geo.subtractVectors(v1, v2)
Geo.normalize(v)
Geo.rotateVector(v, angle)

// 交点计算
Geo.lineIntersection(l1Start, l1End, l2Start, l2End)
Geo.lineCircleIntersection(lineStart, lineEnd, center, radius)
Geo.circleCircleIntersection(c1, r1, c2, r2)

// 多边形
Geo.polygonArea(points)
Geo.polygonPerimeter(points)
Geo.polygonCentroid(points)
Geo.isPointInPolygon(point, polygon)

// 边界框
Geo.boundingBox(points)
Geo.elementBoundingBox(element)
```

### 图元生成

```typescript
import * as Prim from './services/cadEngine/primitives';

// 基础图形
Prim.drawLine(start, end)
Prim.drawCircle(center, radius)
Prim.drawRectangle(corner, width, height)
Prim.drawArc(center, radius, startAngle, endAngle)
Prim.drawPolygon(center, sides, radius)
Prim.drawEllipse(center, radiusX, radiusY, rotation)

// 辅助功能
Prim.distributePointsOnCircle(center, radius, count)
Prim.distributePointsOnLine(start, end, count)
Prim.generateGrid(origin, rows, cols, spacing)
Prim.cloneElement(element)
```

### AI集成

```typescript
import { generateCapabilitiesPrompt } from './services/aiEngine/capabilitiesGenerator';
import { executeCommands } from './services/aiEngine/commandExecutor';

// 生成提示词
const systemPrompt = generateCapabilitiesPrompt();

// 调用AI
const aiResponse = await callAI(userInput, systemPrompt);

// 执行命令
const result = await executeCommands(
    aiResponse.commands,
    currentElements
);

// 处理结果
if (result.success) {
    setElements([...elements, ...result.elements]);
} else {
    console.error(result.error);
}
```

## 命令格式参考

### 基本命令

```json
{
  "commands": [
    {
      "action": "DRAW_CIRCLE",
      "params": {
        "center": {"x": 100, "y": 100},
        "radius": 50
      }
    }
  ],
  "explanation": "绘制圆"
}
```

### 带结果引用的命令

```json
{
  "commands": [
    {
      "action": "DRAW_CIRCLE",
      "params": {
        "center": {"x": 100, "y": 100},
        "radius": 50
      },
      "resultId": "my_circle"
    },
    {
      "action": "MOVE_ELEMENTS",
      "params": {
        "elements": "result:my_circle",
        "dx": 50,
        "dy": 0
      }
    }
  ],
  "explanation": "画圆并移动"
}
```

### 操作选中元素

```json
{
  "commands": [
    {
      "action": "ROTATE_ELEMENTS",
      "params": {
        "elements": "selected",
        "center": {"x": 400, "y": 300},
        "angle": 45
      }
    }
  ],
  "explanation": "旋转选中元素"
}
```

## 调试技巧

### 1. 查看算法信息

```typescript
import { CAD_ALGORITHM_REGISTRY } from './services/cadEngine/registry';

// 查看所有算法
console.log(Object.keys(CAD_ALGORITHM_REGISTRY));

// 查看特定算法
console.log(CAD_ALGORITHM_REGISTRY.DRAW_CIRCLE);
```

### 2. 验证命令

```typescript
import { validateParameters } from './services/aiEngine/commandExecutor';

const error = validateParameters(
    params,
    CAD_ALGORITHM_REGISTRY.DRAW_CIRCLE
);

if (error) {
    console.error('参数错误:', error);
}
```

### 3. 测试几何算法

```typescript
import * as Geo from './services/cadEngine/geometry';

// 测试交点计算
const result = Geo.lineIntersection(
    {x: 0, y: 0}, {x: 100, y: 100},
    {x: 0, y: 100}, {x: 100, y: 0}
);
console.log('交点:', result);
```

## 性能建议

### 1. 批量操作

```typescript
// ❌ 不好：多次单独调用
for (const point of points) {
    const circle = Primitives.drawCircle(point, 5);
    elements.push(circle);
}

// ✅ 好：使用阵列算法
const circularArray = executeCommand({
    action: 'ARRAY_CIRCULAR',
    params: { element: baseCircle, count: points.length }
});
```

### 2. 缓存计算结果

```typescript
// 缓存边界框
const bbox = Geometry.elementBoundingBox(element);
// 重复使用 bbox 而不是重复计算
```

### 3. 避免不必要的转换

```typescript
// ❌ 不好
const angle = Geo.radiansToDegrees(Geo.degreesToRadians(45));

// ✅ 好
const angle = 45;
```

## 常见问题

### Q: 如何添加新的图形类型？

A: 
1. 在 `types.ts` 中扩展 CADElement 类型
2. 在 `primitives.ts` 中添加生成函数
3. 在 `registry.ts` 中注册算法
4. 在 `commandExecutor.ts` 中添加执行逻辑

### Q: AI输出的命令格式错误怎么办？

A: 
1. 检查 `generateCapabilitiesPrompt()` 生成的提示词
2. 在prompt中添加更多示例
3. 使用 JSON Schema 约束AI输出

### Q: 如何测试单个算法？

A:
```typescript
import { executeCommand } from './services/aiEngine/commandExecutor';

const result = await executeCommand(
    {
        action: 'DRAW_CIRCLE',
        params: { center: {x: 0, y: 0}, radius: 50 }
    },
    [],
    new Map()
);

console.log(result);
```

## 下一步

- 查看 `CAD_ENGINE_ARCHITECTURE.md` 了解架构设计
- 查看 `CAD_ENGINE_IMPLEMENTATION.md` 了解实现细节
- 查看注册表了解所有可用算法
- 开始集成到Gemini服务

## 支持

如有问题，请查看:
- 算法注册表: `services/cadEngine/registry.ts`
- 实现文档: `CAD_ENGINE_IMPLEMENTATION.md`
- 架构文档: `CAD_ENGINE_ARCHITECTURE.md`
