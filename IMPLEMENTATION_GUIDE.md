# AIIgniteCAD 实施指南

## 📖 概述

本文档提供了为AIIgniteCAD项目添加PostgreSQL数据库支持、IndexedDB本地存储、CAD函数库和Blocks块功能的完整实施步骤。

---

## 🎯 实施目标

- ✅ 添加PostgreSQL后端数据库支持
- ✅ 实现IndexedDB本地离线存储
- ✅ 创建CAD复杂操作函数库
- ✅ 实现Blocks块功能（将多个图形组装为可重用的块）
- ✅ 实现在线/离线数据同步机制
- ✅ 提供RESTful API和WebSocket实时通信

---

## 📁 项目结构

```
AIIgniteCAD/
├── backend/                          # 后端服务器
│   ├── prisma/
│   │   └── schema.prisma             # 数据库模型定义
│   ├── src/
│   │   ├── index.ts                  # 服务器入口
│   │   ├── routes/                   # API路由
│   │   ├── controllers/              # 控制器
│   │   ├── services/                 # 业务逻辑
│   │   └── middleware/               # 中间件
│   ├── package.json
│   └── tsconfig.json
│
├── lib/                              # CAD函数库
│   ├── geometry.ts                   # 几何运算（800行）
│   ├── block.ts                      # 块操作（660行）
│   ├── transform.ts                  # 变换操作（740行）
│   ├── snap.ts                       # 捕捉功能
│   ├── edit.ts                       # 编辑操作
│   ├── measure.ts                    # 测量工具
│   ├── dimension.ts                  # 标注系统
│   ├── layer.ts                      # 图层管理
│   ├── selection.ts                  # 选择集操作
│   └── index.ts                      # 统一导出
│
├── services/                         # 前端服务
│   ├── dxfService.ts                 # DXF导入导出（已有）
│   ├── geminiService.ts              # AI集成（已有）
│   ├── indexedDBService.ts           # IndexedDB服务（新增）
│   ├── apiService.ts                 # 后端API调用（新增）
│   ├── syncService.ts                # 数据同步服务（新增）
│   └── blockService.ts               # 块操作服务（新增）
│
├── types.ts                          # TypeScript类型定义（扩展）
├── DATABASE_DESIGN.md                # 数据库设计文档
└── IMPLEMENTATION_GUIDE.md           # 本文档
```

---

## 🚀 实施步骤

### 第一阶段：准备工作（1天）

#### 1.1 安装依赖

**后端依赖**：
```bash
cd backend
npm install

# 核心依赖
npm install express cors dotenv helmet morgan compression
npm install @prisma/client bcryptjs jsonwebtoken express-validator
npm install socket.io ws

# 开发依赖
npm install -D @types/express @types/node @types/cors @types/bcryptjs
npm install -D @types/jsonwebtoken @types/morgan @types/compression
npm install -D prisma typescript ts-node ts-node-dev
npm install -D @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint
```

**前端依赖**（如需新增）：
```bash
cd ..
npm install
# IndexedDB已内置于浏览器，无需安装额外依赖
```

#### 1.2 环境配置

创建 `backend/.env` 文件：
```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/aiignitecad?schema=public"

# Server
PORT=3410
NODE_ENV=development

# Frontend URL
FRONTEND_URL=http://localhost:3400

# JWT Secret
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d

# Encryption Key (for API keys)
ENCRYPTION_KEY=your-encryption-key-32-characters
```

创建 `backend/tsconfig.json`：
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### 1.3 数据库设置

安装PostgreSQL（如未安装）：
```bash
# macOS
brew install postgresql@14
brew services start postgresql@14

# Ubuntu/Debian
sudo apt-get update
sudo apt-get install postgresql-14

# Windows
# 下载安装程序：https://www.postgresql.org/download/windows/
```

创建数据库：
```bash
# 登录PostgreSQL
psql postgres

# 创建数据库
CREATE DATABASE aiignitecad;

# 创建用户（可选）
CREATE USER caduser WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE aiignitecad TO caduser;

# 退出
\q
```

---

### 第二阶段：数据库初始化（0.5天）

#### 2.1 初始化Prisma

```bash
cd backend
npx prisma init
```

#### 2.2 运行数据库迁移

schema.prisma已经创建，运行迁移：
```bash
npx prisma migrate dev --name init
```

这将创建所有表：
- users
- projects
- drawing_settings
- layers
- block_definitions ⭐
- block_elements ⭐
- block_references ⭐
- elements
- project_versions
- chat_sessions
- chat_messages
- llm_models

#### 2.3 生成Prisma Client

```bash
npx prisma generate
```

#### 2.4 查看数据库（可选）

```bash
npx prisma studio
```

这将在浏览器中打开数据库管理界面。

---

### 第三阶段：后端API实现（3-4天）

#### 3.1 创建认证中间件

创建 `backend/src/middleware/auth.ts`：
```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';

export interface AuthRequest extends Request {
    userId?: string;
}

export async function authenticate(
    req: AuthRequest,
    res: Response,
    next: NextFunction
) {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
        req.userId = decoded.userId;

        // Verify user exists
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId }
        });

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
}
```

#### 3.2 创建认证路由

创建 `backend/src/routes/auth.routes.ts`：
```typescript
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';
import { body, validationResult } from 'express-validator';

const router = Router();

// Register
router.post('/register',
    body('username').isLength({ min: 3 }),
    body('email').isEmail(),
    body('password').isLength({ min: 6 }),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const { username, email, password } = req.body;

            // Check if user exists
            const existing = await prisma.user.findFirst({
                where: { OR: [{ username }, { email }] }
            });

            if (existing) {
                return res.status(400).json({ error: 'User already exists' });
            }

            // Hash password
            const passwordHash = await bcrypt.hash(password, 10);

            // Create user
            const user = await prisma.user.create({
                data: { username, email, passwordHash }
            });

            // Generate token
            const token = jwt.sign(
                { userId: user.id },
                process.env.JWT_SECRET!,
                { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
            );

            res.json({ user: { id: user.id, username, email }, token });
        } catch (error) {
            res.status(500).json({ error: 'Registration failed' });
        }
    }
);

// Login
router.post('/login',
    body('email').isEmail(),
    body('password').notEmpty(),
    async (req, res) => {
        try {
            const { email, password } = req.body;

            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const valid = await bcrypt.compare(password, user.passwordHash);
            if (!valid) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const token = jwt.sign(
                { userId: user.id },
                process.env.JWT_SECRET!,
                { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
            );

            res.json({
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email
                },
                token
            });
        } catch (error) {
            res.status(500).json({ error: 'Login failed' });
        }
    }
);

export default router;
```

#### 3.3 创建块定义路由

创建 `backend/src/routes/blocks.routes.ts`：
```typescript
import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../index';
import { body, validationResult } from 'express-validator';

const router = Router();

// Get all blocks
router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
        const { public: isPublic, userId, projectId, search } = req.query;

        const where: any = {};

        if (isPublic === 'true') {
            where.isPublic = true;
        }

        if (userId) {
            where.userId = userId;
        }

        if (projectId) {
            where.projectId = projectId;
        }

        if (search) {
            where.OR = [
                { name: { contains: search as string, mode: 'insensitive' } },
                { description: { contains: search as string, mode: 'insensitive' } }
            ];
        }

        const blocks = await prisma.blockDefinition.findMany({
            where,
            include: {
                blockElements: true,
                _count: {
                    select: { blockReferences: true }
                }
            },
            orderBy: { updatedAt: 'desc' }
        });

        res.json(blocks);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch blocks' });
    }
});

// Create block
router.post('/',
    authenticate,
    body('name').notEmpty(),
    body('basePointX').isNumeric(),
    body('basePointY').isNumeric(),
    async (req: AuthRequest, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const { name, description, basePointX, basePointY, elements, thumbnail, isPublic, projectId } = req.body;

            const block = await prisma.blockDefinition.create({
                data: {
                    name,
                    description,
                    basePointX,
                    basePointY,
                    thumbnail,
                    isPublic: isPublic || false,
                    userId: req.userId!,
                    projectId,
                    blockElements: {
                        create: elements.map((el: any, index: number) => ({
                            elementData: el,
                            displayOrder: index
                        }))
                    }
                },
                include: {
                    blockElements: true
                }
            });

            res.status(201).json(block);
        } catch (error) {
            res.status(500).json({ error: 'Failed to create block' });
        }
    }
);

// Get block by ID
router.get('/:id', authenticate, async (req, res) => {
    try {
        const block = await prisma.blockDefinition.findUnique({
            where: { id: req.params.id },
            include: {
                blockElements: {
                    orderBy: { displayOrder: 'asc' }
                }
            }
        });

        if (!block) {
            return res.status(404).json({ error: 'Block not found' });
        }

        res.json(block);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch block' });
    }
});

// Update block
router.put('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
        const { name, description, elements, thumbnail, isPublic } = req.body;

        // Check ownership
        const existing = await prisma.blockDefinition.findUnique({
            where: { id: req.params.id }
        });

        if (!existing) {
            return res.status(404).json({ error: 'Block not found' });
        }

        if (existing.userId !== req.userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Update block
        const updateData: any = { name, description, thumbnail, isPublic };

        const block = await prisma.blockDefinition.update({
            where: { id: req.params.id },
            data: updateData,
            include: {
                blockElements: true
            }
        });

        // Update elements if provided
        if (elements) {
            await prisma.blockElement.deleteMany({
                where: { blockDefinitionId: req.params.id }
            });

            await prisma.blockElement.createMany({
                data: elements.map((el: any, index: number) => ({
                    blockDefinitionId: req.params.id,
                    elementData: el,
                    displayOrder: index
                }))
            });
        }

        res.json(block);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update block' });
    }
});

// Delete block
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
        const block = await prisma.blockDefinition.findUnique({
            where: { id: req.params.id },
            include: {
                _count: {
                    select: { blockReferences: true }
                }
            }
        });

        if (!block) {
            return res.status(404).json({ error: 'Block not found' });
        }

        if (block.userId !== req.userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        if (block._count.blockReferences > 0) {
            return res.status(400).json({
                error: 'Cannot delete block that is in use'
            });
        }

        await prisma.blockDefinition.delete({
            where: { id: req.params.id }
        });

        res.json({ message: 'Block deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete block' });
    }
});

export default router;
```

#### 3.4 更新主入口文件

在 `backend/src/index.ts` 中添加路由：
```typescript
import authRoutes from './routes/auth.routes';
import blockRoutes from './routes/blocks.routes';

// ... 在路由部分添加
app.use('/api/auth', authRoutes);
app.use('/api/blocks', blockRoutes);
```

---

### 第四阶段：前端集成（2-3天）

#### 4.1 初始化IndexedDB

前端应用启动时初始化：
```typescript
// 在 App.tsx 或 index.tsx 中
import { indexedDBService } from './services/indexedDBService';

useEffect(() => {
    async function initDB() {
        try {
            await indexedDBService.init();
            console.log('IndexedDB initialized');
        } catch (error) {
            console.error('Failed to initialize IndexedDB:', error);
        }
    }
    initDB();
}, []);
```

#### 4.2 创建API服务

创建 `services/apiService.ts`：
```typescript
import { BlockDefinition, BlockReference, ProjectFile } from '../types';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3410/api';

class APIService {
    private token: string | null = null;

    setToken(token: string) {
        this.token = token;
        localStorage.setItem('auth_token', token);
    }

    getToken(): string | null {
        if (!this.token) {
            this.token = localStorage.getItem('auth_token');
        }
        return this.token;
    }

    clearToken() {
        this.token = null;
        localStorage.removeItem('auth_token');
    }

    private async request(endpoint: string, options: RequestInit = {}) {
        const token = this.getToken();
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
            ...options.headers
        };

        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Request failed');
        }

        return response.json();
    }

    // Authentication
    async register(username: string, email: string, password: string) {
        return this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, email, password })
        });
    }

    async login(email: string, password: string) {
        const result = await this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        this.setToken(result.token);
        return result;
    }

    // Blocks
    async getBlocks(params?: {
        public?: boolean;
        userId?: string;
        projectId?: string;
        search?: string;
    }): Promise<BlockDefinition[]> {
        const query = new URLSearchParams(params as any).toString();
        return this.request(`/blocks?${query}`);
    }

    async createBlock(blockData: Partial<BlockDefinition>): Promise<BlockDefinition> {
        return this.request('/blocks', {
            method: 'POST',
            body: JSON.stringify(blockData)
        });
    }

    async getBlock(blockId: string): Promise<BlockDefinition> {
        return this.request(`/blocks/${blockId}`);
    }

    async updateBlock(blockId: string, updates: Partial<BlockDefinition>): Promise<BlockDefinition> {
        return this.request(`/blocks/${blockId}`, {
            method: 'PUT',
            body: JSON.stringify(updates)
        });
    }

    async deleteBlock(blockId: string): Promise<void> {
        return this.request(`/blocks/${blockId}`, {
            method: 'DELETE'
        });
    }

    // Projects
    async getProjects(): Promise<ProjectFile[]> {
        return this.request('/projects');
    }

    async createProject(projectData: Partial<ProjectFile>): Promise<ProjectFile> {
        return this.request('/projects', {
            method: 'POST',
            body: JSON.stringify(projectData)
        });
    }

    async updateProject(projectId: string, updates: Partial<ProjectFile>): Promise<ProjectFile> {
        return this.request(`/projects/${projectId}`, {
            method: 'PUT',
            body: JSON.stringify(updates)
        });
    }
}

export const apiService = new APIService();
export default apiService;
```

#### 4.3 创建同步服务

创建 `services/syncService.ts`：
```typescript
import { indexedDBService } from './indexedDBService';
import { apiService } from './apiService';
import { SyncQueueItem } from '../types';

class SyncService {
    private syncInterval: NodeJS.Timeout | null = null;
    private isSyncing = false;

    // Start auto-sync
    startAutoSync(intervalMs: number = 30000) {
        this.syncInterval = setInterval(() => {
            this.syncPendingChanges();
        }, intervalMs);
    }

    // Stop auto-sync
    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    // Sync pending changes to backend
    async syncPendingChanges(): Promise<void> {
        if (this.isSyncing) return;

        try {
            this.isSyncing = true;

            const pendingItems = await indexedDBService.getPendingSyncItems();

            for (const item of pendingItems) {
                try {
                    await this.syncItem(item);
                    await indexedDBService.markSyncItemComplete(item.id);
                } catch (error) {
                    console.error('Sync failed for item:', item, error);
                    await indexedDBService.markSyncItemFailed(
                        item.id,
                        error instanceof Error ? error.message : 'Unknown error'
                    );
                }
            }

            // Clean up synced items
            await indexedDBService.clearSyncedItems();
        } catch (error) {
            console.error('Sync process failed:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    // Sync individual item
    private async syncItem(item: SyncQueueItem): Promise<void> {
        switch (item.entityType) {
            case 'PROJECT':
                if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
                    await apiService.updateProject(item.entityId, item.data);
                } else if (item.operation === 'DELETE') {
                    // Handle delete
                }
                break;

            case 'BLOCK_DEFINITION':
                if (item.operation === 'CREATE') {
                    await apiService.createBlock(item.data);
                } else if (item.operation === 'UPDATE') {
                    await apiService.updateBlock(item.entityId, item.data);
                } else if (item.operation === 'DELETE') {
                    await apiService.deleteBlock(item.entityId);
                }
                break;

            // Add other entity types...
        }
    }

    // Pull data from backend to IndexedDB
    async pullFromBackend(): Promise<void> {
        try {
            // Pull blocks
            const blocks = await apiService.getBlocks();
            for (const block of blocks) {
                await indexedDBService.saveBlockDefinition(block);
            }

            // Pull projects
            const projects = await apiService.getProjects();
            for (const project of projects) {
                await indexedDBService.saveProject(project);
            }

            console.log('Data pulled from backend successfully');
        } catch (error) {
            console.error('Failed to pull data from backend:', error);
        }
    }

    // Check online status
    isOnline(): boolean {
        return navigator.onLine;
    }
}

export const syncService = new SyncService();
export default syncService;
```

---

### 第五阶段：UI集成Blocks功能（2-3天）

#### 5.1 创建Blocks面板组件

创建 `components/BlocksPanel.tsx`：
```typescript
import React, { useState, useEffect } from 'react';
import { BlockDefinition } from '../types';
import { blockService } from '../services/blockService';

interface BlocksPanelProps {
    onInsertBlock: (blockId: string) => void;
}

const BlocksPanel: React.FC<BlocksPanelProps> = ({ onInsertBlock }) => {
    const [blocks, setBlocks] = useState<BlockDefinition[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<'all' | 'public' | 'private'>('all');

    useEffect(() => {
        loadBlocks();
    }, [filter]);

    const loadBlocks = async () => {
        try {
            let allBlocks = await blockService.getAllBlocks();

            if (filter === 'public') {
                allBlocks = await blockService.getPublicBlocks();
            } else if (filter === 'private') {
                // Filter private blocks
            }

            setBlocks(allBlocks);
        } catch (error) {
            console.error('Failed to load blocks:', error);
        }
    };

    const filteredBlocks = blocks.filter(block =>
        block.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="blocks-panel">
            <div className="p-4">
                <h3 className="text-lg font-bold mb-4">块库 (Blocks)</h3>

                {/* Search */}
                <input
                    type="text"
                    placeholder="搜索块..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-3 py-2 border rounded mb-4"
                />

                {/* Filter */}
                <div className="flex gap-2 mb-4">
                    <button
                        onClick={() => setFilter('all')}
                        className={`px-3 py-1 rounded ${filter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                    >
                        全部
                    </button>
                    <button
                        onClick={() => setFilter('public')}
                        className={`px-3 py-1 rounded ${filter === 'public' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                    >
                        公共库
                    </button>
                    <button
                        onClick={() => setFilter('private')}
                        className={`px-3 py-1 rounded ${filter === 'private' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                    >
                        我的块
                    </button>
                </div>

                {/* Blocks List */}
                <div className="space-y-2">
                    {filteredBlocks.map(block => (
                        <div
                            key={block.id}
                            className="border rounded p-3 cursor-pointer hover:bg-gray-50"
                            onClick={() => onInsertBlock(block.id)}
                        >
                            {block.thumbnail && (
                                <img
                                    src={`data:image/svg+xml;base64,${btoa(block.thumbnail)}`}
                                    alt={block.name}
                                    className="w-full h-24 object-contain mb-2"
                                />
                            )}
                            <div className="font-medium">{block.name}</div>
                            {block.description && (
                                <div className="text-sm text-gray-600">{block.description}</div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default BlocksPanel;
```

#### 5.2 在App.tsx中集成Blocks功能

```typescript
// 添加状态
const [blockDefinitions, setBlockDefinitions] = useState<BlockDefinition[]>([]);
const [blockReferences, setBlockReferences] = useState<BlockReference[]>([]);
const [showBlocksPanel, setShowBlocksPanel] = useState(false);

// 加载块定义
useEffect(() => {
    async function loadBlocks() {
        const blocks = await blockService.getAllBlocks();
        setBlockDefinitions(blocks);
    }
    loadBlocks();
}, []);

// 处理插入块
const handleInsertBlock = async (blockId: string) => {
    const blockRef = await blockService.insertBlockReference(
        currentProjectId,
        blockId,
        { x: 400, y: 300 }, // 默认插入点
        '0'
    );
    setBlockReferences([...blockReferences, blockRef]);
};

// 处理创建块
const handleCreateBlock = async (selectedElements: CADElement[]) => {
    const basePoint = { x: 0, y: 0 }; // 计算基准点
    const name = prompt('输入块名称:');
    if (!name) return;

    const block = await blockService.createBlock(
        name,
        selectedElements,
        basePoint
    );
    setBlockDefinitions([...blockDefinitions, block]);
};
```

---

### 第六阶段：测试与优化（2天）

#### 6.1 单元测试

创建测试文件 `lib/__tests__/geometry.test.ts`：
```typescript
import { distance, midpoint, lineLineIntersection } from '../geometry';

describe('geometry', () => {
    test('distance calculation', () => {
        const p1 = { x: 0, y: 0 };
        const p2 = { x: 3, y: 4 };
        expect(distance(p1, p2)).toBe(5);
    });

    test('midpoint calculation', () => {
        const p1 = { x: 0, y: 0 };
        const p2 = { x: 10, y: 10 };
        const mid = midpoint(p1, p2);
        expect(mid.x).toBe(5);
        expect(mid.y).toBe(5);
    });

    test('