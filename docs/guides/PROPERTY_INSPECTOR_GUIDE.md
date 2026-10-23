# 属性检查器（Property Inspector）实现指南

## 功能概述

已为 CAD 编辑器实现了一个**动态属性检查器面板**，可根据选中对象的类型自动显示对应的属性，支持实时编辑和预览。

## 核心特性

### 1. **类型感知的属性显示**
不同类型的对象显示不同的属性：

- **线条（LINE）**
  - 基本属性：ID、类型、图层、颜色
  - 几何属性：起点、终点

- **圆形（CIRCLE）**
  - 基本属性：ID、类型、图层、颜色
  - 圆形属性：中心点、半径

- **矩形（RECTANGLE）**
  - 基本属性：ID、类型、图层、颜色
  - 矩形属性：左上角、宽度、高度

- **文本（TEXT）**
  - 基本属性：ID、类型、图层、颜色
  - 文本属性：内容、字号、位置

- **弧线（ARC）**
  - 基本属性：ID、类型、图层、颜色
  - 弧线属性：中心、半径、起始角、结束角、顺时针

- **椭圆（ELLIPSE）**
  - 基本属性：ID、类型、图层、颜色
  - 椭圆属性：X轴半径、Y轴半径、旋转角度

- **齿轮（GEAR）** ⭐ 高级对象
  - 基本属性：ID、类型、图层、颜色
  - 几何属性：中心点
  - 齿轮属性：齿数、模数、压力角、齿顶高、齿根深

- **螺旋线（SPIRAL）** ⭐ 高级对象
  - 基本属性：ID、类型、图层、颜色
  - 螺旋线属性：圈数、半径增量、中心点

- **弹簧（SPRING）** ⭐ 高级对象
  - 基本属性：ID、类型、图层、颜色
  - 弹簧属性：圈数、弹簧半径、线径、中心点

- **多段线（LWPOLYLINE）**
  - 基本属性：ID、类型、图层、颜色
  - 多段线属性：顶点数、顶点列表

- **标注（DIMENSION）**
  - 基本属性：ID、类型、图层、颜色
  - 标注属性：起点、终点、偏移点、文本

### 2. **多选支持**
- 选中多个对象时显示"已选中N个对象"提示
- 支持批量编辑公共属性（图层、颜色）

### 3. **可收缩的属性分组**
属性按逻辑分组，可独立展开/收起：
- 基本属性（General）
- 几何属性（Geometry）
- 类型特定属性（如齿轮属性、文本属性等）

### 4. **实时编辑与预览**
- 数值输入支持增减拖动条
- 颜色选择器（十六进制代码 + 颜色面板）
- 坐标点编辑（X、Y分离）
- 修改立即反映在画布上

## 使用方法

### 在 RightPanel 中使用

PropertyInspector 已集成到 RightPanel 的 INSPECTOR 标签中：

```tsx
{propTab === "INSPECTOR" && (
  <PropertyInspector
    selectedElements={currentElements.filter((el) => el.selected)}
    onUpdateElement={onUpdateElement}
  />
)}
```

### 工作流程

1. **选择对象**
   - 在画布上点击对象进行选择
   - 对象将在属性检查器中显示其属性

2. **查看属性**
   - 根据对象类型，属性检查器自动显示相关部分
   - 点击分组标题可展开/收起

3. **编辑属性**
   - 直接在输入框中修改数值
   - 对于颜色，可点击色块或输入十六进制代码
   - 对于坐标，支持分别编辑X和Y

4. **实时预览**
   - 修改后按Enter或失焦时，画布立即更新
   - 对象视觉效果实时反映修改结果

## 组件结构

### PropertyInspector 主组件
- **文件**：`components/PropertyInspector.tsx`
- **职责**：管理选中元素、分组展开状态、条件渲染类型特定面板

### 属性组件

1. **基本组件**（可复用）
   - `PropertyField`：文本输入字段
   - `PropertyNumber`：数值输入框
   - `PropertyPoint`：坐标编辑（X、Y分离）
   - `PropertySelect`：下拉选择
   - `PropertyColorPicker`：颜色选择器
   - `PropertyToggle`：开关按钮

2. **通用面板**
   - `GeneralProperties`：ID、类型、图层、颜色
   - `GeometryProperties`：起点、终点、中心、半径
   - `CommonPropertiesPanel`：多选时的公共属性

3. **类型特定面板**
   - `TextProperties`：文本内容、字号、位置
   - `CircleArcProperties`：圆弧特定属性
   - `EllipseProperties`：椭圆属性
   - `GearProperties`：齿轮参数
   - `SpiralProperties`：螺旋线参数
   - `SpringProperties`：弹簧参数
   - `PolylineProperties`：多段线顶点
   - `RectangleProperties`：矩形尺寸
   - `DimensionProperties`：标注点和文本

## 支持的高级对象

### 齿轮（GEAR）
```typescript
{
  type: "GEAR",
  numTeeth: 20,           // 齿数
  module: 1,              // 模数
  pressureAngle: 20,      // 压力角（度）
  addendum: 1,            // 齿顶高
  dedendum: 1.25,         // 齿根深
  center: { x, y }        // 中心点
}
```

### 螺旋线（SPIRAL）
```typescript
{
  type: "SPIRAL",
  turns: 5,               // 圈数
  radiusIncrement: 10,    // 每圈半径增量
  center: { x, y },       // 中心点
  points: [...]           // 生成的螺旋点
}
```

### 弹簧（SPRING）
```typescript
{
  type: "SPRING",
  coils: 10,              // 圈数
  springRadius: 20,       // 弹簧半径
  wireRadius: 2,          // 线径
  center: { x, y },       // 中心点
  points: [...]           // 生成的弹簧点
}
```

## API 参考

### PropertyInspector Props

```typescript
interface PropertyInspectorProps {
  // 当前选中的元素数组
  selectedElements: CADElement[];
  
  // 元素更新回调
  onUpdateElement: (element: CADElement) => void;
}
```

### 更新触发方式

当用户编辑属性时，调用 `onUpdateElement(updatedElement)`：

```typescript
// 例如编辑线条的终点
onUpdateElement({
  ...element,
  end: { x: 200, y: 300 }
});
```

## 样式定制

属性检查器使用项目的 Tailwind CSS 变量：

| 变量 | 用途 |
|------|------|
| `bg-cad-panel` | 面板背景 |
| `bg-cad-secondary` | 分组背景 |
| `bg-cad-border` | 边框颜色 |
| `text-cad-text` | 主文本颜色 |
| `text-cad-text-secondary` | 辅助文本 |
| `bg-cad-primary` | 强调颜色 |

## 扩展指南

### 添加新的对象类型支持

1. 在 `PropertyInspector.tsx` 中添加新的 Section：

```tsx
{(element.type === "NEW_TYPE") && (
  <Section 
    title="新类型属性" 
    section="newtype" 
    expanded={expandedSections} 
    setExpanded={setExpandedSections}
  >
    <NewTypeProperties 
      element={element} 
      onUpdateElement={onUpdateElement} 
    />
  </Section>
)}
```

2. 创建对应的属性面板组件：

```tsx
const NewTypeProperties: React.FC<...> = ({ element, onUpdateElement }) => {
  return (
    <div className="space-y-2 text-sm">
      <PropertyNumber
        label="新属性"
        value={element.customProp || 0}
        onChange={(customProp) => 
          onUpdateElement({ ...element, customProp })
        }
      />
    </div>
  );
};
```

3. 在 `types.ts` 中为 CADElement 添加新的属性字段（如需要）

### 自定义输入组件

如需特殊的输入控件，参考现有组件的模式创建新组件：

```tsx
interface CustomPropertyProps {
  label: string;
  value: any;
  onChange: (value: any) => void;
}

const CustomProperty: React.FC<CustomPropertyProps> = ({
  label, value, onChange
}) => {
  return (
    <div className="flex items-center justify-between">
      <label className="text-cad-text-secondary">{label}:</label>
      {/* Custom input */}
    </div>
  );
};
```

## 性能考虑

- 属性更新通过 `onUpdateElement` 回调进行，不会创建新的数组引用
- 选中元素的过滤在 RightPanel 中完成
- 分组收缩状态仅在 PropertyInspector 中维护本地状态

## 已知限制

1. 暂不支持批量编辑不同类型对象的特定属性
2. 坐标编辑不支持单位转换（与全局设置保持一致）
3. 某些高级属性（如曲线上的点）以只读列表形式显示

## 集成检查清单

- ✅ PropertyInspector 组件创建并导出
- ✅ RightPanel 导入 PropertyInspector
- ✅ INSPECTOR 标签使用 PropertyInspector 渲染
- ✅ 支持所有基础对象类型
- ✅ 支持所有高级对象类型（齿轮、螺旋、弹簧）
- ✅ 多选支持
- ✅ 构建通过

## 测试步骤

1. **基础测试**
   ```bash
   npm run dev
   ```
   - 在画布上创建各种对象（线、圆、矩形、文本等）
   - 在画布上选中对象
   - 验证属性检查器显示正确的属性

2. **编辑测试**
   - 修改属性值（颜色、坐标、尺寸等）
   - 验证画布上的对象实时更新

3. **高级对象测试**
   - 使用工具栏创建齿轮、螺旋、弹簧
   - 选中后验证高级属性面板显示
   - 编辑参数并验证预览

4. **多选测试**
   - 选中多个不同类型的对象
   - 验证显示"已选中N个对象"
   - 批量修改公共属性并验证

## 相关文件

- 📄 [PropertyInspector.tsx](../components/PropertyInspector.tsx) - 主要实现
- 📄 [RightPanel.tsx](../components/RightPanel.tsx) - 集成点
- 📄 [types.ts](../types.ts) - 类型定义
- 📄 [App.tsx](../App.tsx) - 元素状态管理
