# AIIgniteCAD Database & Architecture Design

## 📋 目录

1. [项目概述](#项目概述)
2. [技术栈](#技术栈)
3. [数据库设计](#数据库设计)
4. [IndexedDB本地存储](#indexeddb本地存储)
5. [CAD函数库](#cad函数库)
6. [Blocks块功能](#blocks块功能)
7. [API接口设计](#api接口设计)
8. [实施步骤](#实施步骤)
9. [数据同步策略](#数据同步策略)

---

## 项目概述

AIIgniteCAD是一个基于Web的AI驱动CAD编辑器，支持DXF文件导入/导出、实时协作和AI辅助设计。本文档详细说明了添加后端PostgreSQL数据库支持、本地IndexedDB存储和CAD复杂操作函数库的完整设计方案。

### 核心功能扩展

- ✅ **PostgreSQL后端数据库** - 支持云端数据持久化和多用户协作
- ✅ **IndexedDB本地存储** - 支持离线工作和快速本地访问
- ✅ **Blocks块功能** - CAD核心功能，支持将多个图形组装为可重用的块
- ✅ **CAD函数库** - 完整的几何运算、变换、编辑操作库
- ✅ **数据同步机制** - 在线/离线自动同步策略

---

## 技术栈

### 前端
- **框架**: React 19.2.3 + TypeScript
- **构建工具**: Vite 6.2.0
- **样式**: Tailwind CSS
- **本地存储**: IndexedDB
- **状态管理**: React Hooks

### 后端
- **运行时**: Node.js 18+
- **框架**: Express 4.18
- **数据库**: PostgreSQL 14+
- **ORM**: Prisma 5.8
- **认证**: JWT + bcryptjs
- **实时通信**: Socket.IO 4.6
- **API验证**: express-validator

### CAD函数库
- **TypeScript** 纯函数式设计
- **零依赖** 轻量级实现
- **类型安全** 完整的类型定义

---

## 数据库设计

### PostgreSQL数据库表结构

#### 1. users - 用户表
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

**字段说明**:
- `id`: 用户唯一标识
- `username`: 用户名（唯一）
- `email`: 邮箱（唯一）
- `password_hash`: 密码哈希值
- `created_at`: 创建时间
- `updated_at`: 更新时间

---

#### 2. projects - 项目/文件表
```sql
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    thumbnail TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_opened_at TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_updated_at ON projects(updated_at);
CREATE INDEX idx_projects_last_opened_at ON projects(last_opened_at);
```

**字段说明**:
- `id`: 项目唯一标识
- `user_id`: 所属用户ID（外键）
- `name`: 项目名称
- `description`: 项目描述
- `thumbnail`: 缩略图（Base64或URL）
- `last_opened_at`: 最后打开时间
- `is_deleted`: 软删除标记

---

#### 3. drawing_settings - 图纸设置表
```sql
CREATE TABLE drawing_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    units VARCHAR(10) DEFAULT 'mm',
    grid_spacing NUMERIC(10, 2) DEFAULT 10,
    snap_distance NUMERIC(10, 2) DEFAULT 5,
    dim_scale NUMERIC(10, 2) DEFAULT 1,
    dim_precision INTEGER DEFAULT 2,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

**字段说明**:
- `units`: 单位（mm, cm, m, in, ft）
- `grid_spacing`: 网格间距
- `snap_distance`: 捕捉距离
- `dim_scale`: 标注缩放因子
- `dim_precision`: 标注精度（小数位数）

---

#### 4. layers - 图层表
```sql
CREATE TABLE layers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(50) NOT NULL,
    is_visible BOOLEAN DEFAULT TRUE,
    is_locked BOOLEAN DEFAULT FALSE,
    line_type VARCHAR(50) DEFAULT 'CONTINUOUS',
    line_weight NUMERIC(5, 2),
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_layers_project_id ON layers(project_id);
CREATE INDEX idx_layers_display_order ON layers(display_order);
```

**字段说明**:
- `line_type`: 线型（CONTINUOUS, DASHED, DOTTED, DASHDOT）
- `line_weight`: 线宽
- `display_order`: 显示顺序

---

#### 5. block_definitions - 块定义表 ⭐核心功能⭐
```sql
CREATE TABLE block_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    base_point_x NUMERIC(15, 6) NOT NULL,
    base_point_y NUMERIC(15, 6) NOT NULL,
    thumbnail TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_block_definitions_user_id ON block_definitions(user_id);
CREATE INDEX idx_block_definitions_project_id ON block_definitions(project_id);
CREATE INDEX idx_block_definitions_name ON block_definitions(name);
CREATE INDEX idx_block_definitions_is_public ON block_definitions(is_public);
```

**字段说明**:
- `user_id`: 创建者ID
- `project_id`: 项目特定块（NULL表示全局块）
- `name`: 块名称
- `base_point_x/y`: 块的基准点坐标
- `is_public`: 是否公开共享

**Blocks功能说明**:
Blocks是CAD的核心功能之一，允许用户将多个图形元素组合成一个可重用的单元。类似于编程中的函数或模块化设计：
- **块定义**: 定义一次，多次使用
- **块引用**: 在图纸中插入块的实例
- **变换**: 支持旋转、缩放、镜像
- **嵌套**: 块可以包含其他块
- **库管理**: 公共块库和私有块库

---

#### 6. block_elements - 块内部元素表
```sql
CREATE TABLE block_elements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    block_definition_id UUID NOT NULL REFERENCES block_definitions(id) ON DELETE CASCADE,
    element_data JSONB NOT NULL,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_block_elements_block_def_id ON block_elements(block_definition_id);
CREATE INDEX idx_block_elements_display_order ON block_elements(display_order);
```

**字段说明**:
- `element_data`: 存储完整的CADElement JSON数据
- `display_order`: 元素绘制顺序

---

#### 7. block_references - 块引用表
```sql
CREATE TABLE block_references (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    block_definition_id UUID NOT NULL REFERENCES block_definitions(id) ON DELETE RESTRICT,
    layer_id UUID REFERENCES layers(id) ON DELETE SET NULL,
    insertion_point_x NUMERIC(15, 6) NOT NULL,
    insertion_point_y NUMERIC(15, 6) NOT NULL,
    rotation_angle NUMERIC(10, 4) DEFAULT 0,
    scale_x NUMERIC(10, 4) DEFAULT 1,
    scale_y NUMERIC(10, 4) DEFAULT 1,
    properties JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_block_references_project_id ON block_references(project_id);
CREATE INDEX idx_block_references_block_def_id ON block_references(block_definition_id);
CREATE INDEX idx_block_references_layer_id ON block_references(layer_id);
```

**字段说明**:
- `insertion_point_x/y`: 插入点坐标
- `rotation_angle`: 旋转角度（度）
- `scale_x/y`: X/Y方向缩放因子
- `properties`: 可覆盖的块属性（JSONB格式）

---

#### 8. elements - 图形元素表
```sql
CREATE TABLE elements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    layer_id UUID REFERENCES layers(id) ON DELETE SET NULL,
    element_type VARCHAR(50) NOT NULL,
    geometry_data JSONB NOT NULL,
    properties JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_elements_project_id ON elements(project_id);
CREATE INDEX idx_elements_layer_id ON elements(layer_id);
CREATE INDEX idx_elements_element_type ON elements(element_type);
CREATE INDEX idx_elements_is_deleted ON elements(is_deleted);
```

**字段说明**:
- `element_type`: 元素类型（LINE, CIRCLE, RECTANGLE, LWPOLYLINE, TEXT, ARC, DIMENSION）
- `geometry_data`: 几何数据（JSONB格式，包含所有坐标点）
- `properties`: 其他属性（颜色、线宽等）

---

#### 9. project_versions - 项目版本/历史表
```sql
CREATE TABLE project_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    snapshot_data JSONB NOT NULL,
    commit_message TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, version_number)
);

CREATE INDEX idx_project_versions_project_id ON project_versions(project_id);
CREATE INDEX idx_project_versions_created_at ON project_versions(created_at);
```

**字段说明**:
- `version_number`: 版本号（递增）
- `snapshot_data`: 完整的项目快照（JSONB）
- `commit_message`: 提交说明

---

#### 10. chat_sessions - 聊天会话表
```sql
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_chat_sessions_project_id ON chat_sessions(project_id);
CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id);
```

---

#### 11. chat_messages - 聊天消息表
```sql
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    sender_type VARCHAR(20) NOT NULL,
    message_type VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at);
```

**字段说明**:
- `sender_type`: 'user' 或 'ai'
- `message_type`: 'text' 或 'action'
- `metadata`: AI操作的详细信息

---

#### 12. llm_models - AI模型配置表
```sql
CREATE TABLE llm_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    model_id VARCHAR(255) NOT NULL,
    api_key_encrypted TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    configuration JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_llm_models_user_id ON llm_models(user_id);
CREATE INDEX idx_llm_models_provider ON llm_models(provider);
CREATE INDEX idx_llm_models_is_active ON llm_models(is_active);
```

**字段说明**:
- `provider`: 'Google', 'Ollama', 'Anthropic', 'OpenAI'
- `api_key_encrypted`: 加密的API密钥
- `configuration`: 模型配置参数

---

### 数据库关系图

```
users (用户)
  │
  ├──> projects (项目)
  │     │
  │     ├──> drawing_settings (图纸设置) [1:1]
  │     ├──> layers (图层) [1:N]
  │     ├──> elements (图形元素) [1:N]
  │     ├──> block_references (块引用) [1:N]
  │     ├──> project_versions (版本历史) [1:N]
  │     └──> chat_sessions (聊天会话) [1:N]
  │
  ├──> block_definitions (块定义) [1:N]
  │     │
  │     └──> block_elements (块内部元素) [1:N]
  │
  └──> llm_models (AI模型配置) [1:N]

block_definitions ──> block_references (块定义被引用)
layers ──> elements (图层包含元素)
layers ──> block_references (图层包含块引用)
chat_sessions ──> chat_messages (会话包含消息) [1:N]
```

---

## IndexedDB本地存储

### Object Stores（对象存储）

IndexedDB结构镜像PostgreSQL设计，支持离线工作：

```javascript
const DB_STORES = {
    projects: 'projects',              // 项目
    elements: 'elements',              // 图形元素
    blockDefinitions: 'blockDefinitions',  // 块定义
    blockElements: 'blockElements',    // 块内部元素
    blockReferences: 'blockReferences',    // 块引用
    layers: 'layers',                  // 图层
    drawingSettings: 'drawingSettings',    // 图纸设置
    chatSessions: 'chatSessions',      // 聊天会话
    chatMessages: 'chatMessages',      // 聊天消息
    syncQueue: 'syncQueue',            // 同步队列
    cacheMetadata: 'cacheMetadata',    // 缓存元数据
    user: 'user'                       // 当前用户
};
```

### 索引策略

```javascript
// projects store
projectStore.createIndex('userId', 'userId', { unique: false });
projectStore.createIndex('updatedAt', 'lastModified', { unique: false });
projectStore.createIndex('lastOpenedAt', 'lastOpened', { unique: false });

// elements store
elementStore.createIndex('projectId', 'projectId', { unique: false });
elementStore.createIndex('layerId', 'layer', { unique: false });
elementStore.createIndex('elementType', 'type', { unique: false });

// blockDefinitions store
blockDefStore.createIndex('userId', 'userId', { unique: false });
blockDefStore.createIndex('projectId', 'projectId', { unique: false });
blockDefStore.createIndex('name', 'name', { unique: false });
blockDefStore.createIndex('isPublic', 'isPublic', { unique: false });

// blockReferences store
blockRefStore.createIndex('projectId', 'projectId', { unique: false });
blockRefStore.createIndex('blockDefinitionId', 'blockDefinitionId', { unique: false });

// syncQueue store
syncStore.createIndex('status', 'status', { unique: false });
syncStore.createIndex('timestamp', 'timestamp', { unique: false });
syncStore.createIndex('entityType', 'entityType', { unique: false });
```

### 同步队列数据结构

```typescript
interface SyncQueueItem {
    id: string;
    operation: 'CREATE' | 'UPDATE' | 'DELETE';
    entityType: 'PROJECT' | 'ELEMENT' | 'BLOCK_DEFINITION' | 'BLOCK_REFERENCE' | 'LAYER';
    entityId: string;
    data: any;
    timestamp: string;
    status: 'PENDING' | 'SYNCED' | 'FAILED';
    retryCount?: number;
    error?: string;
}
```

---

## CAD函数库

### 库结构

```
lib/
├── geometry.ts          # 几何运算（800+ 行）
├── block.ts             # 块操作（660+ 行）
├── transform.ts         # 变换操作（740+ 行）
├── snap.ts              # 捕捉功能
├── edit.ts              # 编辑操作（修剪、打断、倒角等）
├── measure.ts           # 测量工具
├── dimension.ts         # 标注系统
├── layer.ts             # 图层管理
├── selection.ts         # 选择集操作
└── index.ts             # 统一导出
```

### geometry.ts - 几何运算库

**核心功能**:
```typescript
// 点运算
- distance(p1, p2): 距离计算
- midpoint(p1, p2): 中点
- pointsEqual(p1, p2): 点相等判断
- lerp(p1, p2, t): 线性插值

// 向量运算
- add(v1, v2): 向量加法
- subtract(v1, v2): 向量减法
- dot(v1, v2): 点积
- cross(v1, v2): 叉积
- normalize(v): 归一化
- rotate(v, angle): 旋转向量

// 角度工具
- degToRad(degrees): 角度转弧度
- radToDeg(radians): 弧度转角度
- normalizeAngle(angle): 角度归一化

// 线段操作
- lineLength(line): 线段长度
- closestPointOnLineSegment(point, line): 最近点
- lineLineIntersection(line1, line2): 线线相交
- lineSegmentIntersection(line1, line2): 线段相交

// 圆操作
- isPointOnCircle(point, circle): 点在圆上判断
- pointOnCircle(circle, angle): 圆上的点
- lineCircleIntersection(line, circle): 线圆相交
- circleCircleIntersection(c1, c2): 圆圆相交

// 包围盒
- boundingBoxFromPoints(points): 创建包围盒
- getElementBoundingBox(element): 元素包围盒
- boundingBoxesIntersect(bbox1, bbox2): 包围盒相交

// 变换矩阵
- identityMatrix(): 单位矩阵
- translationMatrix(tx, ty): 平移矩阵
- rotationMatrix(angle): 旋转矩阵
- scaleMatrix(sx, sy): 缩放矩阵
- transformPoint(point, matrix): 应用变换

// 多边形
- polygonArea(points): 多边形面积
- polygonCentroid(points): 多边形质心
- isPointInPolygon(point, polygon): 点在多边形内
```

---

### block.ts - 块操作库

**核心功能**:
```typescript
// 块定义
- createBlockDefinition(name, elements, basePoint): 创建块定义
- updateBlockDefinition(blockDef, updates): 更新块定义
- addElementsToBlock(blockDef, elements): 添加元素到块
- removeElementsFromBlock(blockDef, elementIds): 移除元素
- generateBlockThumbnail(blockDef): 生成缩略图
- getBlockBoundingBox(blockDef): 获取块包围盒

// 块引用
- createBlockReference(blockDefId, insertion, layer, rotation, scale): 创建块引用
- updateBlockReference(blockRef, updates): 更新块引用
- moveBlockReference(blockRef, delta): 移动块引用
- rotateBlockReference(blockRef, angle, center): 旋转块引用
- scaleBlockReference(blockRef, scaleX, scaleY, center): 缩放块引用
- mirrorBlockReference(blockRef, mirrorLine): 镜像块引用

// 块变换
- getBlockTransform(blockRef): 获取变换矩阵
- transformPointByBlock(point, blockRef): 变换点
- explodeBlockReference(blockRef, blockDef): 炸开块
- getBlockReferenceElements(blockRef, blockDef): 获取块元素

// 块库管理
- searchBlocks(blocks, query): 搜索块
- getPublicBlocks(blocks): 获取公共块
- getUserBlocks(blocks, userId): 获取用户块
- getProjectBlocks(blocks, projectId): 获取项目块
- sortBlocksByName(blocks): 按名称排序
- sortBlocksByDate(blocks): 按日期排序

// 块验证
- validateBlockDefinition(blockDef): 验证块定义
- isBlockNameUnique(name, blocks): 检查名称唯一性
- hasNestedBlocks(blockDef): 检查嵌套块
- hasCircularReference(blockDef, allBlocks): 检查循环引用

// 工具
- cloneBlockDefinition(blockDef, newName): 克隆块
- transformElement(element, matrix): 变换元素
```

---

### transform.ts - 变换操作库

**核心功能**:
```typescript
// 移动操作
- moveElement(element, delta): 移动元素
- moveElements(elements, delta): 批量移动
- moveElementFromTo(element, from, to): 从点到点移动

// 复制操作
- copyElement(element, delta): 复制元素
- copyElements(elements, delta): 批量复制
- linearArray(elements, count, delta): 线性阵列
- rectangularArray(elements, rows, cols, spacing): 矩形阵列
- polarArray(elements, center, count, angle, rotate): 环形阵列

// 旋转操作
- rotateElement(element, center, angle): 旋转元素
- rotateElements(elements, center, angle): 批量旋转

// 缩放操作
- scaleElement(element, basePoint, scaleX, scaleY): 缩放元素
- scaleElements(elements, basePoint, scaleX, scaleY): 批量缩放
- uniformScale(elements, basePoint, scaleFactor): 均匀缩放

// 镜像操作
- mirrorElement(element, mirrorLine): 镜像元素
- mirrorElements(elements, mirrorLine): 批量镜像
- mirrorHorizontal(elements, centerX): 水平镜像
- mirrorVertical(elements, centerY): 垂直镜像

// 对齐操作
- alignLeft(elements): 左对齐
- alignRight(elements): 右对齐
- alignTop(elements): 顶对齐
- alignBottom(elements): 底对齐
- alignCenterVertical(elements): 垂直居中对齐
- alignCenterHorizontal(elements): 水平居中对齐
- distributeHorizontally(elements): 水平分布
- distributeVertically(elements): 垂直分布

// 拉伸操作
- stretchElement(element, stretchBox, delta): 拉伸元素

// 工具函数
- getElementsCentroid(elements): 获取质心
- getCombinedBoundingBox(elements): 获取组合包围盒
```

---

## Blocks块功能

### 功能说明

Blocks（块）是CAD软件的核心功能之一，允许用户将多个图形元素组合成一个可重用的单元。

### 使用场景

1. **标准件库**: 螺栓、螺母、轴承等标准零件
2. **符号库**: 电气符号、管道符号、建筑符号
3. **模板**: 图框、标题栏、技术要求
4. **重复元素**: 窗户、门、家具等
5. **复杂图形**: 将复杂图形封装为单个单元便于管理

### 工作流程

```
1. 创建块定义
   ├── 选择多个图形元素
   ├── 指定基准点（插入点）
   ├── 命名块
   └── 保存块定义

2. 插入块引用
   ├── 选择块定义
   ├── 指定插入点
   ├── 设置旋转角度
   ├── 设置缩放比例
   └── 选择图层

3. 编辑块引用
   ├── 移动块实例
   ├── 旋转块实例
   ├── 缩放块实例
   ├── 镜像块实例
   └── 修改块属性

4. 更新块定义
   ├── 编辑块定义中的元素
   └── 自动更新所有引用该块的实例

5. 炸开块
   └── 将块引用转换回单独的图形元素
```

### 块的类型

1. **全局块**: 可在所有项目中使用
2. **项目块**: 仅在特定项目中使用
3. **公共块**: 共享给所有用户
4. **私有块**: 仅创建者可见

### 块的变换

每个块引用支持以下变换：
- **插入点**: (x, y) 坐标
- **旋转**: 0-360度
- **X缩放**: 水平缩放因子
- **Y缩放**: 垂直缩放因子
- **镜像**: 通过负缩放实现

### 嵌套块

块可以包含其他块（嵌套），但系统会检测并防止循环引用：
```
Block A
  ├── Element 1
  ├── Element 2
  └── Block B (嵌套块)
        ├── Element 3
        └── Element 4
```

---

## API接口设计

### 认证接口

```
POST   /api/auth/register          # 注册用户
POST   /api/auth/login             # 登录
POST   /api/auth/logout            # 登出
GET    /api/auth/me                # 获取当前用户信息
```

### 项目接口

```
GET    /api/projects               # 获取项目列表
POST   /api/projects               # 创建项目
GET    /api/projects/:id           # 获取项目详情
PUT    /api/projects/:id           # 更新项目
DELETE /api/projects/:id           # 删除项目
POST   /api/projects/:id/duplicate # 复制项目
```

### 块定义接口

```
GET    /api/blocks                 # 获取块定义列表
       ?public=true                 # 筛选公共块
       ?userId=xxx                  # 筛选用户块
       ?projectId=xxx               # 筛选项目块
       ?search=xxx                  # 搜索块

POST   /api/blocks                 # 创建块定义
       Body: {
         name: string,
         description?: string,
         elements: CADElement[],
         basePoint: Point,
         isPublic?: boolean,
         projectId?: string
       }

GET    /api/blocks/:id             # 获取块定义详情

PUT    /api/blocks/:id             # 更新块定义
       Body: {
         name?: string,
         description?: string,
         elements?: CADElement[],
         isPublic?: boolean
       }

DELETE /api/blocks/:id             # 删除块定义

POST   /api/blocks/:id/clone       # 克隆块定义
       Body: { newName: string }

GET    /api/blocks/:id/usage       # 获取块使用统计
```

### 块引用接口

```
GET    /api/projects/:projectId/block-references
       # 获取项目的所有块引用

POST   /api/projects/:projectId/block-references
       # 插入块引用
       Body: {
         blockDefinitionId: string,
         insertionPoint: Point,
         layer: string,
         rotation?: number,
         scaleX?: number,
         scaleY?: number
       }

PUT    /api/projects/:projectId/block-references/:ref