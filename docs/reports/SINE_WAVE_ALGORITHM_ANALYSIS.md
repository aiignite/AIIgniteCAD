# 正弦波算法分析与改进方案

## 问题分析

### 收到的AI数据问题分析

用户的原始正弦波数据：
```
起始点: (50, 300)
终止点: (750, 370.1)
y值范围: 204.5 ~ 387.9
总共36个点
```

### 数学问题诊断

#### 1. **Y轴范围分析**
```
最小值: 204.5
最大值: 387.9
范围: 183.4
中心: (204.5 + 387.9) / 2 = 296.2
振幅: 183.4 / 2 = 91.7
```

**问题**：
- 起始点y=300接近中心296.2 ✓
- 但第二点y=270.9是下降的 ❌
- 标准正弦波应该从0度开始向上

#### 2. **X轴间距分析**
```
点0: x=50
点1: x=70  (间距=20)
点2: x=90  (间距=20)
...
点35: x=750 (间距=20)
总距离: 750 - 50 = 700
总点数: 36
```

**问题**：
- 间距恒定=20 ✓
- 36个点生成700单位的曲线

#### 3. **波形周期分析**
```
从x=50到x=750的700单位内
应该完整显示几个周期？

标准正弦波一个完整周期长度应该是400-500像素
700 / 400 = 1.75 个周期
700 / 500 = 1.4 个周期
```

**实际周期估算**：
```
最小值在x≈150 (y=204.5) 
最大值在x≈350 (y=370.9)
最小值再在x≈550 (y=251.2)
最大值再在x≈710 (y=386.1)

周期 ≈ (550-150) = 400 或 (710-350) = 360
```

#### 4. **起点和相位的问题**
```
标准y = centerY + amplitude * sin(x_normalized * 2π / period)

起始点(50, 300)处：
300 = 296.2 + 91.7 * sin(0)  ✓ 正确（y在中心）
```

**实际问题**：
- 第一个点应该给出sin(0) = 0
- 但下一个点(70, 270.9)看起来像sin(-π/6)或更小的值
- 这不符合标准正弦波从0开始上升的模式

#### 5. **缩放和分辨率问题**
```
36个点覆盖700个单位
每个点间隔20个x单位

如果是标准正弦波生成：
x = 50 + i*20, i = 0..35
y = centerY + amplitude * sin(2π * (x - x_start) / period)

但实际数据显示y从300开始下降到270.9
这表示AI的sin相位可能反向或偏移不正确
```

---

## 算法改进方案

### 方案A: 改进Gemini提示词（推荐）

更新`geminiService.ts`中的提示词，明确定义正弦波算法：

```typescript
// 在支持的element types中添加详细说明
- LWPOLYLINE (Sine Wave): 
  For sine waves, generate 50-100 evenly spaced points.
  Formula: y = centerY + amplitude * sin(2π * (x - x_start) / wavelength)
  Where:
    - centerY = middle y coordinate (e.g., 300)
    - amplitude = vertical distance from center to peak (e.g., 100)
    - wavelength = horizontal distance for one complete cycle (e.g., 400)
    - x_start = starting x coordinate
  
  Example: For a wave from x=50 to x=750:
  - centerY = 300
  - amplitude = 100
  - wavelength = 400
  - Each point: x = 50 + i*7 (i=0..100), y = 300 + 100*sin(2π*(x-50)/400)
```

### 方案B: 前端规范化函数

在App.tsx中添加正弦波数据验证和修正：

```typescript
const normalizeSineWave = (element: CADElement): CADElement => {
  if (element.type !== 'LWPOLYLINE' || !element.points || element.points.length < 2) {
    return element;
  }

  const points = element.points;
  const xMin = Math.min(...points.map(p => p.x));
  const xMax = Math.max(...points.map(p => p.x));
  const yMin = Math.min(...points.map(p => p.y));
  const yMax = Math.max(...points.map(p => p.y));

  // 检测是否可能是正弦波
  const xRange = xMax - xMin;
  const yRange = yMax - yMin;
  const centerY = (yMin + yMax) / 2;
  const amplitude = yRange / 2;

  // 如果看起来像正弦波，尝试校正
  if (amplitude > 30 && xRange > 100) {
    // 重新生成正弦波点以确保准确性
    // ...实现完整的正弦波生成
  }

  return element;
};
```

### 方案C: 专用正弦波生成器

创建`services/sineWaveService.ts`：

```typescript
export interface SineWaveParams {
  startX: number;
  endX: number;
  centerY: number;
  amplitude: number;
  wavelength: number; // 一个完整周期的x距离
  pointCount?: number; // 采样点数，默认50
}

export const generateSineWave = (params: SineWaveParams): Point[] => {
  const pointCount = params.pointCount || 50;
  const points: Point[] = [];
  
  for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount;
    const x = params.startX + t * (params.endX - params.startX);
    const angle = (2 * Math.PI * (x - params.startX)) / params.wavelength;
    const y = params.centerY + params.amplitude * Math.sin(angle);
    points.push({ x, y });
  }
  
  return points;
};
```

---

## 当前数据的具体问题

### 数据点验证

```
点位   x      y      理论y(假设正弦)   误差
0      50    300     300.0         0
1      70    270.9   277.2        -6.3  ❌ 下降太多
2      90    245.4   251.0        -5.6  ❌
3     110    225.0   229.1        -4.1  ❌
4     130    210.9   211.8        -0.9  ✓
5     150    204.5   199.2        -5.3  ❌ (应该是最小值)
```

**根本原因**：
- AI生成的y值变化不符合标准sin(x)函数
- 可能AI理解的"正弦波"不同
- 或者AI在数值计算中有精度问题

---

## 推荐方案优先级

### 第1优先级 ⭐⭐⭐ (立即实施)
**改进Gemini提示词** - 成本最低，效果最好
- 在`geminiService.ts`中添加完整的正弦波生成公式
- 提供具体的数值示例
- 说明采样点数要求

### 第2优先级 ⭐⭐
**添加前端验证** - 作为兜底方案
- 检测AI返回的是否真的是正弦波
- 如果不符合预期，自动修正或提示用户

### 第3优先级 ⭐
**创建专用曲线生成器** - 长期方案
- 为常见曲线(正弦、余弦、螺旋等)创建专用生成器
- AI调用这些生成器而不是自己计算点

---

## 测试数据对比

### 当前AI生成的数据分析
```javascript
const data = [
  {x: 50, y: 300}, {x: 70, y: 270.9}, {x: 90, y: 245.4},
  // ... 36个点
  {x: 750, y: 370.1}
];

// 分析
const xs = data.map(p => p.x);
const ys = data.map(p => p.y);
console.log('X range:', Math.min(...xs), '-', Math.max(...xs), '=', Math.max(...xs) - Math.min(...xs));
console.log('Y range:', Math.min(...ys), '-', Math.max(...ys), '=', Math.max(...ys) - Math.min(...ys));
console.log('Center Y:', (Math.min(...ys) + Math.max(...ys)) / 2);
console.log('Amplitude:', (Math.max(...ys) - Math.min(...ys)) / 2);
```

### 预期正确的正弦波
```javascript
// 正确的参数
const centerY = 300;
const amplitude = 100;
const wavelength = 400;
const startX = 50;
const pointCount = 36;

const correctData = [];
for (let i = 0; i < pointCount; i++) {
  const x = startX + i * 20;
  const y = centerY + amplitude * Math.sin(2 * Math.PI * (x - startX) / wavelength);
  correctData.push({x, y});
}
// 应该看起来更平滑，值符合标准sin函数
```

---

## 立即行动建议

1. **查看当前输出**：在浏览器console中验证当前正弦波的数据
2. **测试新提示词**：更新geminiService中的提示
3. **验证效果**：再次调用"Draw a sine wave"
4. **对比数据**：检查新数据是否符合sin函数
