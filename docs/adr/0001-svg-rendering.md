# ADR 0001：使用 SVG 渲染 2D 画布

- **状态**：Accepted
- **日期**：2026-10-21
- **决策者**：前端团队

## 背景

AIIgniteCAD 当前聚焦 2D 线框绘图，图元数量通常在数千以内，需要快速迭代交互（选择、捕捉、夹点、标注）并保持可访问、可测试。

## 决策

使用 React + SVG 渲染画布，图元（line / circle / path / text）直接映射为 DOM 节点；视口变换通过 `<g>` 的 `transform` 实现。

## 理由

- 每个图元都是 DOM 节点，命中测试、样式、事件与调试成本低。
- 可以直接用 Playwright 查询元素并截图，无需额外像素断言工具。
- 与 React 的声明式渲染一致，预览层、选择框、夹点可复用同一套组件。
- 对当前数据规模，SVG 性能足够；已配合视口裁剪、空间索引和 memo 渲染控制开销。

## 后果

- 图元数量达到数万级时会出现 DOM 与重排瓶颈，需要改用 Canvas / WebGL。
- 复杂填充与大量文本的渲染成本高于位图方案。
- 若未来引入 3D 或超大规模图纸，应新建渲染器抽象，而不是继续堆叠 SVG 优化。

## 相关

- `components/Canvas.tsx`、`components/CADElementRenderer.tsx`
- `renderer/types.ts`、`renderer/svgRenderer.ts`（坐标换算与命中测试的抽象接口，当前仅 SVG 实现）
- `lib/viewport.ts`、`lib/spatialIndex.ts`
- [CAD_ENGINE_ARCHITECTURE.md](../architecture/CAD_ENGINE_ARCHITECTURE.md)
