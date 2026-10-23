## What

<!-- 改了什么，关联 Issue：Closes #123 -->

## Why

<!-- 解决什么问题，为什么采用该方案 -->

## How to test

<!-- 复现 / 验证步骤，附命令或截图 -->

```bash
npm run lint && npm run typecheck && npm test
(cd backend && npm run lint && npx tsc --noEmit && npm test)
npm run test:e2e
```

## Checklist

- [ ] 已补充或更新测试
- [ ] 本地通过 lint / typecheck / test / build
- [ ] 涉及交互或界面时附截图（可用 `npm run docs:screenshots`）
- [ ] 未提交 `.env`、密钥或真实 token
- [ ] 数据模型变更包含 Prisma 迁移
- [ ] 架构决策已记录到 `docs/adr/`

## Risk

<!-- 兼容性、数据迁移、性能或安全影响 -->
