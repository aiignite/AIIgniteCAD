# 在线 CAD 最佳实践优化：操作便利与界面美观

> 2026-10-24。本轮优化对标 AutoCAD Web 的操作习惯与 Onshape 类现代 Web CAD 的视觉规范，
> 分三个批次落地：视觉缺陷修复（P0）、视觉规范统一（P1）、交互便利增强（P2）。

## 背景

探索阶段确认了三类问题：

1. **静默失效的样式**：`tailwind.config.js` 的 `cad` 色板缺少 `hover` / `secondary` /
   `text-secondary`，组件中 20+ 处引用未定义 token，样式静默失效；`animate-in` 等动画类
   依赖的 `tailwindcss-animate` 插件未安装，11 处模态入场动画从未播放；`var(--cad-x)` 直引
   格式下 Tailwind 透明度修饰符（`bg-cad-text/10`，66 处）不可靠。
2. **主题体验断裂**：暗色切换不持久化、不跟随系统，刷新即回浅色；浅色模式下多处硬编码
   暗色（`hover:bg-white/10`、`gray-800` 等）。
3. **交互深度不足**：对齐 / 分布纯函数已存在但无 UI 入口；旋转 / 缩放 / 偏移 / 镜像不支持
   数值键入；修剪是"点击即删除"占位；延伸缺失；撤销栈不可见、按钮无禁用态。

## P0 视觉缺陷修复

- **token 体系重建**：`--cad-*` 变量改为空格分隔 RGB 三元组，Tailwind 侧
  `rgb(var(--x) / <alpha-value>)` 消费，透明度修饰符全面生效；新增
  `cad.hover` / `cad.secondary` / `cad.text.secondary`。SVG 属性消费处包 `rgb(var(--x))`。
- **动画**：安装 `tailwindcss-animate`，模态入场动画真实生效。
- **浅色模式**：清理 `hover:bg-white/10`、`gray-700/800`、`text-blue-400` 等硬编码为 cad token。
- **主题体系**：新增 `lib/themePreferences.ts`（存储边界）+ `store/theme.ts`（外部 store，
  快照缓存避免无限重渲）；`index.html` 内联首帧脚本防闪白；支持 浅色 / 深色 / 跟随系统，
  设置页外观分区新增主题三分段。
- **体验杂项**：`PromptDialog` 替代块库的 `alert()/prompt()`；右面板宽度与展开状态持久化
  （`lib/uiPreferences.ts`）；Footer"模型空间"死按钮改为当前图纸名展示。

## P1 视觉规范统一（经典专业风）

- 正文回归 `font-sans`（Noto Sans），Space Grotesk 保留给品牌区。
- 字号归档：9px→10px、15px→16px、17px→18px，段落正文类 10px 升 11px；坐标 / 数值读数
  保持 10px mono 高密度。
- 悬停统一 `hover:bg-cad-text/10`；右键菜单与菜单栏反馈一致。
- i18n 散点补齐：图层管理器（约 15 条 title）、块库按钮、文字输入模态、删除确认、
  画布动态输入提示；`AGENTS.md` 新增「界面样式」小节固化约定。
- 右面板左缘新增悬停收起把手。

## P2 交互便利增强

### 对齐 / 分布

- `hooks/useAlignDistribute.ts` 统一执行入口（走 `commitAction` 单步撤销）。
- 入口：右键菜单（≥2 图元出对齐、≥3 出分布）、选中集迷你工具栏对齐弹出面板、
  属性面板多选变换区、命令行 ALIGNLEFT/ALIGNRIGHT/ALIGNCENTERX/ALIGNTOP/ALIGNBOTTOM/
  ALIGNCENTERY/DISTRIBUTEH/DISTRIBUTEV（别名 AL/ACX/AT/AB/ARIGHT/ACY/DH/DV）。

### 撤销历史可视化

- `lib/command.ts`：`Command.describe()` 增删改统计、`getEntries()`、`jumpTo()`
  （批量撤销 / 重做，越界收敛）。
- `canvasStore`：`historyOverview`（两种历史模式都可用；command 模式经事件回调同步，
  不在渲染期读 ref）+ `jumpTo`。
- 顶栏：撤销 / 重做接入禁用态；时钟按钮展开历史下拉（最新在上，点击跳转任意节点）。

### 变换数值输入（动态输入扩展）

- `lib/dynamicInput.ts` 新增 `scale` / `distance` 模式：旋转 / 镜像只需键入角度，
  缩放键入倍率（沿实时方向放大提交点距离，工具端反推即键入值），偏移随时可键入距离
  （不依赖光标位置）。
- `CanvasTool` 新增可选 `onDynamicSubmit`：工具自治消费键入值，交互层无工具分支；
  ROTATE / MIRROR 实现，SCALE 走合成点击，OFFSET 经 `ToolContext.dynamicDistance`
  在下一次真实点击消费（可连续按同距离偏移）。
- ROTATE 点击基点后保留拖拽态（与 SCALE 一致），等待拖拽或键入角度。

### 修剪 / 延伸

- `lib/trimExtend.ts` 纯函数：快速修剪（免选边界，AutoCAD 2020+ 模式）支持
  LINE（交点分段）/ ARC（角区间，尊重 `clockwise` 约定）/ CIRCLE（转 ARC）/
  LWPOLYLINE（逐直线段，闭合链拆开放链）；延伸支持 LINE / ARC / 多段线端点段，
  射线求最近边界交点。退化情形返回 null 并提示。
- 重写 `TrimTool`，新增 `ExtendTool`；注册进工具目录 / 菜单 / 命令行（TR / EX）。
- 16 个几何单测 + 工具层测试 + E2E 修剪用例。

## 测试与验证

- 单元测试 659 通过（新增 uiPreferences / trimExtend 等用例）。
- E2E 55 通过（新增旋转键入角度、偏移键入距离、快速修剪；修复 3 处选择器脆弱性）。
- lint 0 error、`tsc --noEmit` 与生产构建通过。

## 后续建议

- AI 设置三面板（模型 / 助手 / 技能）国际化（量大，单独批次）。
- FILLET / CHAMFER / BREAK / STRETCH 交互工具；对齐 / 半径 / 角度标注类型。
- 偏移的"点击侧方向"语义（`offsetService` 需带方向重载）。
- 命令面板（Ctrl+K 模糊搜索）、触控板 pinch 缩放、窄屏响应式布局。
