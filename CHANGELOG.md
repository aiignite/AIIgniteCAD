# Changelog

本项目的重要变更记录在此文件。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 图元线型 / 线宽：属性面板新增「线型与线宽」分区（实线 / 虚线 / 点线 / 点划线，线宽按 0.13–2.00 mm 档位），带实时预览；颜色区改为常用色板一键切换，并可点调色板按钮弹窗细选。线型与线宽随图纸保存，DXF 导出写入实体组码 `6` 与 `370`，导入可回读；打印时虚线按出图比例缩放，1:100 下不会退化成实线。
- 站点图标：新增火焰 logo 的 favicon（`public/favicon.svg` + 32/64/180 PNG，由 `scripts/generate-favicons.mjs` 生成），浏览器标签页不再显示默认地球图标。
- 左侧面板改为「工具 / 图块库」双页签：图块库从原来的折叠分组提升为与工具平级的页签，切换即换内容、图块树在页签内撑满高度自行滚动（不再固定 `max-h-64`）；页签记忆在 `localStorage`，刷新后保持。面板整体收起时不显示页签，仍回到按工具分组分隔的图标条，图块库收成图标条末尾的一个按钮，点开即展开并落回图块库页签。
- 计划预检（`lib/planReview.ts`）：计划确认前按当前选择集逐步模拟执行写步骤，用与预览门禁同源的确定性规则对比改动前后，得出「这份计划会引入哪些问题」，并按 `changedIds` 把问题归因到具体步骤；计划卡逐步骤显示风险徽标与整体预检摘要，失败步骤单独计数。只模拟不落图，不占撤销步。
- 跨图纸一致性检查（`lib/projectConsistency.ts`）：比较项目内各图纸的单位、字高、尺寸精度、制图标准与约定图层清单，另有重名图纸、空图纸、约定缺失三条清单级规则；只吃清单事实，不加载图元正文。图纸检查面板新增「当前图纸 / 项目一致性」范围切换，支持复制一致性摘要。
- 跨图纸快照插入（`lib/crossDrawing.ts` + `services/drawingLoader.ts`）：图纸列表可把另一张图纸一次性复制进当前图纸——包围盒左下角对齐、图元重新编号并共享 `groupId`，块引用因依赖来源块定义而跳过并计数，单次上限 2000 图元。读取源图纸不调用 `openProject`，不改变服务端的「最近打开」。
- AI 变更的可解释说明（`lib/changeExplanation.ts`）：预览弹窗新增「变更明细」，逐条列出 `+ / ~ / −` 图元类型、图层与几何摘要（修改类给出前后对照），并按图层聚合增删改数量；可一键复制整份变更说明，条数超限时截断并注明剩余数量。
- `check_drawing` 新增 `scope=project`：跨图纸一致性检查接入 AI 只读工具，返回结构为 `{ scope, drawings, summary, issues }`；项目图纸清单不可用时明确回报失败，而不是当成「没有图纸」。
- AI 上下文新增「项目图纸」行：项目内存在多张图纸时点名其他图纸的名称、图元数与约定单位，让模型知道跨图纸问题该问什么。
- 设计约定与 AI 计划联动：约定此前只影响提示词与事后门禁，现在计划阶段就能看到「这一步会违反哪条约定」。
- DXF 解析移入 Web Worker：新增 `workers/dxfParser.worker.ts` 与 `services/dxfWorker.ts`，大文件导入不再冻结主线程；请求带自增 id 支持并发，Worker 不可用（Node / 测试环境）时回退主线程，Worker 崩溃时挂起请求自动改走主线程重试一次，超时则终止线程并报错。解析实现仍只有一份（`services/dxfService`），两条路径结果一致。
- 空间索引视口查询 `SpatialGrid.queryVisible`：构建索引时缓存包围盒，查询时返回与视口精确相交、且按原始叠放顺序排列的图元，替代每帧全量过滤与重复包围盒计算。
- 协作加入时图纸对账：新成员向房间请求状态（`state-request` / `state-snapshot`），服务端把请求转给房间内一个现有成员，由该成员回传快照；快照上限 2000 图元，超出部分截断并标记 `truncated`。合并时只覆盖同 id、追加新 id，不删除本地独有图元。
- 协作断线补发：广播基线只在补丁真正发出时推进，重连后自动把断线期间的本地修改补发出去。

### Changed

- 移除选中集迷你工具栏：移动 / 复制 / 旋转 / 缩放 / 镜像 / 偏移 / 阵列 / 删除 / 问 AI 统一由右键菜单提供，选中时不再浮出遮挡图元的浮层。
- 右侧属性面板的折叠入口常驻：展开时收起按钮固定在页签栏右侧，收起后保留窄条与展开按钮，不再依赖悬停才浮现的把手。
- `pre-push` 钩子从「历史仅告警」升级为**全历史检测**：待推送引用的历史里只要有提交碰过 `.env` / `.env.*` 就阻断，需显式 `CAD_ALLOW_DIRTY_HISTORY=1` 认领本次推送。判定按「pathspec 取候选提交 → 文件名再过一遍判定」，避免 `.env.*` 把只含 `.env.example` 的仓库误拦；新增 `scripts/test-pre-push-hook.sh` 覆盖 7 个场景（含上述误拦用例与「认领也不能放过新增 `.env`」）。
- 远端地址不再内嵌凭据：`.git/config` 里的明文 token 已移除，改由系统凭据助手（Keychain）提供；仓库历史中 `.env` 的清理方案（含本地预演实测数据、执行步骤、验收与回滚）见 [docs/guides/SECRET_HISTORY_REMEDIATION.md](docs/guides/SECRET_HISTORY_REMEDIATION.md)。
- `reviewIssueKey` 的判等加入问题描述：把图元从图层 0 移到另一个未登记图层时，规则与图元都没变但问题内容已变，旧实现会把它当成同一条问题漏报。
- `createDraft` 新增第五参 `projectDrawings`；`AgentDraft` 同步增加该字段，供 `check_drawing` 的项目范围读取。
- 图纸管理详情的图元数量改用列表接口的 `elementCount`：此前读 `elements.length`，而列表不返回图元正文，永远显示 0。
- `collaborationService.sendPatch` 改为返回是否实际发出；新增 `requestState` / `sendStateSnapshot`，socket 工厂可注入以便测试。
- 服务端新增 `state-request` / `state-snapshot` 事件，并抽出 `sanitizeStateSnapshot` / `pickPeerSocket` 做载荷校验与应答成员选择。
- 视口裁剪从「空间索引取候选 + 遍历全部图元精确过滤」改为索引内的精确查询，10000 图元平移帧基准约 0.03ms（索引构建 3.6ms）。

### Fixed

- 快捷键速查的 Esc 偶尔关不掉：调用方传的是内联 `onClose`，监听器把它写进依赖数组后，画布每次重渲染都会移除并重新注册 `keydown`，Esc 恰好落在重挂的空档就被吞掉。改为用 ref 持有回调、监听器只注册一次（同一类「不稳定回调导致监听器抖动」的写法值得在其他弹窗一并排查）。
- 断线期间的协作修改不再丢失：此前补丁发送失败时基线仍被推进，重连后这些修改无法补发。
- 新成员加入协作房间后能看到已有成员的图纸：此前只能收到加入之后的增量补丁，加入前的内容为空。

### Added

- 偏移几何正确性重做（`services/offsetService.ts`）：线段按法向平移、相邻偏移段顶点取交——凹角不再出现穿越尖刺、开放多段线不再被多算一条闭合边；矩形按边长直接推导并在越过边线时判定退化，不再对自交多边形取包围盒得到「假矩形」；新增 `offsetElements` 返回 `{ elements, failures }`，不支持的图元类型与退化几何显式报告，工具与命令行提示「已复制 N、跳过 M（原因）」，不再静默复制原对象。
- 统一几何容差模块 `lib/geometryTolerance.ts`：点 / 线段 / 半径 / 偏移距离 / 多边形面积 / 角度容差与退化判定收敛一处，偏移、参数重算与 DXF 换算共用，替换散落的魔法数。
- 参数化图元「参数—几何」一致性：`advancedShapesService` 新增 `isParamBasedShape` / `regenerateElement` / `reconcileElement`——仅移动中心时平移轮廓，齿数 / 模数 / 圈数等形状参数变化时按参数重算 points；齿轮补读图元上的 `addendum` / `dedendum`（原先写死不读），螺旋起始半径显式持久化（`CADElement.startRadius`，旧存档从首点推导）；属性面板与夹点拖拽两条路径统一在 `canvasStore.updateElement` 收口。
- DXF 单位体系：导入按 `$INSUNITS` 换算到 mm，导出按图纸单位换算并在 HEADER 声明 `$INSUNITS`；新增 `parseDXFWithReport` / `exportToDXFWithReport`，不支持的实体与块展开深度超限进入报告而非静默丢弃，导入单位非 mm 或存在跳过项时通知用户。
- 图案填充渲染闭环：HATCH 图元按边界多边形渲染——SOLID 半透明填充，其他图案生成斜线并以 `clipPath` 裁切；填充工具点击即打开填充对话框（未接线时明确提示），DXF 导出输出边界 LWPOLYLINE。
- 块插入产品路线落地为「符号展开复制」：块库条目一键插入到视口中心、拖拽放入画布与 AI `insert_block` 统一走 `createBlockReference` + `explodeBlockReference`（平移量 = 插入点 − 基点，共享 `groupId` 便于整组选中），替代此前拖拽路径手写克隆平移。

### Changed

- `offsetElement` / `offsetElements` 返回值改为 `CADElement | null` 与 `{ elements, failures }`，`aiActions` 偏移与 `OFFSET` 命令同步适配：全部失败时返回明确原因，不再把原对象复制充当偏移结果。
- DXF 入口调整为带报告的 `parseDrawingFileWithReport` / `exportToDXFWithReport(elements, { units })`；旧 `parseDXF` / `exportToDXF` 保留为兼容包装。

### Fixed

- 偏移不再产生错误几何：零长线段、零 / 负半径与零距离统一前置拒绝；轴对齐矩形偏移越过边线时判定退化并跳过而不是返回自交「假矩形」。
- 夹点拖拽参数化图元中心不再只改参数不改轮廓：拖拽结果经 `reconcileElement` 同步，弹簧 / 齿轮 / 螺旋 / 椭圆的参数编辑在属性面板确认后立即重算轮廓。
- 螺旋起始半径丢失导致无法重算：`CADElement` 新增 `startRadius` 并在生成时存储，旧存档从首点推导，属性面板新增「起始半径」字段。
- DXF 导入单位不再被静默忽略（按米导入的图形不再被当成 mm 放大 1000 倍）；导出不再固定 mm，按图纸单位换算并声明 `$INSUNITS`。
- 填充图元从「不可见占位」变为可渲染、可导出边界；块拖拽放入画布不再走手写平移，插入语义与块库按钮、AI 插入一致。

### Added

- 统一 ProjectDocument 文档模型（`lib/projectDocument.ts`）：图元、图层、绘图设置、块引用与设计约定收敛为同一份版本化文档，日常保存、版本快照、离线同步与 AI 工具共用；旧存档缺省字段自动迁移为默认图层与设置，服务端 Decimal 字符串与非法载荷被收敛。
- 本地文档级原子保存：`indexedDBService.saveDocument` / `loadDocument` 在同一事务内替换项目元数据、图元、块引用、图层快照并 upsert 绘图设置，任一 store 失败整体回滚；删除项目连带清除设置行。
- 图层与绘图设置进入日常保存与同步链路：自动保存纳入图层顺序 / 颜色 / 隐藏 / 锁定与设置变化；`PUT /api/projects/:id` 在同一事务内整份替换图层并 upsert 绘图设置（含载荷校验：图层名非空且不重复、设置为正数、精度 0–8、单位限 mm/cm/m/in/ft）。
- 新建图纸与内置示例按默认文档初始化（默认图层与设置，不继承上一张图的画布状态）；打开图纸时服务端响应中的图层、设置与设计约定一并恢复，服务端失败回退本地文档，纯图元快照的旧存档按默认文档迁移。
- 版本快照新增设计约定：恢复版本时制图标准不会退回旧值。

### Changed

- `App.tsx` 图纸文件管理（保存 / 版本 / 加载 / 新建 / 重命名 / 删除 / 自动保存 / 自动版本）抽至 `hooks/useDrawingFiles.ts`，主组件只做组装。
- 升级需执行 `npx prisma migrate deploy`；`PUT /api/projects/:id` 新增可选的 `layers` 与 `drawingSettings` 字段，旧客户端不发送则行为不变。

### Fixed

- 本地保存不再复活已删除图元：IndexedDB 元素快照改为同一事务内按项目替换，删除、清空与刷新重载结果一致；新增跨项目隔离回归测试。
- 云端元素保存不再整图软删除重插：新增稳定 `element_id` 与活动元素唯一约束（迁移 `20261025223000_stable_element_ids`），按图元 id 增量创建 / 更新 / 软删除；项目列表 `elementCount` 只统计活动元素。
- 账户资料与修改密码路由补齐鉴权中间件，未登录 / 非法 token 直接返回 401，不再依赖未填充的 `req.user`。
- 网络故障不再清空有效登录态：启动拉取用户或项目失败时保留 token 并回退本地图纸列表；打开项目服务端失败时回退本地元素快照，401 仍会清理登录态。
- 生产环境 Prisma 迁移失败时拒绝启动，避免新代码继续跑在旧 schema 上。

### Changed

- `POST /api/projects/:id/elements` 要求元素带非空且不重复的 `id` 与 `type`，返回 `created` / `updated` / `deleted` 计数；升级需先执行 `npx prisma migrate deploy`。

### Added

- 快捷键自定义：设置页新增「快捷键」分区，单键键位（工具切换与编辑动作）可视化重绑——点击键帽按下新键，Backspace 清除（该命令停用单键），冲突时提示占用者；一键恢复默认，本地保存立即生效，速查表与工具栏提示同步显示生效键位。
- 新增 AutoCAD 系快捷键：Ctrl+1 开关右侧属性面板、F2 聚焦命令行、Space 重复上一条命令（动态输入键入期间自动让位）；视图菜单新增对应入口。

### Fixed

- Shift + 点击加选从未真正生效：按下时加入的选择集在松开时被「未拖拽即收窄」逻辑立即撤销；现在 Shift+点击按 AutoCAD 语义切换选择——未选中加入、已选中移出，且不再进入拖拽/收窄路径（补工具级与 E2E 用例）。

### Changed

- 界面信息架构按常规布局重组：右侧只保留可折叠的属性检查器（属性 / 结构）；图块库从属性面板迁到左侧工具面板（图块 / 分类树可拖入画布）；图纸检查改为满屏窗体（与版本历史同款骨架）；设计约定并入设置页新分区；图纸清单（原项目图纸）归入「文件」菜单以满屏窗体打开，设置页导航仅保留配置类分区并保留清单跳转入口。
- 左栏面板入口语义更名：外层「用户信息」指向当前登录用户（原「用户管理」），系统用户列表仍只在设置页「用户管理」分区（管理员可见），详情补编号与头像展示。
- 顶栏按钮统一为同一套风格：全部 size-8 圆角、18px 图标、ghost 悬停反馈，AI 激活与导出用主色填充，去掉了圆形主题按钮与多余投影。

### Fixed

- 分层层级整备：满屏窗体 z-40、AI 浮窗 z-45、模态 z-50——修复满屏窗体关闭按钮被顶栏拦截、AI 预览弹窗的确认复选框被浮窗挡住两类点击失效。

### Added

- 用户管理（仅管理员）：用户表新增角色字段，服务端启动时把最早注册的用户提升为管理员；管理员可在设置页「用户管理」分区以主从方式查看用户列表并调整角色，最后一个管理员不可降级、管理员不可改动自己的角色。
- 图纸管理并入统一设置页：新建、重命名、打开、删除以「列表 → 详情」主从布局呈现，菜单「文件 → 图纸管理」、工具栏入口、Ctrl+N / Ctrl+O 全部指向该分区（原居中弹窗移除）。
- 管理型界面统一为满屏版式：版本历史从居中卡片改为与设置页同款满屏主从布局；设置页与版本历史支持 Esc 返回画布。

### Fixed

- 多选拖动 now 全组可见地跟随光标：移动 / 复制拖拽过程中所有选中元素实时渲染幽灵，夹点小方块同步跟随，不再松开鼠标后才跳到新位置（`previewOffset` 首次接入预览层）。
- 满屏界面（设置页 / 版本历史）层级高于顶栏，右上角关闭按钮不再被 Header 拦截点击。
- 顶栏按钮统一为纯图标（保存 / AI / 主题 / 设置 / 导出），文字说明移入 tooltip 与 aria-label；新增设置齿轮直达入口。

### Added

- 对齐 / 分布入口：右键菜单、选中集迷你工具栏、属性面板与命令行（`ALIGNLEFT` / `DISTRIBUTEH` 等 8 条命令）都可对多选图元执行对齐与等距分布，走单步撤销。
- 撤销历史可视化：顶栏撤销 / 重做接入禁用态，新增时钟按钮展开历史列表，展示每步的增删改图元数并可点击跳转到任意节点（命令栈与快照两种历史模式都支持）。
- 变换数值输入：旋转 / 镜像可键入角度、缩放可键入倍率、偏移可键入距离后连续点击按同距离偏移（对标 AutoCAD 动态输入）。
- 真·修剪与延伸：修剪从「点击即删除」占位升级为 AutoCAD 2020+ 免选边界模式（交点分段、点击侧剪除，支持线 / 弧 / 圆转弧 / 多段线），新增延伸工具（沿点击端延伸到最近边界，`TRIM` / `EXTEND` 命令与菜单 / 工具栏入口同步就位）。
- 界面主题支持「浅色 / 深色 / 跟随系统」三分段并持久化，刷新不再闪回浅色；设置页外观分区新增主题选择。

### Fixed

- 修复静默失效的样式：`cad.hover` / `cad.secondary` / `cad.text.secondary` 等 token 补齐定义，颜色变量改为 RGB 三元组使 Tailwind 透明度修饰符（`bg-cad-text/10` 等 60+ 处）真实生效；安装 `tailwindcss-animate` 让 11 处模态入场动画从「从未播放」变为生效。
- 修复浅色模式下块库 / 图层面板 / 缩放控件 / 工具栏的硬编码暗色（`hover:bg-white/10`、`gray-700` 等）。
- 块库建块 / 建分类的 `alert()` / `prompt()` 替换为应用内对话框；右面板宽度与展开状态刷新后保持；状态栏失效的「模型空间」按钮改为展示当前图纸名。

### Changed

- 界面视觉规范统一：正文回归 Noto Sans，字号收敛为 12 / 11 / 10px（mono 读数）三档，图标收敛为 16 / 18 / 20px 三档，悬停反馈统一 `hover:bg-cad-text/10`；图层管理器、块库、文字模态等约 25 条硬编码文案接入 i18n。
- 完整菜单栏（文件 / 编辑 / 视图 / 插入 / 格式 / 工具 / 绘图 / 标注 / 修改 / 帮助）与独立六分区设置页收口全部界面入口，快捷键速查表由菜单数据模型派生；工具目录单一事实源 `lib/toolCatalog.ts`。

### Fixed

- 子路径部署下图标不再退化成英文单词：`@font-face` 的 `src` 原写绝对路径 `/fonts/...`，挂在 `/cad/` 下会去请求站点根、被网关默认站点以 `text/html` 兜底返回，Material Symbols 连字全部显示成 `send`、`folder_open`；改为相对自身解析，并把 `public/` 里无内容哈希的 CSS 与 `index.html` 从 30 天/启发式缓存改成 `no-cache`（字体二进制仍长缓存），否则修好了老访客也看不见。
- 生产站点挂在 `/cad/` 子路径后不再整站失联：前端构建改为读取 `VITE_BASE_PATH` / `VITE_API_URL`，实时协作的 socket.io 握手路径按 API 基址推导前缀（`collaborationSocketPath`），否则升级请求会落到网关默认站点、协作面板只显示连接失败。
- 后端识别两级代理的 `X-Forwarded-For`（`trust proxy`）：限流按 `req.ip` 计数，不认代理头会让全部访客挤进同一个桶，认证配额几分钟内被打满。
- 后端镜像带上 Prisma 迁移（`.dockerignore` 此前排除了 `prisma/migrations`），容器内 `prisma migrate deploy` 才有可执行的迁移，否则生产库只能停留在空 schema。

- 计划与多方案不再必然失败：提示词此前把「本轮可调用工具」（只读工具）当成「步骤可引用工具」，模型只能引用 `query_elements` 这类不写图的步骤；现在单独下发 22 个写工具的速查表，规则只约束步骤引用（[ADR 0018](docs/adr/0018-ai-tool-contract-and-rejection-loop.md)）。
- 被拒绝的工具调用会成对回传给模型，并点名失败字段与取值范围：此前拒绝只留在前端本地，模型看不到原因、落库顺序也不满足 provider 对 `tool_calls` / `tool` 配对的要求。
- 前端工具轮次上限改为读取服务端下发的 `maxToolRounds`（默认 4，最多 8），不再出现第 5 轮必 400。
- 单轮工具调用上限按「尝试数」计：失败调用同样占额度，模型无法靠反复提交同一组错误参数把一轮跑满。
- 块库读取失败不再被当成空库：`list_blocks` 与 `insert_block` 明确回报「块库当前不可用……不是空库」，模型据此改走绘图工具或提示用户稍后重试，而不是凭空重画库里已有的符号。
- 技能面板的「有用率 / 采纳率」在采纳或反馈回执成功后立即刷新，不需要重开面板；无轮询。
- 技能编辑器手写路径的校验与导入路径、后端规则合一（工具名、上下文信号、字段长度、数值范围），此前只有导入路径拦得住脏数据。
- brief 档上下文补上一行事实（有无标注、块引用数、隐藏 / 锁定图层数）；standard 档图层截断从 `…+N more` 改为「…另有 N 个图层（1 个隐藏、1 个锁定）」。
- 计划与多方案里的编辑步骤不再被整份拒绝：后端校验计划步骤时不再要求 `ids`，作用对象改为在用户确认时按当前选择集解析（此前 `{tool: "move_elements"}` 这类步骤会被判 `NO_TARGET` 导致整份计划被丢弃），直接调用编辑工具时规则不变（[ADR 0017](docs/adr/0017-ai-gap-closing-and-conventions-downstream.md)）。
- 技能 Playbook 的全部字段真正进入提示词：此前 `steps` / `checks` / `examples` / `requiredContext` / `negativeKeywords` / `version` 只存在于数据模型，模型看不到；现在按技能成块输出，反关键词渲染为「不适用场景」。
- 只读设计工具结果统一走字符预算裁剪，`check_drawing` 改为读取项目设计约定，不再出现超大返回体撑爆上下文。
- 后端技能写入校验与前端对齐：`steps[].tool` 必须是已知工具名，`selectionTypes` 必须是最长 32 字的非空字符串，绕过前端直接调接口也无法写入脏数据。
- 注册页「返回登录」按钮此前传了不存在的 `onLoginClick` 属性、点击无响应，现已接通。
- 版本记忆补齐「修改数」：此前只统计新增 / 删除，「改了尺寸但没增减图元」的版本在记忆里表现为无变化；现按轻量几何签名比较，版本列表显示 `+N / -M / ~K`，存量摘要缺字段时按 0 处理。
- 删除键不再因焦点位置而失灵：全局键位此前额外要求 `document.activeElement === document.body`，点过工具栏 / 状态栏按钮后焦点落在按钮上，`Delete` 静默无响应；现只保留「输入控件内不拦截」，在画布任意位置删除都生效。
- 连续粘贴的副本不再完全重叠：`Ctrl+V` 每次都按同一固定偏移复制原始缓冲，第二次粘贴与第一次坐标完全一致；现按粘贴步进逐次错开，重新复制后步进归零。

### Added

- 单键换工具：沿用 AutoCAD 键位（`L` 直线、`C` 圆、`R` 矩形、`A` 圆弧、`T` 文字、`H` 填充、`D` 标注、`O` 偏移、`M` 移动；`E` 删除、`G` 组合、`X` 解散），映射集中在 `lib/shortcuts.ts`；焦点在输入控件或弹窗打开时不响应，切换后状态栏与提示同步更新。
- 画布右键上下文菜单：单击右键弹出（右键拖拽仍是平移），有选择集时提供复制 / 粘贴、移动 / 拖拽复制 / 旋转 / 缩放 / 镜像 / 偏移 / 阵列、组合 / 解散 / 隐藏 / 隔离、问 AI 与删除；无选择集时提供全选、粘贴、缩放到范围与显示全部。菜单按视口边缘自动收拢，点击外部或 `Esc` 关闭。
- `Ctrl/Cmd + A` 全选可见且未锁定的图元。
- 图元组合与解散：选中的多个图元可「组合」为一个对象（写入 `groupId`，命中与框选按整组处理，可整体移动），也可「解散」回独立图元；左侧工具栏新增两个按钮，命令行另有 `GROUP` / `UNGROUP`。
- 剪贴板复制粘贴：`Ctrl+C` / `Ctrl+V` 复制与粘贴选中图元，副本重新生成 id 并脱离组合；点击（未拖拽）已选中的对象会把选择集收窄到该对象，拖拽复制完成后自动回到选择工具，副本可逐个单独选中移动。
- 接管文件类快捷键：`Ctrl/Cmd+S` 保存图纸、`Ctrl/Cmd+P` 打开打印 / 绘图面板、`Ctrl/Cmd+O` 与 `Ctrl/Cmd+N` 打开图纸管理弹窗，不再触发浏览器自带的「保存网页 / 打印 / 打开 / 新建窗口」。
- 中英双语界面：默认中文，页头语言按钮可切换英文并写入 `localStorage`；文案集中到 `lib/i18n.tsx` 的扁平字典，`TranslationKey` 由中文字典推导，英文必须覆盖同一组键。已覆盖登录 / 注册、欢迎页、顶栏与工具条、文件 / 编辑 / 打印 / 版本 / 语言 / 主题相关动作、形状与填充 / 阵列 / 快速选择 / 参考图转 CAD 弹窗、属性 / 检查 / 约定 / 设置 / 用户资料面板、通知与 AI 对话 / 预览主流程；图纸检查的问题描述按语言生成（[ADR 0020](docs/adr/0020-i18n-and-header-menu.md)）。
- AI 块库与版本技能：新增 `insert_block_by_name`（按名字插入块，大小写无关精确匹配 + 唯一子串匹配，歧义时列出候选）、`save_selection_as_block`（把选中图元存回块库）与 `save_version`（保存版本）；新增内置技能 `cad_block_library` 与 `cad_versioning`。建块与存版本作为预览中的附加操作，仍先确认、再在服务端执行，不绕过预览管线。
- 顶栏菜单重设计：保留撤销 / 重做、保存、AI、语言、主题与导出等高频动作，新增「文件」菜单收纳导入 DXF / DWG、参考图转 CAD、导出 DXF、打印 / 绘图、版本历史与保存版本；左侧工具条 + 右侧检查器 + 底部命令行的三区布局不变（[ADR 0020](docs/adr/0020-i18n-and-header-menu.md)）。
- 补充测试：`tests/i18n.test.ts`（字典键集合、插值、默认中文）、`tests/e2e/smoke.spec.ts`（默认中文、切换英文并刷新保持、文件菜单打印 / 版本路径）、块与版本工具的前后端单测；E2E 选择器同步改为中文默认。

- 支持 DWG 导入：新增 LibreDWG `dwg2dxf` 独立转换容器（`dwg-converter/`），后端 `/api/import/dwg` 把 DWG 转成 ASCII DXF 后复用现有解析、预览与一步撤销链路；DXF 解析器补齐 `INSERT` 块展开（含嵌套、缩放、旋转、阵列与图层继承）、`MTEXT` 转文字和 `DIMENSION` 匿名块展开。默认单文件 50 MB，`SPLINE` / `HATCH` 等仍暂不导入。
- 支持局域网部署的 OpenAI 兼容模型端点（如 CCSwitch）：开启 `AI_ALLOW_PRIVATE_ENDPOINTS=true` 后，其他 provider 也可使用 RFC1918 / IPv6 ULA 的 HTTP 地址；公网 HTTP、云元数据与链路本地地址仍然拒绝，内网域名仍需加入 `AI_ALLOWED_ENDPOINTS`。生产 compose 已透传两个变量，并支持从容器内访问宿主机的 `host.docker.internal`。
- 一键发布到共享生产服务器（与 AIDriveAll / AIDriveNote 同一套机制）：本地 `scripts/deploy-remote.sh` 先做端口占用预检，再 rsync 工作区、ssh 触发服务器侧非交互 `deploy.sh`（`docker compose -f docker-compose.prod.yml up -d --build` → 等库就绪 → 容器内迁移 → 就绪探针与页面自检），最后从外网校验 `https://aiignite.com.cn/cad/health`。新增 `docker-compose.prod.yml`、`Dockerfile.prod` 与 `deploy/nginx/cad.conf`（子路径静态资源、`/cad/api` 反代、SSE 免缓冲、`/cad/socket.io/` 升级），前后端只绑定 `127.0.0.1`、由共享网关对外暴露；`scripts/init-server-env.sh` 首次生成服务器 `.env`（随机 `POSTGRES_PASSWORD` / `JWT_SECRET` / `ENCRYPTION_KEY`，权限 600），仓库不再需要任何生产密钥。详见 [docs/guides/DEPLOYMENT.md](docs/guides/DEPLOYMENT.md)。
- 方案对比卡片按草稿上的几何差分显示「新增 N / 修改 M / 移除 K」，全为 0 时显示「无几何变化」，不再只信模型自述的步骤数；连续的同工具同参数调用会在 toolResult 里提示模型换做法，但不直接拒绝（[ADR 0018](docs/adr/0018-ai-tool-contract-and-rejection-loop.md)）。
- 块目录读取结果带上可用性标记（`getBlockCatalog` 返回 `{ entries, ok }`），Agent 草稿据此区分「块库不可用」与「块库为空」。
- 技能统计刷新信号 `store/skillStats.ts`：轻量外部 store + `useSyncExternalStore`，回执成功即通知订阅方。
- 补充测试：`tests/skillStats.test.ts`（订阅 / 退订）、`tests/aiAgentLoop.test.ts`（失败调用占额度、重复调用提示、几何差分计数）、`tests/aiTools.test.ts`（字段级错误与块库不可用文案）、`tests/designTools.test.ts`（`list_blocks` 不可用与空库区分）、`tests/aiContext.test.ts`（brief 档事实行与图层截断计数）、`tests/aiSseEvents.test.ts`（轮次上限取服务端）、`tests/skillValidation.test.ts`（编辑器与导入共用规则）；`tests/e2e/aiChat.spec.ts` 断言方案卡片刻度；后端 `backend/tests/llmChatAgent.test.ts` 补消息序列合法与提示词含写工具清单两条。
- 项目设计约定下沉到确定性检查：检查面板、AI 质量门禁与 `check_drawing` 工具统一按约定核对图层归属（未登记图层给警告、约定图层为空给提示）与文字字高是否统一（[ADR 0017](docs/adr/0017-ai-gap-closing-and-conventions-downstream.md)）。
- 技能采纳率闭环：轮次回执新增 `skillCodes`，`GET /api/skills/stats` 同时聚合主观反馈与客观采纳，给出 `adoptionRate`；未评价 / 未决策不计入分母。
- 块目录缓存：按项目缓存 60 秒，块或分类增删改后立即失效，避免每一轮 AI 请求都重新拉取整棵块树。
- 补齐 React 类型依赖（`@types/react` / `@types/react-dom`，devDependencies）：此前组件 props 与 state 全部退化为 `any`，类型检查形同虚设；补齐后暴露并修复 4 处历史问题。
- 差距报告 [docs/reports/AI_CAPABILITY_GAP_REPORT.md](docs/reports/AI_CAPABILITY_GAP_REPORT.md)：P0–P3 规划项逐条核对结论、两轮共 21 项差距与 4 项已知限制。
- 第二轮补差 [ADR 0018](docs/adr/0018-ai-tool-contract-and-rejection-loop.md) 已实施（G11–G21），要点见上方 Fixed / Added。
- 补充测试：`tests/designTools.test.ts`（约定三类规则）、`tests/previewReview.test.ts`（门禁读约定）、`backend/tests/blocks.test.ts`（块目录展开图元）、`backend/tests/toolValidation.test.ts`（计划步骤不要求 ids）、`backend/tests/chatSessions.test.ts`（回执写入技能归属）、`backend/tests/versionMemory.test.ts`（修改数统计）。
- 块与符号复用：新增只读工具 `list_blocks` 与写入工具 `insert_block`；每轮请求前把 `/api/blocks/tree` 压成扁平块目录注入 Agent 草稿，插入时在草稿上展开为图元，沿用预览与单步撤销管线（[ADR 0016](docs/adr/0016-block-reuse-quality-gate-and-feedback.md)）。
- AI 结果质量门禁：预览弹窗自动对改动前后跑同一套确定性检查规则，只把本轮新增的问题算作 AI 引入；error 级问题必须显式勾选确认才能应用，warning / info 仅提示（[ADR 0016](docs/adr/0016-block-reuse-quality-gate-and-feedback.md)）。
- 回答反馈闭环：每条 AI 回答可标记「有帮助 / 没帮助」并附原因，反馈写回该轮助手消息 metadata；新增 `GET /api/skills/stats` 按技能 code 统计 up / down 与有用率，技能面板显示「有用 X%（N）」。
- 技能导入导出：技能可导出为带版本号的 `aiignite-skill` v1 JSON，导入时在浏览器侧严格校验（未知工具、未知上下文信号、超长字段、越界数组一律拒绝并说明原因），代码冲突时自动追加副本后缀并在预览中确认。
- 补充 P3 覆盖：`tests/blockCatalog.test.ts`、`tests/previewReview.test.ts`、`tests/skillTransfer.test.ts`、`backend/tests/chatSessions.test.ts`（反馈路由）、`backend/tests/skills.test.ts`（有用率统计），以及 `tests/e2e/aiChat.spec.ts`、`tests/e2e/skills.spec.ts` 的浏览器级用例。
- 设计约定：项目级制图标准、单位、字高、标注精度、图层规则与备注，存 `projects.design_conventions`，随项目同步；右侧导航新增「约定」面板，每轮 AI 请求自动注入约定摘要（[ADR 0015](docs/adr/0015-design-conventions-and-variants.md)）。
- 版本记忆：创建版本时对比上一版快照计算新增 / 删除数、类型分布与涉及图层，写入 `project_versions.change_summary`；最近 5 个版本连同提交信息注入 prompt，版本列表显示 `+N / -M`。
- 多方案生成：新增 `propose_variants` 控制工具与方案模式（只读工具 + `propose_variants` 白名单）；模型给出 2–3 个备选方案，每个方案在草稿独立执行并渲染缩略预览，采用其中一个后只走一次预览、只占一步撤销。
- 参考图转 CAD：页头「Trace」打开本地参考图矢量化，按阈值用 marching squares 提取轮廓、RDP 简化后生成 `LWPOLYLINE` 到 `TRACE` 图层，可调阈值 / 反色 / 简化 / 目标宽度，预览确认后一次插入；图片只在本机 Canvas 读取，不上传。
- 补充 P2 覆盖：`tests/aiVariants.test.ts`、`tests/imageTrace.test.ts`、`backend/tests/designConventions.test.ts`、`backend/tests/versionMemory.test.ts`、`tests/e2e/conventions.spec.ts`、`tests/e2e/trace.spec.ts`。
- 设计操作工具：新增 `align_elements` / `distribute_elements` / `dimension_chain` / `assign_layer` / `delete_elements`，纯几何实现集中在 `lib/designOps.ts`，沿用预览与单步撤销管线（[ADR 0014](docs/adr/0014-design-ops-plan-and-review.md)）。
- 计划模式：复杂请求先由只读工具确认现状，再通过 `propose_plan` 提交带工具与参数的计划；计划卡片支持改标题、调顺序、删步骤，确认后本地执行并只弹一次预览，不额外请求模型。
- 图纸检查面板：右侧导航新增「检查」，按错误 / 警告 / 提示列出确定性规则问题，支持筛选、选中并缩放定位、忽略与「让 AI 修复」；检查规则新增文字重叠与图层未整理提示。
- 补充计划模式与检查面板的单元 / 集成 / E2E 覆盖：`tests/aiPlan.test.ts`、`tests/e2e/review.spec.ts`，后端校验计划参数与 `planMode` 工具白名单；工具夹具扩展到 49 条、26 个工具。
- 技能 Playbook：`ai_skills` 新增执行步骤、完成检查、示例请求、所需设计上下文、反关键词与 `version`；promptComposer 按小标题注入，技能编辑器支持编辑全部字段并在更新后递增版本（[ADR 0013](docs/adr/0013-skill-playbook-design-context.md)）。
- 设计上下文包：brief / standard / deep 三档摘要，覆盖项目、单位、图层可见性与锁定、块引用、标注覆盖、隐藏对象、修订号与更多选中图元细节；由问题类型与图纸规模自动选档。
- 三个只读设计工具：`query_elements`、`measure_geometry`、`check_drawing` 在浏览器草稿上确定性执行，参数经服务端边界校验，结果按字符预算裁剪后回传模型。
- 技能编辑器的步骤 / 检查 / 示例 / 上下文信号字段与 Playbook 回填，新增 `tests/e2e/skills.spec.ts` 浏览器级覆盖。
- 20 条设计任务级离线评测（`backend/tests/designTaskEval.test.ts`），覆盖技能路由、工具白名单、草稿执行与 Playbook 注入；工具夹具扩展到 44 条、21 个工具。
- 结构化 JSON 日志与 `X-Request-Id` 请求链路追踪，敏感字段自动脱敏。
- `/api/metrics` 指标端点：请求量、错误率、P50/P95/P99 延迟、AI 失败率、SSE 中断率、同步积压。
- `/api/telemetry/events` 前端错误与同步状态批量上报。
- Playwright 6 条冒烟 E2E 与 CI job；`npm run docs:screenshots` 自动生成文档截图。
- AI Function Calling 工具集（11 个工具）与文本 JSON 降级路径，附带离线评测。
- 同步幂等键、服务端去重、最后写入胜冲突标记与用户提示。
- `docs/adr`、`docs/architecture`、`docs/guides`、`docs/reports` 文档分层与 `examples/` 示例。
- MIT License、CONTRIBUTING、PR / Issue 模板。
- 命令行注册表：命令别名、位置参数、`HELP`、`Tab` 补全、`↑↓` 历史与必填参数分步提示；新增命令不再修改 `App.tsx`。
- 画布工具拆分为独立状态机（`tools/*Tool.ts`），hook 只保留坐标转换、捕捉与事件分发。
- 版本历史：手动命名保存、每 20 次提交自动版本（60 秒失败退避）、版本预览与两版对比、恢复后可 Ctrl+Z 回退并立即持久化。
- 后端 `versions` 路由与 `elementCount` 元数据列，列表分页且详情按需加载。
- AI 变更预览弹窗：展示净变化、结果预览与计划动作，确认后整批只占一步撤销；`CLEAR` 与批量删除（≥5）需显式勾选确认。
- 全局 `ErrorBoundary`：渲染崩溃时提供重试、刷新与复制诊断信息，并上报组件栈遥测。
- AI 上下文摘要替代全量图元 JSON；`/api/llm/chat` 记录 prompt/completion token、上下文字符与延迟，新增 `ai.tokens.*`、`ai.context_chars` 指标，Provider 未返回 usage 时自动估算。
- 图框 / 打印：A4–A0 / Letter、横竖版、适配或固定比例、可配置边距与标题栏、单色输出，预览与打印共用同一矢量图纸；浏览器“另存为 PDF”即可输出矢量 PDF。
- AI 模型注册表与解析链：显式选择 → 会话绑定 → 助手模型 → 用户默认 → 系统默认 → 任一启用模型，逐级校验归属与 `supportsTools`；Provider 失败且未吐出内容时按候选顺序故障转移并发出 `model_fallback` 事件。
- CAD 工具集扩展到 18 个（新增 `draw_arc` / `draw_dimension` / `scale_elements` / `offset_elements` / `array_elements` / `get_canvas_info` / `zoom_to_selection`），前后端定义共用一份白名单。
- 助手配置真正生效：系统提示词注入 prompt、工具白名单收窄可用集合、`maxToolRounds` 限制工具轮次。
- 技能系统：内置种子技能（基础绘图 / 几何编辑 / 阵列与偏移 / 圆弧与曲线 / 标注与注释 / 布局规划 / 图纸审查）与用户自建技能同表存储，按显式固定 > 助手绑定 > 关键词 > 选择集类型 > 会话连续性打分路由，阈值以下不激活，单轮最多 3 个。
- AI Agent 工具循环运行在前端虚拟画布：模型每轮一次 HTTP 请求，浏览器在草稿元素数组上执行工具并回传 `toolResults`，整批结果只在 `AIPreviewModal` 预览一次、确认后一步撤销。
- 服务端持久化对话：`chat_sessions` / `chat_messages` 记录角色、工具调用、工具结果与 token；确定性 `clientMessageId` 保证续轮重放幂等，历史可完整回放工具参数与执行状态。
- 会话上下文压缩：超出字符预算时生成确定性 digest 写入 `contextSummary` 并记录水位线，不再逐条注入早期消息；新增 `ai.context_compacted`、`ai.context_dropped` 指标。
- `ai_call_logs` 调用台账与回合结果回写（`applied` / `discarded` + 原因），可统计 token 成本与被用户接受的 AI 方案比例。
- 右侧面板新增模型 / 助手 / 技能三个管理视图，与对话视图共用一份注册表状态；`/api/skills`、`/api/chat` 路由补齐。
- 极轴追踪：`lib/polar.ts` 以 45° 增量、10° 容差把光标吸附到极轴方向并绘制引导线，与正交互斥，状态栏「极轴」开关生效。
- 可编辑动态输入：绘制中可在光标旁键入长度 / 角度 / 宽高，`Tab` 切换字段、`Enter` 提交；`lib/dynamicInput.ts` 判定可键入阶段并把数值合成为终点。
- 预选高亮与捕捉标签：选择 / 复制 / 修剪工具下光标经过图元即变浅蓝（区别于选中黄色），捕捉类型以中文标签跟随光标与状态栏显示。
- 直线 / 矩形 / 圆支持「点击—移动—点击」两步绘制，单击保留锚点后也可直接键入数值提交。
- 画布内 AI 幽灵预览：`lib/aiGhost.ts` 把 AI 差分换算成「提议（紫色虚线）/ 将移除（红色虚线）」叠加到真实图纸，预览弹窗可收起为底部工具条，在图纸上下文中核对落点后再应用。
- AI 落图后脉冲高亮：受影响图元以 1.2s 动画指出改动位置，`prefers-reduced-motion` 下自动关闭；通知条同步给出「已应用 AI 变更 · N 个图元 · Ctrl+Z 可撤销」。
- 选中集迷你工具栏：选框上方浮出移动 / 复制 / 旋转 / 缩放 / 镜像 / 偏移 / 阵列 / 删除 / 问 AI，工具按钮复用左侧工具栏的工具态；「问 AI」把选择集摘要写成对话草稿并聚焦输入框。
- 键盘效率体系：`F3` / `F7` / `F8` / `F10` 直接切换捕捉 / 栅格 / 正交 / 极轴并提示开关结果；命令行留空按 `Enter` 重复上一条命令。
- 隔离与选择同类：`ISOLATE` / `HIDEOBJECTS` / `SHOWALL` / `SELECTSIMILAR` 基于独立的临时隐藏集（`lib/isolation.ts`），被隐藏的图元不渲染、不参与捕捉与框选，但不改图层可见性也不占用撤销步骤；状态栏「已隐藏 N」点击即恢复。
- 视图命令与命名视图：视口抽为瞬态外部 store（`store/viewport.ts`），缩放 / 平移不进撤销历史也不标记图纸已修改；新增 `ZOOM E|S|W` 与 `VIEW SAVE|RESTORE|LIST`，命名视图按图纸存于浏览器本地。
- 快速选择：新增 `QSELECT` 命令与 `lib/quickSelect.ts`，按类型 / 图层 / 颜色三维过滤（维度间取交集、维度内取并集），过滤面板实时预览命中数量，确认后写入选择集。
- 迷你导航图：画布右下角常驻小地图（`components/MiniMap.tsx` + `lib/minimap.ts`），缩略显示全部可显示图元并叠加视口矩形，点击或拖拽即移动视口；只读视口，不占撤销步骤。
- AI 视图工具 `zoom_to_selection`：只移动视口、不改图纸，因此不进预览、不占撤销步骤（例外规则见 [ADR 0011](docs/adr/0011-ai-view-tools-bypass-preview.md)）。
- 点击循环选择：图元重叠时在同一位置 300ms 内重复点击可在命中列表中依次切换（后绘制者优先）；多选状态下点击成员仍保留整个选择集以便整体拖动。
- 工具栏分组：左侧工具条按 导航 / 绘图 / 修改 常驻高频工具，低频工具收进「更多工具」溢出菜单并按 绘图 / 修改 / 标注 / 参数化 分组展示。
- 实验性实时协作：状态栏「协作 实验」开关接入 Socket.IO 项目房间，广播图元差集与远端光标，全员可写、最后写入胜；远端补丁不占本地撤销步骤（[ADR 0012](docs/adr/0012-experimental-collaboration.md)）。
- 渲染器抽象：新增 `renderer/types.ts` 的 `Renderer` 接口与 `renderer/svgRenderer.ts`，坐标换算、命中测试与视口缓冲从组件中剥离，为后续 Canvas 2D 评估保留替换点。
- 拖拽与平移按 `requestAnimationFrame` 合并更新（`lib/frameCoalescer.ts`），高频 mousemove 不再逐次重渲染画布。
- 2000 元素渲染基准（`tests/performance.test.ts`）：记录索引构建、首帧静态渲染与连续平移帧预算，阈值按 50 FPS 设定。
- 欢迎页新增「三步上手」与内置示例图纸（齿轮 / 弹簧 / 建筑平面），示例 DXF 由 `node scripts/generate-examples.mjs` 生成。
- README 顶部新增「90 秒跑起来」代码块，与 `start.sh` 的实际命令一致；新增 30 秒演示 GIF（`npm run docs:gif`）。
- 后端新增 `/ready` 数据库就绪探针；前端遥测事件携带构建版本号、会话 ID 与最近 20 条操作序列。

### Security

- 前端构建不再把 `GEMINI_API_KEY` 内联进公开 bundle（`vite.config.ts` 的 `define` 与 `Dockerfile` 的 `ARG/ENV` 一并移除）：产物是公网静态资源，任何构建期注入的密钥都能被直接读出；AI 密钥只保留在服务端 `.env`，由后端代理调用 Provider。
- 认证写操作与 `/api/llm/chat` 增加进程内限流（默认 20 次 / 15 分钟、30 次 / 分钟），返回 `429`、`Retry-After` 与 `RateLimit-*` 头；只读的 `GET /api/auth/me` 不计数。
- `/api/llm/chat` 增加请求体 schema 校验，非法参数在触达数据库与 Provider 前返回 400。
- `/api/llm/chat` 校验扩展到完整 Agent 回合契约：`phase` 枚举、`round` 上界、`pinnedSkillCodes` ≤5、`canvasContext` 与 `toolResults` 条数与字段长度上限；`/api/chat/*` 会话读写新增独立限流（默认 120 次 / 5 分钟，`CHAT_RATE_LIMIT_MAX/WINDOW_MS`）。
- 模型 `baseUrl` 增加 SSRF 校验（协议、私网/回环与 https 要求），内网可信端点需显式配置 `AI_ALLOWED_ENDPOINTS`；LLM 凭据响应只返回 `hasApiKey` 与脱敏预览，`apiKeyEncrypted` 统一剔除。
- helmet 显式配置严格 CSP、一年期 HSTS、`X-Frame-Options: DENY` 与 `Referrer-Policy: no-referrer`，关闭 `X-Powered-By`。
- 生产环境缺少 `JWT_SECRET` 时启动失败；认证路由改用结构化日志。
- CI 新增前后端 `npm audit --omit=dev --audit-level=high`；升级 lockfile 修复生产依赖中的 critical/high 漏洞。
- Socket.IO 握手校验 JWT，加入房间前校验项目归属；所有广播要求发送方已加入对应项目房间，补丁与光标载荷做条数与形状校验，堵住跨项目广播与超大包。

### Changed

- 右侧面板默认收起，导航按钮（检查 / 约定 / 图纸 / 设置 / 账号）迁到左侧工具栏；左侧改为「工具列 + 面板列」双列，竖向放不下的按钮按分组收进「更多」菜单。
- AI 助手贴右时改为工作区的右列（flex 兄弟节点），与画布左右分开，不再浮在工作区上层；浮窗模式仍可随时切换。
- 图纸（文件夹）管理从右侧面板抽出为独立弹窗，把画布面积完整让给绘图操作。
- 中英切换从页头移到设置面板。
- `deploy.sh` 从本地交互式菜单改为服务器侧非交互脚本（构建 → 等库就绪 → 迁移 → 自检，任一环节失败即非零退出）；本地临时栈继续用 `docker-compose.yml`（`localhost:3220`），生产用 `docker-compose.prod.yml`。`docs/guides/DOCKER_UPDATE_GUIDE.md` 的过期端口 3400/3410/5435 与 `docker-compose` 命令统一为 3220/3225/5432 与 `docker compose`。
- 命令行输入控制器抽离为 `hooks/useCommandInput.ts`，历史持久化至 localStorage。
- 画布提示统一到状态栏：删除画布顶部 8 处英文提示，`lib/toolHints.ts` 按工具与已取点阶段输出「工具 · 下一步」。
- 交互界面文案中文化（工具栏、状态栏、AI 变更预览、绘图设置的捕捉项），捕捉类型标签由 `lib/snapping.ts` 单点提供。
- 工具栏按钮增加 `data-tool` 标识，E2E 选择器不再依赖可见文案。
- AI 预览确认改为按差分增量落图，预览期间的手动作图不会被整表覆盖丢弃；仍是确认后一次 `commitAction`、一步撤销。
- `Delete` 键与迷你工具栏共用 `requestDeleteSelection`：≥5 个图元仍要求显式确认，删除后立即给出可撤销提示。
- 图元可显示判定收敛到 `lib/isolation.ts`：画布命中测试、框选与 `SELECTALL` 使用同一套「隐藏图层 + 临时隐藏集」规则，不再各写一份过滤。
- 技能路由改为「先判意图、再放大信号」：选择集类型与设计上下文只在关键词/固定/绑定/连续性命中时加分，避免仅选中图元就激活编辑与阵列技能；审查技能激活时本轮只下发只读工具。
- 对话作用域改用稳定的项目标识（`chatKey`）：本地项目 id 被服务端 id 替换后不再把刚发生的本地回合刷掉。
- 同步队列不再丢弃进行中的保存请求：上一轮 flush 未结束时到达的请求会在结束后补跑一轮，项目元数据（如设计约定）不再滞留本地。

### Removed

- 删除无引用的 `services/geminiService.ts` 与 `RightPanel` 中的死导入。

## [0.1.0] - 2026-10-21

### Added

- 基础 2D CAD 编辑器：直线、多段线、圆、圆弧、矩形、文字。
- 编辑工具：选择、移动、复制、修剪、镜像、旋转、缩放、偏移、矩形阵列。
- 尺寸标注、距离测量与 11 种 HATCH 填充图案。
- 参数化图形：齿轮、渐开线、螺旋、弹簧、正多边形、椭圆。
- 曲线生成与校验：正弦 / 余弦、对数螺旋、贝塞尔、圆弧。
- DXF 导入导出（LINE / CIRCLE / ARC / LWPOLYLINE / TEXT）。
- Blocks 块系统：定义、引用、嵌套、变换、分类树与循环引用检测。
- AI 对话绘图：多 Provider（OpenAI / Anthropic / Google / Ollama）SSE 流式输出。
- 用户注册登录、JWT 鉴权、项目隔离、LLM API Key AES-256-GCM 加密存储。
- IndexedDB 离线优先存储与 PostgreSQL 同步队列。
- 图层管理、属性检查器、命令行、夹点编辑、对象捕捉。
- 撤销 / 重做（命令模式，支持快照回退开关）。
- 视口裁剪、空间索引与元素级 memo 渲染。
- 前端 / 后端单元测试、CI（lint / typecheck / test / build）。

### Changed

- 选择集从图元字段迁移为独立瞬态状态 `selectedIds`。
- 画布交互逻辑拆分到 `hooks/useCanvasInteraction.ts`，渲染与预览分离。
- 前后端类型统一以根目录 `types.ts` 为准。

### Fixed

- 曲线生成器对点数与连续性的校验，正弦波异常自动修正。
- 保存与撤销粒度：连续属性输入合并为一次历史记录。
- 同步重试可能重复创建项目 / 元素的问题。

[Unreleased]: https://github.com/aiignite/AIIgniteCAD/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aiignite/AIIgniteCAD/releases/tag/v0.1.0
