# AIIgniteCAD 快速开始指南

## 🚀 5分钟快速启动

本指南帮助您快速启动AIIgniteCAD的完整系统，包括PostgreSQL数据库、后端服务器、前端应用和Blocks功能。

---

## 📋 前置要求

- Node.js 18+ 和 npm 9+
- PostgreSQL 14+
- Git

---

## 🔧 安装步骤

### 1. 克隆或初始化项目

```bash
# 如果是现有项目
cd AIIgniteCAD

# 检查项目结构
ls -la
```

### 2. 安装后端依赖

```bash
cd backend
npm install
```

### 3. 配置环境变量

创建 `backend/.env` 文件：

```env
# 数据库连接
DATABASE_URL="postgresql://postgres:password@localhost:5432/aiignitecad?schema=public"

# 服务器配置
PORT=3410
NODE_ENV=development
FRONTEND_URL=http://localhost:3400

# JWT密钥（请更改为随机字符串）
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-12345
JWT_EXPIRES_IN=7d

# 加密密钥（32位字符串）
ENCRYPTION_KEY=your-32-character-encryption-key-change-this-12345678
```

### 4. 设置PostgreSQL数据库

```bash
# 登录PostgreSQL
psql postgres

# 在psql中执行
CREATE DATABASE aiignitecad;
\q

# 或者使用自定义用户
# CREATE USER caduser WITH PASSWORD 'your_password';
# GRANT ALL PRIVILEGES ON DATABASE aiignitecad TO caduser;
```

### 5. 初始化数据库

```bash
# 在 backend/ 目录中
npx prisma migrate dev --name init
npx prisma generate
```

这将创建所有表，包括：
- ✅ users（用户）
- ✅ projects（项目）
- ✅ block_definitions（块定义）⭐
- ✅ block_elements（块内部元素）⭐
- ✅ block_references（块引用）⭐
- ✅ elements（图形元素）
- ✅ layers（图层）
- ✅ 以及其他表...

### 6. 启动后端服务器

```bash
# 在 backend/ 目录中
npm run dev
```

看到以下输出表示成功：
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 AIIgniteCAD Backend Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Environment: development
HTTP Server: http://localhost:3001
WebSocket Server: ws://localhost:3410
Health Check: http://localhost:3410/health
API Endpoint: http://localhost:3410/api
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 7. 安装前端依赖（新终端）

```bash
# 回到项目根目录
cd ..
npm install
```

### 8. 启动前端应用

```bash
npm run dev
```

前端将在 http://localhost:3400 启动

---

## 🧪 验证安装

### 1. 检查后端健康状态

```bash
curl http://localhost:3410/health
```

应返回：
```json
{
  "status": "OK",
  "timestamp": "2024-01-XX...",
  "uptime": 123.45,
  "environment": "development"
}
```

### 2. 检查数据库

```bash
cd backend
npx prisma studio
```

这将打开数据库可视化界面，您可以查看所有表。

### 3. 测试API端点

```bash
# 查看API信息
curl http://localhost:3410/api
```

---

## 🎨 使用Blocks功能

### 创建第一个块

1. 在前端界面中绘制几个图形（线、圆、矩形等）
2. 选择这些图形
3. 点击工具栏中的"创建块"按钮（或使用快捷键）
4. 输入块名称，例如 "窗户"
5. 选择基准点（插入点）
6. 保存块定义

### 插入块引用

1. 打开块库面板
2. 在列表中找到刚创建的块
3. 点击块缩略图
4. 在画布上点击指定插入位置
5. 可选：旋转、缩放块实例

### 编辑块定义

1. 在块库面板中右键点击块
2. 选择"编辑块定义"
3. 修改块内部的图形
4. 保存后，所有引用该块的实例会自动更新

---

## 📚 核心功能测试

### 测试IndexedDB本地存储

```javascript
// 在浏览器控制台中执行
import { indexedDBService } from './services/indexedDBService';

// 初始化
await indexedDBService.init();

// 保存测试数据
await indexedDBService.saveProject({
  id: 'test-1',
  name: '测试项目',
  elements: [],
  lastModified: new Date().toISOString()
});

// 获取数据
const project = await indexedDBService.getProject('test-1');
console.log(project);
```

### 测试CAD函数库

```javascript
// 在代码中使用
import { distance, lineLineIntersection, rotateElement } from './lib/geometry';
import { createBlockDefinition, explodeBlockReference } from './lib/block';
import { moveElement, scaleElement, mirrorElement } from './lib/transform';

// 计算两点距离
const d = distance({ x: 0, y: 0 }, { x: 3, y: 4 });
console.log(d); // 5

// 创建块
const block = createBlockDefinition(
  '测试块',
  [element1, element2],
  { x: 0, y: 0 }
);
```

---

## 🔄 数据同步测试

### 测试在线同步

1. 确保后端服务器运行
2. 在前端创建或修改项目
3. 数据会自动保存到IndexedDB
4. 后台自动同步到PostgreSQL（30秒间隔）

### 测试离线模式

1. 停止后端服务器
2. 继续在前端工作（创建、编辑项目）
3. 所有操作保存到IndexedDB
4. 重启后端服务器
5. 前端会自动同步离线期间的所有更改

### 查看同步队列

```javascript
// 浏览器控制台
import { indexedDBService } from './services/indexedDBService';

// 查看待同步项
const pending = await indexedDBService.getPendingSyncItems();
console.log('待同步项数:', pending.length);
console.log(pending);
```

---

## 🎯 常见使用场景

### 场景1：创建标准零件库

```typescript
// 1. 绘制一个螺栓
const boltElements = [
  { type: 'CIRCLE', center: {x: 0, y: 0}, radius: 10 },
  { type: 'LINE', start: {x: -5, y: 0}, end: {x: 5, y: 0} }
];

// 2. 创建块
const boltBlock = await blockService.createBlock(
  'M10螺栓',
  boltElements,
  { x: 0, y: 0 },
  '标准M10螺栓',
  null, // 全局块
  userId
);

// 3. 设为公共块
await blockService.updateBlock(boltBlock.id, { isPublic: true });
```

### 场景2：批量插入块（阵列）

```typescript
import { rectangularArray } from './lib/transform';

// 插入一个块引用
const blockRef = await blockService.insertBlockReference(
  projectId,
  blockDefId,
  { x: 100, y: 100 }
);

// 使用阵列功能创建多个副本
const arrayRefs = rectangularArray(
  [blockRef],
  5,  // 5行
  10, // 10列
  50, // 行间距
  50  // 列间距
);
```

### 场景3：块的参数化（动态属性）

```typescript
// 创建带属性的块引用
const doorBlock = await blockService.insertBlockReference(
  projectId,
  doorBlockDefId,
  { x: 200, y: 200 },
  '0',
  0,
  1.5, // 缩放X（宽度）
  1.0  // 缩放Y（高度）
);

// 通过缩放实现不同尺寸的门
// 1.5倍宽度 = 1500mm宽的门
```

---

## 📊 数据库查询示例

```sql
-- 查看所有块定义
SELECT id, name, is_public, created_at FROM block_definitions;

-- 查看块的使用情况
SELECT 
  bd.name,
  COUNT(br.id) as usage_count
FROM block_definitions bd
LEFT JOIN block_references br ON bd.id = br.block_definition_id
GROUP BY bd.id, bd.name;

-- 查看某个项目的所有块引用
SELECT 
  br.id,
  bd.name,
  br.insertion_point_x,
  br.insertion_point_y,
  br.rotation_angle
FROM block_references br
JOIN block_definitions bd ON br.block_definition_id = bd.id
WHERE br.project_id = 'your-project-id';
```

---

## 🐛 故障排除

### 问题1：数据库连接失败

```
Error: Can't reach database server
```

**解决方案**：
```bash
# 检查PostgreSQL是否运行
pg_isready

# 启动PostgreSQL
# macOS
brew services start postgresql@14

# Ubuntu
sudo systemctl start postgresql

# 检查数据库是否存在
psql -l | grep aiignitecad
```

### 问题2：端口被占用

```
Error: Port 3001 is already in use
```

**解决方案**：
```bash
# 查找占用端口的进程
lsof -i :3001

# 终止进程
kill -9 <PID>

# 或更改端口
# 在 backend/.env 中修改 PORT=3411
```

### 问题3：Prisma迁移失败

```
Error: Migration failed
```

**解决方案**：
```bash
# 重置数据库（警告：会删除所有数据）
npx prisma migrate reset

# 重新运行迁移
npx prisma migrate dev

# 生成客户端
npx prisma generate
```

### 问题4：IndexedDB无法初始化

**解决方案**：
- 检查浏览器是否支持IndexedDB（Chrome、Firefox、Safari、Edge都支持）
- 清除浏览器缓存和IndexedDB数据
- 在隐私模式下浏览器可能禁用IndexedDB

---

## 📖 进一步学习

### 文档资源

- `DATABASE_DESIGN.md` - 完整的数据库设计文档
- `IMPLEMENTATION_GUIDE.md` - 详细的实施指南
- `AGENTS.md` - 项目规范和代码风格

### API文档

访问 http://localhost:3410/api 查看所有可用的API端点。

### 代码示例

查看以下文件了解使用方法：
- `lib/geometry.ts` - 几何运算示例
- `lib/block.ts` - 块操作示例
- `lib/transform.ts` - 变换操作示例
- `services/blockService.ts` - 前端块服务示例

---

## 🎉 成功！

恭喜！您已经成功启动了AIIgniteCAD的完整系统。现在您可以：

✅ 创建和编辑CAD图形
✅ 使用Blocks功能创建可重用的图形单元
✅ 离线工作（数据保存在IndexedDB）
✅ 在线时自动同步到PostgreSQL
✅ 使用强大的CAD函数库进行几何运算

开始探索和创建吧！🚀

---

## 💡 提示和技巧

### 键盘快捷键

- `Ctrl/Cmd + Z` - 撤销
- `Ctrl/Cmd + Y` - 重做
- `Delete` - 删除选中元素
- `Escape` - 取消当前操作
- `Enter` - 完成多段线绘制

### 性能优化建议

1. **批量操作**：使用批量API减少网络请求
2. **图层管理**：将相似元素放在同一图层
3. **块复用**：重复元素使用块而不是复制
4. **定期清理**：删除不需要的历史版本

### 最佳实践

1. **命名规范**：
   - 块名：使用描述性名称，如"M10螺栓"
   - 图层名：使用标准CAD图层命名，如"0", "轮廓", "中心线"

2. **块组织**：
   - 标准件设为公共块
   - 项目特定块设为项目块
   - 常用块收藏到"我的块"

3. **数据备份**：
   - 定期导出项目为DXF文件
   - 使用版本历史功能

---

## 📞 获取帮助

如有问题：
1. 查看故障排除部分
2. 检查浏览器控制台的错误信息
3. 查看后端服务器日志
4. 参考完整文档 DATABASE_DESIGN.md

Happy CAD-ing! 🎨