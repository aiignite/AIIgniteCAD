# Blocks块管理和AI助手管理完整实现计划

## 项目概述

本文档详细说明了AIIgniteCAD项目中Blocks块管理和AI助手管理功能的完整实现计划。

## 现状分析

### 1. 助手管理状态确认

**✅ 助手管理已完整实现**

后端实现：
- `/Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/routes/assistants.ts` - 完整的CRUD端点
- 数据库表 `assistants` 已在Prisma schema中定义

前端实现：
- `RightPanel.tsx` 中的ASSISTANTS标签已有完整UI
- `apiService.ts` 已包含所有助手相关的API调用方法
- 支持创建、编辑、删除助手
- 支持自定义图标、描述、颜色

**结论：助手管理无需额外实现，功能完整。**

### 2. Blocks块管理现状

**❌ 块管理功能缺失**

数据库层面：
- ✅ `BlockDefinition` 表已存在（块定义）
- ✅ `BlockElement` 表已存在（块内元素）
- ✅ `BlockReference` 表已存在（块引用）

后端API：
- ❌ 缺少 `/api/blocks` 路由
- ❌ 缺少 `/api/block-references` 路由
- ❌ 缺少 `/api/blocks/:id/elements` 路由

前端实现：
- ❌ `RightPanel.tsx` 的BLOCKS标签只是占位符
- ❌ `apiService.ts` 缺少块相关的API方法
- ❌ `types.ts` 有类型定义，但无实际使用

---

## 实现计划

## 第一阶段：后端API实现（Blocks块管理）

### 1.1 创建块定义路由

**文件：** `/Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/routes/blocks.ts`

**API端点设计：**

```typescript
// GET /api/blocks
// 获取当前用户的所有块定义（包括全局块和项目块）
// Query参数：projectId (可选) - 筛选特定项目的块
router.get("/")

// POST /api/blocks
// 创建新的块定义
// Body: { name, description, basePointX, basePointY, projectId?, elements[], thumbnail?, isPublic? }
router.post("/")

// GET /api/blocks/:id
// 获取单个块定义（包含所有元素）
router.get("/:id")

// PUT /api/blocks/:id
// 更新块定义（名称、描述、基准点等）
router.put("/:id")

// DELETE /api/blocks/:id
// 删除块定义（软删除，保留引用）
router.delete("/:id")

// GET /api/blocks/:id/elements
// 获取块内的所有元素
router.get("/:id/elements")

// POST /api/blocks/:id/elements
// 向块添加元素
// Body: { elementData, displayOrder }
router.post("/:id/elements")

// PUT /api/blocks/:id/elements/:elementId
// 更新块内元素
router.put("/:id/elements/:elementId")

// DELETE /api/blocks/:id/elements/:elementId
// 从块中删除元素
router.delete("/:id/elements/:elementId")

// POST /api/blocks/:id/thumbnail
// 更新块缩略图
// Body: { thumbnail (base64) }
router.post("/:id/thumbnail")
```

**实现要点：**
- 使用 `authenticate` 中间件进行JWT认证
- 用户权限隔离：只能操作自己创建的块
- 支持项目块（projectId不为null）和全局块（projectId为null）
- 支持公开块（isPublic=true），其他用户可见但不可编辑
- 块元素存储为JSON，包含完整的CADElement数据
- 使用Prisma事务确保数据一致性

### 1.2 创建块引用路由

**文件：** `/Users/wyh/Documents/AIIgnite/AIIIgniteCAD/backend/src/routes/blockReferences.ts`

**API端点设计：**

```typescript
// GET /api/block-references
// 获取项目的所有块引用
// Query参数：projectId (必需)
router.get("/")

// POST /api/block-references
// 在项目中插入块引用
// Body: { projectId, blockDefinitionId, layerId?, insertionPointX/Y, rotationAngle?, scaleX?, scaleY?, properties? }
router.post("/")

// GET /api/block-references/:id
// 获取单个块引用详情
router.get("/:id")

// PUT /api/block-references/:id
// 更新块引用（位置、旋转、缩放）
// Body: { insertionPointX/Y?, rotationAngle?, scaleX?, scaleY?, layerId?, properties? }
router.put("/:id")

// DELETE /api/block-references/:id
// 删除块引用（软删除）
router.delete("/:id")

// POST /api/block-references/:id/explode
// 分解块引用（将块元素转换为普通元素）
router.post("/:id/explode")
```

**实现要点：**
- 验证blockDefinitionId存在
- 支持图层关联（layerId可选）
- 支持变换参数：旋转角度、X/Y缩放
- properties字段可覆盖块定义中的属性
- 软删除机制（isDeleted标记）
- 分解功能：将块引用转换为独立的图形元素

### 1.3 注册路由

**修改文件：** `/Users/wyh/Documents/AIIgnite/AIIIgniteCAD/backend/src/index.ts`

在路由注册部分添加：

```typescript
// Block routes
import blockRoutes from "./routes/blocks";
app.use('/api/blocks', blockRoutes);

// Block reference routes
import blockReferenceRoutes from "./routes/blockReferences";
app.use('/api/block-references', blockReferenceRoutes);
```

---

## 第二阶段：前端API服务

### 2.1 扩展apiService

**修改文件：** `/Users/wyh/Documents/AIIgnite/AIIgniteCAD/services/apiService.ts`

**添加接口定义：**

```typescript
export interface BlockDefinition {
  id: string;
  name: string;
  description?: string;
  basePoint: { x: number; y: number };
  thumbnail?: string;
  isPublic: boolean;
  userId: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
  elements?: BlockElement[];
}

export interface BlockElement {
  id: string;
  blockDefinitionId: string;
  elementData: CADElement;
  displayOrder: number;
  createdAt: string;
}

export interface BlockReference {
  id: string;
  projectId: string;
  blockDefinitionId: string;
  blockDefinition?: BlockDefinition;
  layerId?: string;
  insertionPoint: { x: number; y: number };
  rotationAngle: number;
  scaleX: number;
  scaleY: number;
  properties?: any;
  createdAt: string;
  updatedAt: string;
}
```

**添加API方法：**

```typescript
// === Block Definitions ===
async getBlocks(projectId?: string) {
  const query = projectId ? `?projectId=${projectId}` : '';
  return this.request<{ blocks: BlockDefinition[] }>(`/blocks${query}`);
}

async getBlock(id: string) {
  return this.request<{ block: BlockDefinition }>(`/blocks/${id}`);
}

async createBlock(data: {
  name: string;
  description?: string;
  basePointX: number;
  basePointY: number;
  projectId?: string;
  elements?: any[];
  thumbnail?: string;
  isPublic?: boolean;
}) {
  return this.request<{ block: BlockDefinition }>(`/blocks`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async updateBlock(id: string, data: {
  name?: string;
  description?: string;
  basePointX?: number;
  basePointY?: number;
  thumbnail?: string;
  isPublic?: boolean;
}) {
  return this.request<{ block: BlockDefinition }>(`/blocks/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

async deleteBlock(id: string) {
  return this.request(`/blocks/${id}`, {
    method: "DELETE",
  });
}

async getBlockElements(blockId: string) {
  return this.request<{ elements: BlockElement[] }>(`/blocks/${blockId}/elements`);
}

async addBlockElement(blockId: string, elementData: any, displayOrder?: number) {
  return this.request<{ element: BlockElement }>(`/blocks/${blockId}/elements`, {
    method: "POST",
    body: JSON.stringify({ elementData, displayOrder }),
  });
}

async updateBlockElement(blockId: string, elementId: string, elementData: any) {
  return this.request<{ element: BlockElement }>(`/blocks/${blockId}/elements/${elementId}`, {
    method: "PUT",
    body: JSON.stringify({ elementData }),
  });
}

async deleteBlockElement(blockId: string, elementId: string) {
  return this.request(`/blocks/${blockId}/elements/${elementId}`, {
    method: "DELETE",
  });
}

async updateBlockThumbnail(blockId: string, thumbnail: string) {
  return this.request<{ block: BlockDefinition }>(`/blocks/${blockId}/thumbnail`, {
    method: "POST",
    body: JSON.stringify({ thumbnail }),
  });
}

// === Block References ===
async getBlockReferences(projectId: string) {
  return this.request<{ references: BlockReference[] }>(`/block-references?projectId=${projectId}`);
}

async insertBlockReference(data: {
  projectId: string;
  blockDefinitionId: string;
  layerId?: string;
  insertionPointX: number;
  insertionPointY: number;
  rotationAngle?: number;
  scaleX?: number;
  scaleY?: number;
  properties?: any;
}) {
  return this.request<{ reference: BlockReference }>(`/block-references`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async updateBlockReference(id: string, data: {
  insertionPointX?: number;
  insertionPointY?: number;
  rotationAngle?: number;
  scaleX?: number;
  scaleY?: number;
  layerId?: string;
  properties?: any;
}) {
  return this.request<{ reference: BlockReference }>(`/block-references/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

async deleteBlockReference(id: string) {
  return this.request(`/block-references/${id}`, {
    method: "DELETE",
  });
}

async explodeBlockReference(id: string) {
  return this.request<{ elements: CADElement[] }>(`/block-references/${id}/explode`, {
    method: "POST",
  });
}
```

---

## 第三阶段：前端UI实现

### 3.1 Blocks管理界面

**修改文件：** `/Users/wyh/Documents/AIIgnite/AIIgniteCAD/components/RightPanel.tsx`

**在 `propTab === "BLOCKS"` 部分实现完整UI：**

```typescript
{propTab === "BLOCKS" && renderBlocksTab()}
```

**UI功能要求：**

1. **块列表区域**：
   - 显示当前用户的所有块定义
   - 区分全局块和项目块（使用视觉标记）
   - 显示块缩略图、名称、描述
   - 支持搜索/筛选功能

2. **块操作功能**：
   - 创建新块按钮
   - 每个块卡片显示：缩略图、名称、元素数量
   - 下拉菜单：编辑、删除、复制、设为公开/私有
   - 点击块卡片查看详细信息

3. **块详情编辑器**（当选择块时显示）：
   - 块名称编辑
   - 块描述编辑
   - 基准点坐标显示/编辑
   - 元素列表（显示块内所有图形元素）
   - 添加/删除元素按钮
   - 更新缩略图按钮
   - 保存/取消按钮

4. **创建新块表单**（模态框或内联表单）：
   - 块名称输入
   - 块描述输入（可选）
   - 基准点设置（默认为选中元素的中心点）
   - 项目选择（项目块 vs 全局块）
   - 公开/私有选项
   - 从当前选中元素创建块按钮

**状态管理：**

```typescript
// Blocks State
const [blocks, setBlocks] = useState<BlockDefinition[]>([]);
const [selectedBlock, setSelectedBlock] = useState<BlockDefinition | null>(null);
const [showCreateBlock, setShowCreateBlock] = useState(false);
const [blockForm, setBlockForm] = useState({
  name: "",
  description: "",
  basePointX: 0,
  basePointY: 0,
  projectId: null as string | null,
  isPublic: false,
});
const [blockSearchQuery, setBlockSearchQuery] = useState("");
```

**数据加载：**

```typescript
useEffect(() => {
  loadBlocks();
}, [currentProjectId]);

const loadBlocks = async () => {
  try {
    const api = await import("../services/apiService");
    const { blocks } = await api.apiService.getBlocks(currentProjectId);
    setBlocks(blocks);
  } catch (error) {
    console.error("Failed to load blocks:", error);
  }
};
```

### 3.2 块引用插入功能

**在主Canvas中实现块引用插入：**

1. **工具栏添加"插入块"按钮**：
   - 点击打开块选择对话框
   - 显示可用的块定义列表
   - 选择块后在画布上预览
   - 点击确认插入到指定位置

2. **块引用属性编辑**：
   - 在Inspector面板显示块引用属性
   - 可编辑：插入点、旋转角度、X/Y缩放
   - 可修改图层
   - "分解"按钮：将块转换为普通元素

3. **块引用渲染**：
   - 在Canvas.tsx中添加块引用的渲染逻辑
   - 应用变换矩阵（平移、旋转、缩放）
   - 支持选中和高亮

**实现文件：** `/Users/wyh/Documents/AIIgnite/AIIgniteCAD/components/Canvas.tsx`

**需要添加的功能：**

```typescript
// 在CADElement类型中已包含BLOCK_REFERENCE类型
// 需要添加块引用的渲染逻辑

const renderBlockReference = (ctx: CanvasRenderingContext2D, ref: BlockReference) => {
  const def = ref.blockDefinition;
  if (!def) return;

  ctx.save();
  
  // 应用变换
  ctx.translate(ref.insertionPoint.x, ref.insertionPoint.y);
  ctx.rotate(ref.rotationAngle * Math.PI / 180);
  ctx.scale(ref.scaleX, ref.scaleY);
  
  // 相对于基准点绘制所有元素
  const basePoint = def.basePoint;
  ctx.translate(-basePoint.x, -basePoint.y);
  
  // 绘制块内所有元素
  def.elements?.forEach(el => {
    renderElement(ctx, el);
  });
  
  ctx.restore();
};
```

---

## 第四阶段：集成与优化

### 4.1 类型定义更新

**修改文件：** `/Users/wyh/Documents/AIIgnite/AIIgniteCAD/types.ts`

确保类型定义完整：

```typescript
// BlockDefinition - 已存在，确认字段完整
export interface BlockDefinition {
  id: string;
  name: string;
  description?: string;
  basePoint: Point;
  elements: CADElement[];
  thumbnail?: string;
  isPublic?: boolean;
  userId?: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

// BlockReference - 已存在，确认字段完整
export interface BlockReference {
  id: string;
  blockDefinitionId: string;
  blockDefinition?: BlockDefinition;
  layer: string;
  insertionPoint: Point;
  rotation: number;
  scaleX: number;
  scaleY: number;
  properties?: Record<string, any>;
  selected?: boolean;
  color?: string;
}
```

### 4.2 App.tsx集成

**修改文件：** `/Users/wyh/Documents/AIIgnite/AIIgniteCAD/App.tsx`

**添加状态管理：**

```typescript
const [blockDefinitions, setBlockDefinitions] = useState<BlockDefinition[]>([]);
const [blockReferences, setBlockReferences] = useState<BlockReference[]>([]);
```

**添加处理函数：**

```typescript
// 创建块定义
const handleCreateBlock = async (name: string, elements: CADElement[]) => {
  // 计算包围盒和基准点
  const bounds = calculateBounds(elements);
  const basePoint = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  
  try {
    const api = await import("./services/apiService");
    const { block } = await api.apiService.createBlock({
      name,
      basePointX: basePoint.x,
      basePointY: basePoint.y,
      projectId: currentProject?.id,
      elements,
    });
    
    setBlockDefinitions(prev => [...prev, block]);
    showNotification(`Block "${name}" created successfully`);
  } catch (error) {
    showNotification("Failed to create block");
  }
};

// 插入块引用
const handleInsertBlock = async (blockDefinitionId: string, position: Point) => {
  try {
    const api = await import("./services/apiService");
    const { reference } = await api.apiService.insertBlockReference({
      projectId: currentProject!.id,
      blockDefinitionId,
      insertionPointX: position.x,
      insertionPointY: position.y,
    });
    
    setBlockReferences(prev => [...prev, reference]);
    showNotification("Block inserted");
  } catch (error) {
    showNotification("Failed to insert block");
  }
};

// 更新块引用
const handleUpdateBlockReference = async (id: string, updates: Partial<BlockReference>) => {
  try {
    const api = await import("./services/apiService");
    await api.apiService.updateBlockReference(id, updates);
    
    setBlockReferences(prev =>
      prev.map(ref => ref.id === id ? { ...ref, ...updates } : ref)
    );
  } catch (error) {
    showNotification("Failed to update block reference");
  }
};

// 分解块引用
const handleExplodeBlock = async (referenceId: string) => {
  try {
    const api = await import("./services/apiService");
    const { elements: explodedElements } = await api.apiService.explodeBlockReference(referenceId);
    
    // 将分解后的元素添加到画布
    setElements(prev => [...prev, ...explodedElements]);
    
    // 移除块引用
    setBlockReferences(prev => prev.filter(ref => ref.id !== referenceId));
    
    showNotification("Block exploded");
  } catch (error) {
    showNotification("Failed to explode block");
  }
};
```

### 4.3 Canvas渲染集成

**修改文件：** `/Users/wyh/Documents/AIIgnite/AIIgniteCAD/components/Canvas.tsx`

**添加块引用渲染：**

```typescript
// 在主渲染循环中添加
const renderCanvas = () => {
  // ... 现有渲染逻辑
  
  // 渲染块引用
  blockReferences.forEach(ref => {
    renderBlockReference(ctx, ref);
  });
  
  // ... 其他渲染逻辑
};
```

**添加块引用选择逻辑：**

```typescript
const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
  const pos = getMousePos(e);
  
  // 检查是否点击了块引用
  const clickedRef = blockReferences.find(ref => {
    const def = ref.blockDefinition;
    if (!def) return false;
    
    // 反向变换检查点是否在块内
    const transformedPos = inverseTransformPoint(pos, ref);
    return isPointInBlock(transformedPos, def);
  });
  
  if (clickedRef) {
    // 选中块引用
    setBlockReferences(prev =>
      prev.map(ref => ({
        ...ref,
        selected: ref.id === clickedRef.id
      }))
    );
    return;
  }
  
  // ... 现有的元素选择逻辑
};
```

---

## 第五阶段：测试验证方案

### 5.1 单元测试

**后端测试：**

创建测试文件：`/Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/tests/blocks.test.ts`

```typescript
describe('Block API', () => {
  test('GET /api/blocks - should return user blocks');
  test('POST /api/blocks - should create block');
  test('PUT /api/blocks/:id - should update block');
  test('DELETE /api/blocks/:id - should delete block');
  test('POST /api/blocks/:id/elements - should add element to block');
  test('DELETE /api/blocks/:id/elements/:elementId - should remove element');
});

describe('Block Reference API', () => {
  test('GET /api/block-references - should return project references');
  test('POST /api/block-references - should insert block reference');
  test('PUT /api/block-references/:id - should update reference');
  test('DELETE /api/block-references/:id - should delete reference');
  test('POST /api/block-references/:id/explode - should explode block');
});
```

### 5.2 集成测试

**前端组件测试：**

1. **RightPanel Blocks标签测试**：
   - 测试块列表渲染
   - 测试创建块表单
   - 测试块详情编辑
   - 测试块删除功能

2. **Canvas块引用测试**：
   - 测试块引用插入
   - 测试块引用渲染
   - 测试块引用变换
   - 测试块引用分解

### 5.3 手动测试清单

**块定义管理：**
- [ ] 创建全局块
- [ ] 创建项目块
- [ ] 编辑块名称和描述
- [ ] 向块添加元素
- [ ] 从块删除元素
- [ ] 更新块缩略图
- [ ] 删除块定义
- [ ] 设置块为公开/私有

**块引用操作：**
- [ ] 在项目中插入块引用
- [ ] 移动块引用位置
- [ ] 旋转块引用
- [ ] 缩放块引用
- [ ] 修改块引用图层
- [ ] 删除块引用
- [ ] 分解块引用
- [ ] 验证分解后的元素

**权限测试：**
- [ ] 用户只能操作自己的块
- [ ] 公开块对其他用户可见
- [ ] 其他用户不能编辑他人的块
- [ ] 项目块只在项目内可见

---

## 实施顺序建议

### 阶段1：后端API（2-3天）
1. 创建 `blocks.ts` 路由文件
2. 创建 `blockReferences.ts` 路由文件
3. 在 `index.ts` 中注册路由
4. 使用Postman测试所有API端点

### 阶段2：前端API服务（1天）
1. 扩展 `apiService.ts` 添加类型和方法
2. 测试API调用是否正常

### 阶段3：前端UI实现（3-4天）
1. 实现 `RightPanel.tsx` 的Blocks标签UI
2. 实现块列表、创建表单、详情编辑器
3. 添加块选择和预览功能

### 阶段4：Canvas集成（2-3天）
1. 在 `Canvas.tsx` 添加块引用渲染
2. 实现块引用选择和编辑
3. 实现块引用分解功能
4. 在 `App.tsx` 添加状态管理和处理函数

### 阶段5：测试与优化（2-3天）
1. 编写单元测试
2. 进行集成测试
3. 手动测试所有功能
4. 性能优化和bug修复

**总计：约10-14天**

---

## 关键技术点

### 1. 块引用变换矩阵

```typescript
// 世界坐标 → 块坐标
const worldToBlock = (worldPoint: Point, ref: BlockReference): Point => {
  // 1. 平移到原点
  let x = worldPoint.x - ref.insertionPoint.x;
  let y = worldPoint.y - ref.insertionPoint.y;
  
  // 2. 反向旋转
  const angle = -ref.rotationAngle * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;
  
  // 3. 反向缩放
  x = rx / ref.scaleX;
  y = ry / ref.scaleY;
  
  // 4. 相对于基准点
  x += ref.blockDefinition!.basePoint.x;
  y += ref.blockDefinition!.basePoint.y;
  
  return { x, y };
};
```

### 2. 块分解算法

```typescript
const explodeBlockReference = (ref: BlockReference): CADElement[] => {
  const def = ref.blockDefinition;
  if (!def) return [];
  
  return def.elements.map(el => {
    const clonedEl = { ...el };
    
    // 应用变换到每个元素的几何数据
    if (clonedEl.start) {
      clonedEl.start = transformPoint(clonedEl.start, ref);
    }
    if (clonedEl.end) {
      clonedEl.end = transformPoint(clonedEl.end, ref);
    }
    if (clonedEl.center) {
      clonedEl.center = transformPoint(clonedEl.center, ref);
    }
    // 处理其他几何属性...
    
    // 更新图层和属性
    clonedEl.layer = ref.layer;
    if (ref.color) {
      clonedEl.color = ref.color;
    }
    
    return clonedEl;
  });
};
```

### 3. 缩略图生成

```typescript
const generateBlockThumbnail = (elements: CADElement[]): string => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  // 设置缩略图尺寸
  canvas.width = 200;
  canvas.height = 200;
  
  // 计算包围盒
  const bounds = calculateBounds(elements);
  
  // 计算缩放比例以适应缩略图
  const scaleX = canvas.width / (bounds.maxX - bounds.minX + 20);
  const scaleY = canvas.height / (bounds.maxY - bounds.minY + 20);
  const scale = Math.min(scaleX, scaleY);
  
  // 居中绘制
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(scale, scale);
  ctx.translate(-(bounds.minX + bounds.maxX) / 2, -(bounds.minY + bounds.maxY) / 2);
  
  // 绘制所有元素
  elements.forEach(el => renderElement(ctx, el));
  
  return canvas.toDataURL('image/png');
};
```

---

## 潜在挑战与解决方案

### 挑战1：块引用的嵌套
**问题**：块定义中是否允许包含另一个块引用？
**解决方案**：
- 初期版本不支持嵌套块
- 在创建块时验证元素列表不包含BLOCK_REFERENCE类型
- 后续版本可考虑支持有限层级的嵌套

### 挑战2：块定义更新时的引用处理
**问题**：修改块定义后，现有引用是否自动更新？
**解决方案**：
- 块定义修改后，所有引用自动使用新定义（符合CAD惯例）
- 提供"版本管理"功能，允许保存块的多个版本
- 在BlockDefinition表添加version字段

### 挑战3：大量块引用的性能
**问题**：项目中包含大量块引用时的渲染性能
**解决方案**：
- 使用空间索引（如R-tree）加速块引用的查找和选择
- 实现LOD（Level of Detail），缩放较远时使用简化渲染
- 缓存块定义的渲染结果
- 使用Web Worker进行渲染计算

### 挑战4：块引用的属性覆盖
**问题**：如何处理块引用的属性（颜色、图层等）与块定义的冲突
**解决方案**：
- 优先级：块引用properties > 块定义属性
- 在BlockReference的properties字段存储覆盖的属性
- 渲染时检查并应用覆盖属性

---

## 总结

本实现计划涵盖了Blocks块管理和AI助手管理的完整功能设计。主要工作包括：

1. **后端API实现**：2个新路由文件，约20个API端点
2. **前端服务扩展**：约15个API方法
3. **UI界面实现**：块管理面板、块引用操作界面
4. **Canvas集成**：块引用渲染、选择、编辑、分解
5. **测试验证**：单元测试、集成测试、手动测试清单

**AI助手管理功能已完整实现，无需额外开发。**

建议按照阶段顺序实施，每个阶段完成后进行测试验证，确保功能稳定性后再进入下一阶段。
