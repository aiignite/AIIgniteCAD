# 属性检查器技术架构

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                      RightPanel.tsx                      │
│              (右侧面板容器，管理标签)                    │
└──────────────┬──────────────────────────────────────────┘
               │
               │ propTab === "INSPECTOR"
               │
┌──────────────▼──────────────────────────────────────────┐
│              PropertyInspector.tsx                       │
│         (主组件，类型检测和分组管理)                     │
├──────────────────────────────────────────────────────────┤
│  - selectedElements: CADElement[]                       │
│  - expandedSections: Set<string>                        │
│  - 动态选择要渲染的属性面板                              │
└──────────────┬──────────────────────────────────────────┘
               │
        ┌──────┴────────┬──────────────┬─────────────┬─────────────┐
        │               │              │             │             │
   ┌────▼─────┐  ┌─────▼────┐  ┌──────▼──┐  ┌──────▼─────┐  ┌────▼──────┐
   │ General  │  │ Geometry │  │  TYPE   │  │  Specific │  │  Common   │
   │Properties│  │Properties│  │Properties│ │ Properties│  │Properties │
   └──────────┘  └──────────┘  └─────────┘  └───────────┘  └───────────┘
        │               │              │             │             │
        └───────────────┴──────────────┴─────────────┴─────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Input Components    │
                    ├───────────────────────┤
                    │ • PropertyField       │
                    │ • PropertyNumber      │
                    │ • PropertyPoint       │
                    │ • PropertySelect      │
                    │ • PropertyColorPicker │
                    │ • PropertyToggle      │
                    │ • Section (分组)      │
                    └───────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  onUpdateElement()    │
                    │  (回调到 App.tsx)      │
                    └───────────────────────┘
```

---

## 文件结构

```
components/
├── PropertyInspector.tsx          # 核心组件（~650行）
│   ├── PropertyInspector          # 主组件
│   ├── Section                    # 分组容器
│   ├── GeneralProperties          # 通用属性面板
│   ├── GeometryProperties         # 几何属性面板
│   ├── TextProperties             # 文本属性面板
│   ├── CircleArcProperties        # 圆弧属性面板
│   ├── EllipseProperties          # 椭圆属性面板
│   ├── GearProperties             # 齿轮属性面板 ⭐
│   ├── SpiralProperties           # 螺旋线属性面板 ⭐
│   ├── SpringProperties           # 弹簧属性面板 ⭐
│   ├── PolylineProperties         # 多段线属性面板
│   ├── RectangleProperties        # 矩形属性面板
│   ├── DimensionProperties        # 标注属性面板
│   ├── CommonPropertiesPanel      # 多选属性面板
│   │
│   └── 输入组件（可复用）
│       ├── PropertyField
│       ├── PropertyNumber
│       ├── PropertyPoint
│       ├── PropertySelect
│       ├── PropertyColorPicker
│       └── PropertyToggle
│
├── RightPanel.tsx                 # 集成点
│   └── 在 INSPECTOR 标签中使用 PropertyInspector
│
└── Canvas.tsx                     # 渲染（不修改）
```

---

## 组件API

### PropertyInspector

**Props:**
```typescript
interface PropertyInspectorProps {
  // 当前选中的元素数组
  selectedElements: CADElement[];
  
  // 元素更新回调
  onUpdateElement: (element: CADElement) => void;
}
```

**状态：**
```typescript
const [expandedSections, setExpandedSections] = useState<Set<string>>(
  new Set(["general", "geometry"])
);
```

**行为：**
- 0个元素：显示"未选中对象"提示
- 1个元素：根据类型显示对应属性面板
- >1个元素：显示公共属性编辑面板

### Section（分组容器）

**Props：**
```typescript
interface SectionProps {
  title: string;              // 分组标题
  section: string;            // 唯一ID
  expanded: Set<string>;      // 展开状态集合
  setExpanded: (s: Set<string>) => void;  // 状态更新函数
  children: React.ReactNode;  // 内容
}
```

**行为：**
- 点击标题切换展开/收起
- 展开时显示向下箭头，收起时向右
- 支持平滑的动画过渡

### 输入组件

#### PropertyNumber

```typescript
interface PropertyNumberProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}
```

特点：
- 支持键盘输入数值
- 支持 min/max 边界检查
- 支持自定义步长（step）
- 输入框样式：`bg-cad-bg border-cad-border focus:border-cad-primary`

#### PropertyPoint

```typescript
interface PropertyPointProps {
  label: string;
  value: Point;
  onChange: (value: Point) => void;
}
```

特点：
- X、Y 分离输入
- 各占50%宽度
- 独立的变化事件

#### PropertyColorPicker

```typescript
interface PropertyColorPickerProps {
  label: string;
  value: string;      // 十六进制颜色代码
  onChange: (value: string) => void;
}
```

特点：
- HTML5 原生颜色选择器
- 显示颜色预览块
- 十六进制代码输入框
- 实时同步

---

## 数据流

### 单选对象属性编辑流程

```
用户在画布上点击对象
         │
         ▼
Canvas 触发 onSelect(element)
         │
         ▼
App.tsx 更新 elements 状态
         │ element.selected = true
         ▼
RightPanel 接收 currentElements props
         │
         ▼
PropertyInspector 接收 selectedElements
         │ 过滤 element.selected === true
         ▼
根据 element.type 选择属性面板
         │
         ▼
显示相关属性输入框
         │
用户修改某个属性值
         │
         ▼
PropertyXxx 组件 onChange 触发
         │
         ▼
调用 onUpdateElement(updatedElement)
         │
         ▼
App.tsx handleUpdateElement
         │ 更新 elements 状态
         ▼
Canvas 重新渲染对象
         │
         ▼
属性检查器 selectedElements 更新
         │
         ▼
显示新的属性值 ✓
```

### 多选对象属性编辑流程

```
用户选中多个对象
         │
         ▼
App.tsx elements 中多个元素的 selected = true
         │
         ▼
RightPanel 接收 currentElements
         │
         ▼
PropertyInspector 接收 selectedElements (length > 1)
         │
         ▼
判断 selectedElements.length > 1
         │
         ▼
渲染 CommonPropertiesPanel
         │ (仅显示公共属性：图层、颜色)
         ▼
用户修改公共属性
         │
         ▼
遍历所有 selectedElements，调用 onUpdateElement
         │
         ▼
App.tsx 批量更新所有选中元素
         │
         ▼
Canvas 重新渲染所有对象 ✓
```

---

## 类型系统

### CADElement 类型支持

| 类型 | 基础属性 | 特定属性 | 属性面板 |
|------|---------|--------|--------|
| LINE | layer, color, id | start, end | GeneralProperties, GeometryProperties |
| CIRCLE | layer, color, id | center, radius | GeneralProperties, GeometryProperties |
| RECTANGLE | layer, color, id | start, width, height | GeneralProperties, GeometryProperties, RectangleProperties |
| TEXT | layer, color, id | start, text, fontSize | GeneralProperties, TextProperties |
| ARC | layer, color, id | center, radius, startAngle, endAngle, clockwise | GeneralProperties, GeometryProperties, CircleArcProperties |
| ELLIPSE | layer, color, id | center, radiusX, radiusY, rotation | GeneralProperties, EllipseProperties |
| GEAR | layer, color, id | center, numTeeth, module, pressureAngle, addendum, dedendum | GeneralProperties, GeometryProperties, GearProperties |
| SPIRAL | layer, color, id | center, turns, radiusIncrement, points | GeneralProperties, SpiralProperties |
| SPRING | layer, color, id | center, coils, springRadius, wireRadius, points | GeneralProperties, SpringProperties |
| LWPOLYLINE | layer, color, id | points | GeneralProperties, PolylineProperties |
| DIMENSION | layer, color, id | start, end, offsetPoint, text | GeneralProperties, DimensionProperties |

---

## 渲染策略

### 条件渲染

```typescript
// PropertyInspector 主体结构

if (selectedElements.length === 0) {
  // 显示提示
  return <empty state>
}

if (selectedElements.length > 1) {
  // 显示多选面板
  return <CommonPropertiesPanel>
}

// 单选 (selectedElements.length === 1)
const element = selectedElements[0];

return (
  <>
    <Section title="基本属性">
      <GeneralProperties />
    </Section>
    
    <Section title="几何属性">
      <GeometryProperties />
    </Section>
    
    {element.type === "TEXT" && (
      <Section title="文本属性">
        <TextProperties />
      </Section>
    )}
    
    {element.type === "GEAR" && (
      <Section title="齿轮属性">
        <GearProperties />
      </Section>
    )}
    
    // ... 其他类型 ...
  </>
)
```

### 样式和主题

**颜色方案（CSS 变量）：**
```css
--cad-panel: 主面板背景
--cad-secondary: 次要元素背景
--cad-bg: 输入框背景
--cad-border: 边框颜色
--cad-text: 主文本颜色
--cad-text-secondary: 辅助文本颜色
--cad-primary: 强调/主色调
--cad-hover: 悬停状态
```

**布局约定：**
- 标题：`text-xs font-bold text-cad-text`
- 标签：`text-cad-text-secondary text-xs`
- 输入框：`bg-cad-bg border border-cad-border rounded px-2 py-1`
- 间距：使用 `space-y-2` 作为标准行距

---

## 性能特性

### 优化措施

1. **本地状态管理**
   - 分组展开状态仅在 PropertyInspector 中维护
   - 不提升到 App.tsx，减少全局重新渲染

2. **条件渲染**
   - 仅渲染与当前对象类型相关的属性面板
   - 减少 DOM 节点数量

3. **回调稳定性**
   - `onUpdateElement` 通过 useCallback 稳定（在 RightPanel 中）
   - 防止子组件不必要的重新渲染

4. **过滤操作**
   - 在 RightPanel 中过滤选中元素
   - PropertyInspector 接收已过滤的元素

### 复杂度分析

- **时间复杂度**：O(1) 属性查看，O(1) 单个属性编辑
- **空间复杂度**：O(P) P为对象属性数量（通常 < 20）
- **渲染复杂度**：O(1) 单选模式，O(N) N为公共属性数

---

## 扩展机制

### 添加新类型支持的步骤

1. **定义类型**
   - 在 `types.ts` 中的 `CADElement` 添加新属性

2. **创建面板组件**
   ```tsx
   const NewTypeProperties: React.FC<Props> = ({ element, onUpdateElement }) => {
     return <div>...</div>;
   };
   ```

3. **注册到 PropertyInspector**
   ```tsx
   {element.type === "NEW_TYPE" && (
     <Section title="...">
       <NewTypeProperties />
     </Section>
   )}
   ```

4. **测试**
   - 创建新类型的对象
   - 验证属性面板显示
   - 验证编辑功能

---

## 错误处理

### 当前实现

1. **缺失属性**
   - 使用默认值或可选链接（?.）
   - 例：`element.color || "#000000"`

2. **类型不匹配**
   - TypeScript 类型检查防止运行时错误
   - 属性值范围由 HTML input 属性限制（min/max）

3. **无效输入**
   - 数值输入框验证数值范围
   - 颜色选择器返回有效的十六进制颜色

---

## 集成检查清单

- [x] PropertyInspector 组件完整实现
- [x] 所有输入组件完整实现
- [x] 所有属性面板完整实现
- [x] RightPanel 正确导入和使用
- [x] 类型系统完整性
- [x] 样式和主题适配
- [x] 深色模式支持
- [x] TypeScript 编译检查
- [x] 生产构建验证
- [x] 文档完整性

---

## 相关资源

- 📄 [PROPERTY_INSPECTOR_GUIDE.md](PROPERTY_INSPECTOR_GUIDE.md) - 使用指南
- 📄 [PROPERTY_INSPECTOR_EXAMPLES.md](PROPERTY_INSPECTOR_EXAMPLES.md) - 代码示例
- 📄 [PROPERTY_INSPECTOR_TEST_REPORT.md](PROPERTY_INSPECTOR_TEST_REPORT.md) - 测试报告
- 📁 [components/PropertyInspector.tsx](components/PropertyInspector.tsx) - 源代码
- 📁 [components/RightPanel.tsx](components/RightPanel.tsx) - 集成点

---

## 版本信息

- **版本**：1.0.0
- **发布日期**：2026年1月21日
- **兼容性**：React 19.2.3+，TypeScript 5.0+
- **构建工具**：Vite 6.2.0
- **样式系统**：Tailwind CSS 3.x + CSS 变量

---

最后更新：2026年1月21日
