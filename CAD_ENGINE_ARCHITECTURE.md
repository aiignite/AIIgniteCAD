# CAD引擎架构设计

## 概述

设计一个专业级CAD引擎库，与AI大模型协作，实现智能化的CAD操作。

## 核心理念

**分工明确**：
- **AI大模型**：理解用户意图、参数提取、决策调用哪些算法
- **本地CAD引擎**：执行精确的数学计算和图形生成
- **画布渲染**：可视化展示计算结果

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户输入                               │
│  "画一个直径100的圆，然后在圆上均匀分布6个点"                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    AI 意图解析器                              │
│  - 识别操作类型（绘制、测量、变换等）                         │
│  - 提取参数（直径、数量、位置等）                             │
│  - 生成结构化命令                                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼ JSON命令
         ┌───────────────────────┐
         │ {                      │
         │   "commands": [        │
         │     {                  │
         │       "action": "DRAW_CIRCLE", │
         │       "params": {...}  │
         │     },                 │
         │     {                  │
         │       "action": "DISTRIBUTE_POINTS", │
         │       "params": {...}  │
         │     }                  │
         │   ]                    │
         │ }                      │
         └───────────┬────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  命令执行引擎                                 │
│  - 验证命令合法性                                             │
│  - 调用对应的CAD算法                                          │
│  - 组合多个操作结果                                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  CAD引擎算法库                                │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ 基础图元     │  │ 几何计算     │  │ 高级操作     │      │
│  │ - 线/圆/弧   │  │ - 交点       │  │ - 布尔运算   │      │
│  │ - 多边形     │  │ - 距离       │  │ - 偏移       │      │
│  │ - 样条曲线   │  │ - 角度       │  │ - 阵列       │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ 变换操作     │  │ 约束求解     │  │ 测量分析     │      │
│  │ - 移动/旋转  │  │ - 平行       │  │ - 面积       │      │
│  │ - 缩放/镜像  │  │ - 垂直       │  │ - 周长       │      │
│  │ - 阵列       │  │ - 相切       │  │ - 重心       │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼ CADElement[]
┌─────────────────────────────────────────────────────────────┐
│                    画布渲染层                                 │
│  - SVG渲染                                                    │
│  - 图层管理                                                   │
│  - 交互反馈                                                   │
└─────────────────────────────────────────────────────────────┘
```

## 模块设计

### 1. CAD引擎核心库

#### 1.1 基础图元 (Primitives)
```typescript
// services/cadEngine/primitives.ts
- drawLine(start, end)
- drawCircle(center, radius)
- drawArc(center, radius, startAngle, endAngle)
- drawEllipse(center, radiusX, radiusY, rotation)
- drawRectangle(corner, width, height)
- drawPolygon(center, sides, radius)
- drawPolyline(points)
- drawBezier(controlPoints)
- drawSpline(points)
```

#### 1.2 几何计算 (Geometry)
```typescript
// services/cadEngine/geometry.ts
- findIntersection(elem1, elem2)           // 求交点
- calculateDistance(point1, point2)        // 计算距离
- calculateAngle(point1, center, point2)   // 计算角度
- projectPoint(point, line)                // 点到线投影
- findTangent(circle1, circle2)            // 求公切线
- isConcentric(circle1, circle2)           // 是否同心
- isParallel(line1, line2)                 // 是否平行
- isPerpendicular(line1, line2)            // 是否垂直
```

#### 1.3 高级操作 (Advanced)
```typescript
// services/cadEngine/advanced.ts
- booleanUnion(shape1, shape2)             // 并集
- booleanIntersect(shape1, shape2)         // 交集
- booleanSubtract(shape1, shape2)          // 差集
- offset(element, distance)                // 偏移
- fillet(corner, radius)                   // 圆角
- chamfer(corner, distance)                // 倒角
- trim(element, boundary)                  // 修剪
- extend(element, boundary)                // 延伸
- arrayLinear(element, count, spacing)     // 线性阵列
- arrayCircular(element, count, center)    // 环形阵列
- arrayPath(element, path, count)          // 路径阵列
```

#### 1.4 变换操作 (Transform)
```typescript
// services/cadEngine/transform.ts
- move(elements, vector)
- rotate(elements, center, angle)
- scale(elements, center, factor)
- mirror(elements, axis)
- stretch(elements, base, displacement)
```

#### 1.5 约束求解 (Constraints)
```typescript
// services/cadEngine/constraints.ts
- constrainParallel(line1, line2)
- constrainPerpendicular(line1, line2)
- constrainTangent(circle, line)
- constrainConcentric(circle1, circle2)
- constrainEqual(elem1, elem2)
- constrainDistance(point1, point2, distance)
```

#### 1.6 测量分析 (Measurement)
```typescript
// services/cadEngine/measurement.ts
- measureArea(elements)
- measurePerimeter(elements)
- measureLength(element)
- findCentroid(elements)
- findBoundingBox(elements)
- measureAngle(line1, line2)
```

#### 1.7 算法注册表 (Registry)
```typescript
// services/cadEngine/registry.ts
export interface AlgorithmMetadata {
  name: string;
  category: string;
  description: string;
  parameters: ParameterSchema[];
  returns: ReturnSchema;
  examples: Example[];
  tags: string[];
}

export const CAD_ALGORITHMS = {
  // 所有算法的元数据
}
```

### 2. AI协作层

#### 2.1 能力描述生成器
```typescript
// services/aiEngine/capabilitiesGenerator.ts
export function generateCapabilitiesPrompt(): string {
  // 从注册表自动生成给AI的能力清单
  return `
  你是一个专业的CAD助手。你可以调用以下本地算法：
  
  ## 基础绘图
  - DRAW_LINE: 绘制直线
    参数: {start: Point, end: Point}
  - DRAW_CIRCLE: 绘制圆
    参数: {center: Point, radius: number}
  ...
  
  ## 几何计算
  - FIND_INTERSECTION: 求两个元素的交点
    参数: {element1: string, element2: string}
  ...
  
  ## 高级操作
  - BOOLEAN_UNION: 两个图形求并集
    参数: {shape1: string, shape2: string}
  ...
  
  请根据用户输入，输出JSON格式的命令：
  {
    "commands": [
      {
        "action": "算法名称",
        "params": {...}
      }
    ],
    "explanation": "简短说明你的操作"
  }
  `;
}
```

#### 2.2 意图解析器
```typescript
// services/aiEngine/intentParser.ts
export interface ParsedIntent {
  commands: Command[];
  explanation: string;
  confidence: number;
}

export async function parseUserIntent(
  userInput: string,
  context: CADElement[]
): Promise<ParsedIntent> {
  // 调用AI解析用户意图
  // 返回结构化命令
}
```

#### 2.3 命令执行器
```typescript
// services/aiEngine/commandExecutor.ts
export interface Command {
  action: string;
  params: Record<string, any>;
  targetIds?: string[];
}

export async function executeCommands(
  commands: Command[],
  elements: CADElement[]
): Promise<ExecutionResult> {
  // 验证命令
  // 调用CAD引擎算法
  // 返回新生成的元素
}
```

## 数据流

### 用户请求示例 1
```
用户输入: "在画布中心画一个半径50的圆，然后在圆上均匀分布8个直径10的小圆"

AI解析输出:
{
  "commands": [
    {
      "action": "DRAW_CIRCLE",
      "params": {
        "center": {"x": 400, "y": 300},
        "radius": 50
      },
      "resultId": "circle_main"
    },
    {
      "action": "ARRAY_CIRCULAR",
      "params": {
        "element": {
          "type": "CIRCLE",
          "radius": 5
        },
        "center": {"x": 400, "y": 300},
        "count": 8,
        "radius": 50
      }
    }
  ],
  "explanation": "创建主圆并在其上均匀分布8个小圆"
}

本地执行:
1. 调用 drawCircle({x:400, y:300}, 50)
2. 调用 arrayCircular(smallCircle, 8, {x:400, y:300})
3. 返回9个CADElement到画布
```

### 用户请求示例 2
```
用户输入: "选中的两个矩形求并集"

AI解析输出:
{
  "commands": [
    {
      "action": "BOOLEAN_UNION",
      "params": {
        "shape1": "selected[0]",
        "shape2": "selected[1]"
      }
    }
  ],
  "explanation": "对选中的两个矩形执行布尔并运算"
}

本地执行:
1. 获取选中元素
2. 调用 booleanUnion(rect1, rect2)
3. 返回合并后的新图形
```

### 用户请求示例 3
```
用户输入: "计算选中图形的面积和周长"

AI解析输出:
{
  "commands": [
    {
      "action": "MEASURE_AREA",
      "params": {
        "elements": "selected"
      }
    },
    {
      "action": "MEASURE_PERIMETER",
      "params": {
        "elements": "selected"
      }
    }
  ],
  "explanation": "测量选中图形的面积和周长"
}

本地执行:
1. 调用 measureArea(selectedElements)
2. 调用 measurePerimeter(selectedElements)
3. 返回测量结果（不生成新元素，只返回数值）
```

## 关键优势

### 1. 精确性
- 所有几何计算由本地算法执行，保证精度
- AI只负责理解和决策，不参与计算

### 2. 可扩展性
- 算法注册表设计，易于添加新算法
- AI提示词自动生成，算法更新后AI自动学习

### 3. 可靠性
- 命令验证机制，防止非法操作
- 错误处理和回退机制

### 4. 性能优化
- 本地计算，无需等待AI响应
- 批量操作支持，减少往返次数

### 5. 用户体验
- 自然语言输入，降低学习曲线
- 即时反馈，操作过程可视化

## 实现优先级

### Phase 1: 核心基础（当前sprint）
1. ✅ 算法注册表系统
2. ✅ 基础几何计算库
3. ✅ 能力描述生成器
4. ✅ 命令执行引擎

### Phase 2: AI集成
1. 更新Gemini服务集成
2. 意图解析器实现
3. 聊天界面优化

### Phase 3: 高级功能
1. 布尔运算
2. 约束求解
3. 高级测量

### Phase 4: 优化完善
1. 性能优化
2. 错误处理
3. 用户文档

## 技术栈

- **TypeScript**: 类型安全的算法实现
- **几何库**: 考虑集成 [Paper.js](http://paperjs.org/) 或 [Turf.js](https://turfjs.org/)
- **AI模型**: Google Gemini API
- **渲染**: SVG (现有)

## 配置示例

```typescript
// 算法配置
export const ALGORITHM_CONFIG = {
  precision: 0.001,           // 计算精度
  maxIterations: 1000,        // 最大迭代次数
  timeout: 5000,              // 超时时间(ms)
  enableCache: true,          // 启用计算缓存
  debugMode: false            // 调试模式
};

// AI配置
export const AI_CONFIG = {
  model: "gemini-2.0-flash",
  temperature: 0.1,           // 低温度保证确定性
  maxTokens: 2000,
  responseFormat: "json"
};
```

## 安全考虑

1. **命令白名单**：只允许注册表中的算法
2. **参数验证**：严格验证所有输入参数
3. **资源限制**：限制计算复杂度和时间
4. **沙箱执行**：隔离算法执行环境

## 测试策略

1. **单元测试**：每个算法独立测试
2. **集成测试**：命令执行流程测试
3. **AI测试**：意图解析准确性测试
4. **性能测试**：大规模数据测试
5. **用户测试**：真实场景验证
