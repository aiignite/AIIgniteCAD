# 属性检查器代码示例

## 目录
1. [基础使用](#基础使用)
2. [高级对象编辑](#高级对象编辑)
3. [自定义扩展](#自定义扩展)
4. [集成示例](#集成示例)

---

## 基础使用

### 示例 1：编辑线条属性

```typescript
// 在 App.tsx 中
const handleUpdateElement = (element: CADElement) => {
  const updatedElements = elements.map(el => 
    el.id === element.id ? element : el
  );
  setElements(updatedElements);
};

// 在 Canvas 中选择对象后，RightPanel 会显示 PropertyInspector
// 用户修改线条终点坐标
// 触发 onUpdateElement 回调
handleUpdateElement({
  id: "line-1",
  type: "LINE",
  start: { x: 100, y: 100 },
  end: { x: 250, y: 300 },  // 修改后的新坐标
  layer: "0",
  color: "#8b949e"
});
```

### 示例 2：批量修改颜色

```typescript
// PropertyInspector 支持多选
const selectedElements = [
  { id: "1", type: "LINE", color: "#fff" },
  { id: "2", type: "CIRCLE", color: "#fff" },
  { id: "3", type: "RECTANGLE", color: "#fff" }
];

// 用户在属性检查器中修改颜色为红色
selectedElements.forEach(el => {
  handleUpdateElement({
    ...el,
    color: "#ff0000"
  });
});
```

---

## 高级对象编辑

### 示例 3：创建并编辑齿轮

```typescript
// 创建齿轮
const createGear = (center: Point): CADElement => {
  return {
    id: Math.random().toString(36).substr(2, 9),
    type: "GEAR",
    center,
    numTeeth: 20,
    module: 2,
    pressureAngle: 20,
    addendum: 2,
    dedendum: 2.5,
    layer: "0",
    color: "#137fec"
  };
};

// 用户在 PropertyInspector 中修改齿数
const updateGear = (gear: CADElement) => {
  handleUpdateElement({
    ...gear,
    numTeeth: 24  // 从20改为24齿
  });
  // 触发重新生成齿轮几何形状
};
```

### 示例 4：创建并编辑螺旋线

```typescript
const createSpiral = (center: Point): CADElement => {
  return {
    id: Math.random().toString(36).substr(2, 9),
    type: "SPIRAL",
    center,
    turns: 5,           // 5圈
    radiusIncrement: 15, // 每圈增长15个单位
    points: [],         // 渲染时生成
    layer: "0",
    color: "#137fec"
  };
};

// 用户修改圈数为8
const updateSpiral = (spiral: CADElement) => {
  handleUpdateElement({
    ...spiral,
    turns: 8  // 更多的圈数
  });
};

// PropertyInspector 显示的属性：
// 圈数: 8
// 半径增量: 15
// 中心: (x, y)
```

### 示例 5：创建并编辑弹簧

```typescript
const createSpring = (center: Point): CADElement => {
  return {
    id: Math.random().toString(36).substr(2, 9),
    type: "SPRING",
    center,
    coils: 10,          // 10圈
    springRadius: 25,   // 弹簧半径
    wireRadius: 2,      // 线径
    points: [],         // 渲染时生成
    layer: "0",
    color: "#137fec"
  };
};

// 用户在PropertyInspector中调整参数
const updateSpring = (spring: CADElement) => {
  handleUpdateElement({
    ...spring,
    coils: 15,        // 增加到15圈
    springRadius: 30, // 半径变大
    wireRadius: 2.5   // 线径加粗
  });
};
```

---

## 自定义扩展

### 示例 6：添加新的对象类型支持

假设要添加对"POLYGON（多边形）"的属性编辑支持：

**第一步：更新 types.ts**

```typescript
// types.ts
export interface CADElement {
  // ... 现有属性 ...
  
  // 多边形特定属性
  sides?: number;        // 边数
  circumradius?: number; // 外接圆半径
}
```

**第二步：在 PropertyInspector.tsx 中添加面板**

```typescript
// PropertyInspector.tsx

// 在主体 render 中添加：
{(element.type === "POLYGON") && (
  <Section 
    title="多边形属性" 
    section="polygon" 
    expanded={expandedSections} 
    setExpanded={setExpandedSections}
  >
    <PolygonProperties element={element} onUpdateElement={onUpdateElement} />
  </Section>
)}

// 创建专用面板组件
const PolygonProperties: React.FC<{
  element: CADElement;
  onUpdateElement: (e: CADElement) => void;
}> = ({ element, onUpdateElement }) => {
  return (
    <div className="space-y-2 text-sm">
      <PropertyNumber
        label="边数"
        value={element.sides || 6}
        onChange={(sides) => onUpdateElement({ ...element, sides })}
        min={3}
        max={20}
      />
      <PropertyNumber
        label="外接圆半径"
        value={element.circumradius || 50}
        onChange={(circumradius) => 
          onUpdateElement({ ...element, circumradius })
        }
        min={10}
      />
      {element.center && (
        <PropertyPoint
          label="中心"
          value={element.center}
          onChange={(center) => onUpdateElement({ ...element, center })}
        />
      )}
    </div>
  );
};
```

### 示例 7：自定义输入组件

需要一个能通过拖动修改值的滑块组件：

```typescript
// 添加到 PropertyInspector.tsx

interface PropertySliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
}

const PropertySlider: React.FC<PropertySliderProps> = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1
}) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-cad-text-secondary">{label}:</label>
        <span className="font-mono text-xs text-cad-text">
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-cad-border rounded-lg appearance-none cursor-pointer accent-cad-primary"
      />
    </div>
  );
};

// 使用示例（在齿轮属性中使用滑块）：
<PropertySlider
  label="齿数"
  value={element.numTeeth || 20}
  onChange={(numTeeth) => onUpdateElement({ ...element, numTeeth })}
  min={3}
  max={100}
  step={1}
/>
```

---

## 集成示例

### 示例 8：完整的工作流程

```typescript
// App.tsx 中的完整集成

import PropertyInspector from './components/PropertyInspector';

function App() {
  const [elements, setElements] = useState<CADElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 获取选中的元素
  const selectedElements = elements.filter(el => el.selected);

  // 处理元素更新
  const handleUpdateElement = useCallback((updatedElement: CADElement) => {
    setElements(prevElements => 
      prevElements.map(el => 
        el.id === updatedElement.id ? updatedElement : el
      )
    );
    
    // 可选：触发历史记录
    updateHistory([...elements]);
  }, [elements]);

  return (
    <RightPanel
      mode={sideMode}
      // ... 其他 props ...
      currentElements={elements}
      onUpdateElement={handleUpdateElement}
    />
  );
}
```

### 示例 9：使用高级对象服务

```typescript
// App.tsx 中使用高级对象生成服务

import {
  generateGear,
  generateSpiral,
  generateSpring
} from './services/advancedShapesService';

const handleCreateGear = (center: Point) => {
  // 使用服务生成齿轮几何
  const gear = generateGear({
    center,
    numTeeth: 20,
    module: 2,
    pressureAngle: 20
  });
  
  // 添加到元素列表
  setElements([...elements, gear]);
};

const handleCreateSpiral = (center: Point) => {
  const spiral = generateSpiral({
    center,
    turns: 5,
    radiusIncrement: 15
  });
  
  setElements([...elements, spiral]);
};

const handleCreateSpring = (center: Point) => {
  const spring = generateSpring({
    center,
    coils: 10,
    springRadius: 25,
    wireRadius: 2
  });
  
  setElements([...elements, spring]);
};
```

### 示例 10：多选编辑示例

```typescript
// 用户选择多个对象后的编辑

const handleBatchEdit = (property: string, value: any) => {
  const selectedElements = elements.filter(el => el.selected);
  
  const updatedElements = elements.map(el => {
    if (el.selected) {
      // 更新所有选中对象的特定属性
      return { ...el, [property]: value };
    }
    return el;
  });
  
  setElements(updatedElements);
};

// 在 PropertyInspector 中：
// 用户修改多选对象的颜色
handleBatchEdit('color', '#ff0000');

// 或修改图层
handleBatchEdit('layer', 'CONSTRUCTION');
```

---

## 性能优化示例

### 示例 11：防止过度渲染

```typescript
// 使用 useCallback 防止 PropertyInspector 不必要的重新渲染

const handleUpdateElement = useCallback((element: CADElement) => {
  setElements(prevElements => 
    prevElements.map(el => 
      el.id === element.id ? element : el
    )
  );
}, []);

// 在 RightPanel 中：
<PropertyInspector
  selectedElements={currentElements.filter(el => el.selected)}
  onUpdateElement={handleUpdateElement}  // 引用稳定
/>
```

### 示例 12：批量更新优化

```typescript
// 避免逐个调用 onUpdateElement，改为批量更新

const handleBatchUpdate = useCallback((updates: CADElement[]) => {
  setElements(prevElements => {
    const updateMap = new Map(updates.map(u => [u.id, u]));
    return prevElements.map(el => updateMap.get(el.id) || el);
  });
}, []);

// 多个属性修改可以组合成一个更新
const element = { ...selectedElement };
element.color = '#ff0000';
element.layer = 'LAYER_1';
element.numTeeth = 24;  // 如果是齿轮

handleBatchUpdate([element]);
```

---

## 调试示例

### 示例 13：记录属性变化

```typescript
// 在开发期间调试属性更新

const handleUpdateElement = (element: CADElement) => {
  console.log('元素更新:', {
    id: element.id,
    type: element.type,
    changes: {
      color: element.color,
      layer: element.layer,
      // 根据类型显示相关属性
      ...(element.type === 'GEAR' && {
        numTeeth: element.numTeeth,
        module: element.module
      })
    }
  });
  
  setElements(prevElements => 
    prevElements.map(el => el.id === element.id ? element : el)
  );
};
```

---

## 总结

这些示例展示了：

1. ✅ 如何在 App.tsx 中集成 PropertyInspector
2. ✅ 如何创建和编辑各类对象
3. ✅ 如何扩展支持新的对象类型
4. ✅ 如何创建自定义输入组件
5. ✅ 如何处理多选对象的编辑
6. ✅ 性能优化策略
7. ✅ 调试和日志记录

所有代码遵循项目的 TypeScript 和 React 规范。
