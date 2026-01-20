<div align="center">
<img width="1200" height="475" alt="AIIgniteCAD Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# AIIgniteCAD - AI-Powered CAD Editor

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Supported-2496ED)](https://www.docker.com/)

智能 CAD 编辑器，支持 AI 辅助设计、实时协作、DXF 导入导出和强大的 Blocks 块系统。

[快速开始](#-快速开始) • [功能特性](#-功能特性) • [文档](#-文档) • [贡献](#-贡献指南)

</div>

---

## 📑 目录

- [功能特性](#-功能特性)
- [快速开始](#-快速开始)
- [系统架构](#-系统架构)
- [核心功能详解](#-核心功能详解)
- [技术栈](#-技术栈)
- [文档资源](#-文档资源)
- [开发指南](#-开发指南)
- [贡献指南](#-贡献指南)
- [故障排除](#-故障排除)
- [路线图](#-路线图)
- [许可证](#-许可证)

---

## ✨ 功能特性

### 🤖 AI 辅助设计
- **自然语言交互**：通过对话创建和编辑 CAD 元素
- **智能建议**：AI 驱动的设计建议和优化
- **多模型支持**：集成 Google Gemini 2.0 Flash

### 🧱 Blocks 块系统
- **块定义管理**：将多个图形组装为可重用单元
- **块引用与变换**：支持旋转、缩放、镜像等变换操作
- **嵌套块支持**：块可以包含其他块，带循环引用检测
- **块库管理**：全局块、项目块、公共块和私有块

### 📐 CAD 核心功能
- **DXF 导入/导出**：完整的 DXF 文件格式支持
- **图层管理**：组织元素到不同图层
- **几何运算库**：50+ 个核心几何函数
- **变换操作**：移动、旋转、缩放、镜像、阵列

### 👥 实时协作
- **WebSocket 通信**：基于 Socket.IO 的实时更新
- **多用户编辑**：支持多人同时编辑同一项目
- **版本历史**：跟踪和回滚变更

### 💾 数据存储
- **PostgreSQL 后端**：企业级数据库支持
- **IndexedDB 本地存储**：离线优先架构
- **智能同步**：在线/离线自动数据同步

---

## 🚀 快速开始

### 前置要求

- **Node.js** 20+
- **Docker** 和 **Docker Compose**
- **PostgreSQL**（或使用 Docker）

### 方式一：Docker 一键启动（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/aiignite/AIIgniteCAD.git
cd AIIgniteCAD

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，设置必要的环境变量

# 3. 启动所有服务
docker-compose up -d

# 4. 访问应用
# 前端: http://localhost:3400
# 后端: http://localhost:3410
```

### 方式二：本地开发

```bash
# 1. 安装依赖
# 前端
npm install

# 后端
cd backend
npm install

# 2. 配置数据库
npx prisma migrate dev
npx prisma generate

# 3. 启动服务
# 终端 1 - 后端
cd backend
npm run dev

# 终端 2 - 前端
cd ..
npm run dev
```

### 环境变量配置

在 `.env` 文件中配置以下变量：

```bash
# 必需
GEMINI_API_KEY=your_gemini_api_key
JWT_SECRET=your_jwt_secret
DATABASE_URL=postgresql://user:password@localhost:5435/aiignitecad

# 可选
PORT=3410
NODE_ENV=development
```

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         客户端层 (Frontend)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  React UI   │  │ CAD Canvas  │  │ AI Chat     │              │
│  │  Components │  │ Renderer    │  │ Interface   │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│  ┌──────▼────────────────▼────────────────▼──────┐              │
│  │         Services Layer (TypeScript)           │              │
│  │  dxfService │ blockService │ indexedDBService  │              │
│  └──────────────────────────────────────────────┘              │
└────────────────────────┬────────────────────────────────────────┘
                         │ WebSocket │ REST API
                         ▼           ▼
┌─────────────────────────────────────────────────────────────────┐
│                         服务层 (Backend)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Express    │  │  Socket.IO  │  │  Prisma     │              │
│  │  API Routes │  │  WebSocket  │  │  ORM        │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│  ┌──────▼────────────────▼────────────────▼──────┐              │
│  │         Business Logic & Middleware            │              │
│  │  Auth │ Validation │ Sync │ AI Integration     │              │
│  └──────────────────────────────────────────────┘              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                         数据层 (Data)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ PostgreSQL  │  │ IndexedDB   │  │  Gemini     │              │
│  │  Database   │  │  (Browser)  │  │  AI API     │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 核心功能详解

### Blocks 块系统

Blocks 是 CAD 软件的核心功能，类似于编程中的函数/模块：

```typescript
// 创建块定义
const windowBlock = createBlockDefinition(
  '标准窗户-1200x1500',
  [frameElements, glassElements],
  { x: 0, y: 0 }
);

// 在墙上插入多个窗户
insertBlockReference(projectId, windowBlock.id, { x: 1000, y: 500 });
insertBlockReference(projectId, windowBlock.id, { x: 3000, y: 500 });
```

**块类型**：
- **全局块**：所有项目可用的标准件
- **项目块**：项目特定的设计元素
- **公共块**：所有用户共享的符号库
- **私有块**：个人块库

### AI 辅助设计流程

```
用户输入自然语言
       │
       ▼
AI 理解意图 (Gemini 2.0)
       │
       ▼
生成 CAD 操作指令
       │
       ▼
执行几何运算/块操作
       │
       ▼
更新画布显示
```

### 离线优先架构

- **在线**：数据实时同步到 PostgreSQL
- **离线**：数据保存到 IndexedDB
- **恢复上线**：自动从同步队列处理待同步项

---

## 🛠️ 技术栈

### 前端
| 技术 | 版本 | 用途 |
|------|------|------|
| React | 19.2 | UI 框架 |
| TypeScript | 5.8 | 类型安全 |
| Vite | 6.2 | 构建工具 |
| Tailwind CSS | 3.4 | 样式框架 |

### 后端
| 技术 | 版本 | 用途 |
|------|------|------|
| Express | Latest | Web 框架 |
| Prisma | Latest | ORM |
| PostgreSQL | Latest | 数据库 |
| Socket.IO | Latest | 实时通信 |

### AI 集成
| 技术 | 用途 |
|------|------|
| Google Gemini 2.0 Flash | AI 对话和设计辅助 |

### 基础设施
| 技术 | 用途 |
|------|------|
| Docker | 容器化 |
| Docker Compose | 服务编排 |
| Nginx | 反向代理 |

---

## 📚 文档资源

### 核心文档

| 文档 | 描述 |
|------|------|
| [QUICKSTART.md](QUICKSTART.md) | 5 分钟快速启动指南 |
| [DATABASE_DESIGN.md](DATABASE_DESIGN.md) | 完整数据库设计 |
| [IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md) | 详细实施步骤 |
| [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) | 项目功能总结 |

### 专题文档

| 文档 | 描述 |
|------|------|
| [BLOCKS_IMPLEMENTATION_PLAN.md](BLOCKS_IMPLEMENTATION_PLAN.md) | Blocks 功能实施计划 |
| [CHAT_IMPROVEMENTS.md](CHAT_IMPROVEMENTS.md) | AI 聊天功能改进 |
| [DEPLOYMENT.md](DEPLOYMENT.md) | 部署指南 |
| [DEMO_SCRIPT.md](DEMO_SCRIPT.md) | 演示脚本 |

### 文件结构

```
AIIgniteCAD/
├── components/          # React 组件
├── services/           # 业务逻辑服务
├── lib/                # CAD 函数库
│   ├── geometry.ts     # 几何运算 (797 行)
│   ├── block.ts        # 块操作 (660 行)
│   └── transform.ts    # 变换操作 (742 行)
├── backend/            # Express 后端
│   ├── prisma/        # 数据库 Schema
│   └── src/
│       ├── routes/    # API 端点
│       └── middleware/# 认证中间件
├── docs/
│   └── images/        # 文档图片
└── public/            # 静态资源
```

---

## 💻 开发指南

### 开发命令

```bash
# 前端开发
npm run dev          # 启动开发服务器
npm run build        # 构建生产版本

# 后端开发
cd backend
npm run dev          # 启动后端服务
npx prisma studio    # 打开数据库管理界面

# 数据库迁移
npx prisma migrate dev   # 运行迁移
npx prisma generate      # 生成 Prisma Client
```

### CAD 函数库使用

```typescript
import { distance, midpoint } from './lib/geometry';
import { createBlockDefinition } from './lib/block';
import { moveElement, rotateElement } from './lib/transform';

// 几何运算
const d = distance(p1, p2);
const mid = midpoint(p1, p2);

// 块操作
const block = createBlockDefinition('myBlock', elements, basePoint);

// 变换操作
const moved = moveElement(element, { x: 10, y: 10 });
const rotated = rotateElement(element, center, Math.PI / 4);
```

---

## 🤝 贡献指南

### 代码规范

- 使用 TypeScript 严格模式
- 遵循现有代码风格（见 [AGENTS.md](AGENTS.md)）
- 添加 JSDoc 注释
- 编写单元测试

### 提交规范

```
feat: 添加新功能
fix: 修复 bug
docs: 更新文档
refactor: 重构代码
test: 添加测试
chore: 构建/工具链更新
```

### Pull Request 流程

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 🔍 故障排除

### 常见问题

**Q: 数据库连接失败**
```
A: 检查 PostgreSQL 是否运行，验证 DATABASE_URL 配置
   docker ps | grep postgres
```

**Q: AI 对话无响应**
```
A: 验证 GEMINI_API_KEY 是否正确设置
   echo $GEMINI_API_KEY
```

**Q: 前端构建失败**
```
A: 清除缓存并重新安装依赖
   rm -rf node_modules package-lock.json
   npm install
```

**Q: Docker 容器无法启动**
```
A: 检查端口占用，停止冲突服务
   docker-compose down
   lsof -i :3400 -i :3410 -i :5435
```

更多问题请查看 [QUICKSTART.md](QUICKSTART.md) 的故障排除部分。

---

## 🗺️ 路线图

### ✅ 已完成
- [x] 基础 CAD 编辑器
- [x] DXF 导入/导出
- [x] AI 助手集成
- [x] Blocks 块系统
- [x] PostgreSQL 后端
- [x] IndexedDB 本地存储
- [x] WebSocket 实时通信

### 🔄 进行中
- [ ] 完整的 API 端点
- [ ] 前端 Blocks UI 组件
- [ ] 数据同步服务

### 📋 计划中

#### 短期 (1-2 个月)
- [ ] 单元测试覆盖
- [ ] 性能优化
- [ ] 用户认证系统

#### 中期 (3-6 个月)
- [ ] 实时协作编辑
- [ ] 高级标注系统
- [ ] 图纸模板

#### 长期 (6-12 个月)
- [ ] 3D CAD 支持
- [ ] 参数化设计
- [ ] 移动应用

---

## 📄 许可证

本项目基于 MIT 许可证开源 - 详见 [LICENSE](LICENSE) 文件。

---

## 🌟 Star 历史

<a href="https://star-history.com/#aiignite/AIIgniteCAD&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=aiignite/AIIgniteCAD&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=aiignite/AIIgniteCAD&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=aiignite/AIIgniteCAD&type=Date" />
  </picture>
</a>

---

<div align="center">

**Happy CAD-ing!** 🚀🎨

[返回顶部](#aiignitecad---ai-powered-cad-editor)

</div>
