/**
 * builtinSkills.ts — 内置技能种子
 *
 * 技能 = 提示词片段 + 可执行步骤 + 完成检查 + 允许的工具子集 + 触发信号。
 * 系统技能 isSystem=true、userId=null，由 skillService 幂等 upsert，
 * 用户可在技能面板克隆后修改。
 */

import type { SkillContextSignal, SkillStep } from "./skillPlaybook";

export interface BuiltinSkillSeed {
  code: string;
  name: string;
  description: string;
  category: string;
  promptTemplate: string;
  toolNames: string[];
  keywords: string[];
  negativeKeywords: string[];
  selectionTypes: string[];
  requiredContext: SkillContextSignal[];
  steps: SkillStep[];
  checks: string[];
  examples: string[];
  priority: number;
}

const DRAW_TOOLS = [
  "draw_line",
  "draw_polyline",
  "draw_rectangle",
  "draw_circle",
  "draw_text",
  "draw_arc",
  "get_canvas_info",
  "query_elements",
  "measure_geometry",
];

const EDIT_TOOLS = [
  "move_elements",
  "rotate_elements",
  "copy_elements",
  "mirror_elements",
  "delete_last",
  "align_elements",
  "distribute_elements",
  "assign_layer",
  "delete_elements",
  "get_canvas_info",
  "query_elements",
  "measure_geometry",
];

export const BUILTIN_SKILLS: BuiltinSkillSeed[] = [
  {
    code: "cad_drafting_basic",
    name: "基础绘图",
    description: "绘制线、圆、矩形、多段线、文字等基本图元。",
    promptTemplate: `你正在执行基础绘图任务。
- 坐标使用画布世界坐标，X 向右增大、Y 向下增大，单位与图纸一致。
- 一次需要多个图元时，在同一轮里连续调用多个 draw_* 工具。
- 尺寸不明确时先按合理默认绘制，并在回复中说明假设，不要反问。
- 绘制完成后调用 get_canvas_info 自检数量与包围盒是否符合用户要求。`,
    category: "Drafting",
    priority: 10,
    toolNames: DRAW_TOOLS,
    keywords: [
      "画", "绘制", "生成", "创建", "线条", "直线", "圆", "圆形", "矩形", "方形",
      "多段线", "文字", "标注文字", "draw", "line", "circle", "rectangle", "text",
    ],
    negativeKeywords: ["删除所有", "清空图纸"],
    selectionTypes: [],
    requiredContext: [],
    steps: [
      { title: "确认基准与尺寸", detail: "从上下文或查询结果确认原点、单位和已存在图形的位置。" },
      { title: "一次给全独立图元", detail: "同一轮连续调用多个 draw_*，减少往返。", tool: "draw_line" },
      { title: "自检结果", detail: "用 get_canvas_info 核对数量与包围盒。", tool: "get_canvas_info" },
    ],
    checks: ["图元数量与用户要求一致", "包围盒落在合理坐标范围内", "回复说明采用的默认尺寸"],
    examples: ["在原点画一个 100×60 的矩形", "画三个同心圆，半径分别是 30、50、80"],
  },
  {
    code: "cad_geometry_edit",
    name: "几何编辑",
    description: "移动、旋转、复制、镜像与删除已有图元。",
    promptTemplate: `你正在执行几何编辑任务。
- 编辑工具必须指明对象：优先使用用户点选的 id（见上下文 selectedIds），或先用 query_elements 查找。
- 只有在用户明确要求“全部/所有/清空”时才使用 clear_canvas。
- 旋转与缩放角度按度给出，正角在屏幕上是顺时针。
- 对齐与等距分布用 align_elements / distribute_elements，不要逐个移动心算。
- 操作后用 measure_geometry 或 get_canvas_info 确认结果，不要凭空描述。`,
    category: "Editing",
    priority: 20,
    toolNames: EDIT_TOOLS,
    keywords: [
      "移动", "平移", "旋转", "复制", "镜像", "删除", "去掉", "移走", "move",
      "rotate", "copy", "mirror", "delete",
    ],
    negativeKeywords: ["清空", "全部删除"],
    selectionTypes: ["LINE", "CIRCLE", "RECTANGLE", "LWPOLYLINE", "ARC", "TEXT"],
    requiredContext: ["selection"],
    steps: [
      { title: "确定作用对象", detail: "优先用 selectedIds；为空时用 query_elements 查找。", tool: "query_elements" },
      { title: "执行变换", detail: "一次调用完成同类变换，避免逐个图元重复操作。" },
      { title: "复核位置", detail: "用 measure_geometry 或 get_canvas_info 确认位移与数量。", tool: "measure_geometry" },
    ],
    checks: ["只修改了目标图元", "变换后的坐标与用户要求一致", "未误删未选中的图元"],
    examples: ["把选中的矩形向右移动 50", "复制当前选择，间距 100，排成 4 个"],
  },
  {
    code: "cad_array_offset",
    name: "阵列与偏移",
    description: "矩形阵列、等距偏移与整体缩放。",
    promptTemplate: `你正在执行阵列/偏移/缩放任务。
- 阵列要给出 rows、columns、rowSpacing、columnSpacing；间距按用户给定的尺寸填写。
- 偏移 distance 为负表示另一侧，只复制不修改原图元。
- 缩放 factor 是比例而非倍数结果，2 表示放大一倍。
- 若用户只说“排成一排 N 个”，使用 rows=1、columns=N。`,
    category: "Editing",
    priority: 30,
    toolNames: [
      "array_elements",
      "offset_elements",
      "scale_elements",
      "get_canvas_info",
      "query_elements",
      "measure_geometry",
    ],
    keywords: [
      "阵列", "矩阵", "排布", "排列", "偏移", "等距", "间距", "缩放", "放大",
      "缩小", "array", "offset", "scale",
    ],
    negativeKeywords: ["随机"],
    selectionTypes: ["LINE", "CIRCLE", "RECTANGLE", "LWPOLYLINE", "ARC"],
    requiredContext: ["selection"],
    steps: [
      { title: "确定原对象与方向", detail: "确认复制/偏移的基准与正方向。" },
      { title: "一次完成阵列", detail: "排成一行用 rows=1、columns=N。", tool: "array_elements" },
      { title: "核对总尺寸", detail: "用 measure_geometry 检查整体包围盒是否等于预期。", tool: "measure_geometry" },
    ],
    checks: ["副本数量 = rows × columns", "间距与用户给定值一致", "原图元未被意外移动"],
    examples: ["把这根线向右阵列 5 个，间距 40", "把选中的圆向外偏移 10"],
  },
  {
    code: "cad_curve_arc",
    name: "圆弧与曲线",
    description: "圆弧、圆角、切线与曲线轮廓。",
    promptTemplate: `你正在绘制圆弧与曲线。
- 圆弧用圆心 + 半径 + 起止角（度，从 +X 轴起算，屏幕上顺时针为正）。
- 需要连续折线近似曲线时使用 draw_polyline，点数控制在 200 以内。
- 半径、直径不要与用户给的数值互相换算出错：直径 = 2 × 半径。`,
    category: "Drafting",
    priority: 25,
    toolNames: ["draw_arc", "draw_circle", "draw_polyline", "draw_line", "get_canvas_info"],
    keywords: ["圆弧", "弧", "半径", "直径", "切线", "曲线", "圆角", "扇形", "arc", "curve", "fillet"],
    negativeKeywords: [],
    selectionTypes: ["ARC", "CIRCLE"],
    requiredContext: [],
    steps: [
      { title: "确定圆心与半径", detail: "直径 = 2 × 半径，角度从 +X 轴起算。" },
      { title: "绘制曲线", detail: "连续折线用 draw_polyline，点数不超过 200。", tool: "draw_polyline" },
    ],
    checks: ["圆弧起止角方向正确", "半径与用户数值一致", "曲线点数在限制内"],
    examples: ["画一个半径 80、从 0° 到 180° 的半圆", "用多段线画一段正弦曲线"],
  },
  {
    code: "cad_dimensioning",
    name: "标注与注释",
    description: "线性尺寸标注与文字说明。",
    promptTemplate: `你正在添加标注与注释。
- 先用 measure_geometry 读取被测两点的真实坐标，不要把标注文字位置当作测量点。
- 连续尺寸用 dimension_chain，一次给全有序测点。
- 文字内容简洁，避免重复图中已有信息。
- 用户没给单位时沿用上下文中报告的单位，并在回复里写明。`,
    category: "Annotation",
    priority: 40,
    toolNames: [
      "draw_dimension",
      "dimension_chain",
      "draw_text",
      "get_canvas_info",
      "query_elements",
      "measure_geometry",
    ],
    keywords: ["标注", "尺寸", "标签", "说明", "文字标注", "标出", "dimension", "label", "annotate"],
    negativeKeywords: [],
    selectionTypes: ["DIMENSION", "TEXT"],
    requiredContext: ["selection", "dimensions"],
    steps: [
      { title: "读取被测点的真实坐标", detail: "不要把标注文字位置当作测量点。", tool: "measure_geometry" },
      { title: "添加标注", detail: "多段尺寸逐段调用 draw_dimension。", tool: "draw_dimension" },
    ],
    checks: ["标注值与实际距离一致", "文字不重复图中已有信息", "单位与图纸设置一致"],
    examples: ["给这条线的两端加尺寸标注", "标出矩形的宽和高"],
  },
  {
    code: "cad_layout_planning",
    name: "布局规划",
    description: "房间、工位、设备分区等平面布局。",
    promptTemplate: `你正在做平面布局。
- 先规划总体尺寸与分区边界，再绘制墙体轮廓，最后补门洞与标注。
- 墙厚、门宽等未指定时使用常见值（墙 200、门 900）并在回复中说明。
- 相邻空间共享边界，不要画出重叠或缝隙。
- 布局完成后用 check_drawing 检查闭合与标注，再用 measure_geometry 核对总尺寸。`,
    category: "Layout",
    priority: 50,
    toolNames: [
      ...DRAW_TOOLS.filter((name) => name !== "draw_text"),
      "draw_dimension",
      "move_elements",
      "copy_elements",
      "array_elements",
      "align_elements",
      "distribute_elements",
      "delete_elements",
      "check_drawing",
    ],
    keywords: [
      "房间", "户型", "平面", "布局", "工位", "间距", "动线", "分区", "车间",
      "产线", "设备", "走道", "门", "window", "layout", "floor",
    ],
    negativeKeywords: ["三维", "3d"],
    selectionTypes: [],
    requiredContext: ["layers"],
    steps: [
      { title: "规划总体尺寸", detail: "先确定外轮廓与分区边界，再细化内部。" },
      { title: "绘制墙体与分区", detail: "相邻空间共享边界，避免重叠或缝隙。", tool: "draw_rectangle" },
      { title: "补门窗与标注", detail: "未指定时用墙 200、门 900 等常见值并说明。", tool: "draw_dimension" },
      { title: "检查闭合与标注", detail: "用 check_drawing 复核开放轮廓和缺失标注。", tool: "check_drawing" },
    ],
    checks: ["分区面积之和不超过外轮廓", "墙体边界无重叠或缝隙", "主要尺寸已标注"],
    examples: ["画一个 8×6 米的两室户型并标注", "把这个车间分成 4 个工位，留 1.2 米走道"],
  },
  {
    code: "cad_block_library",
    name: "块库与复用",
    description: "把选中图形保存为块，并按名称把块插入图纸。",
    promptTemplate: `你正在处理可复用图块。
- 用户说“把选中的图形保存为块 / 加入块库”时，调用 save_selection_as_block，name 必须使用用户给出的名称；用户没给名称时先询问，不要自行编造。
- 用户说“插入 / 放置 / 放一个 <名称> 块”时，优先调用 insert_block_by_name；名称有歧义时先用 list_blocks 查询，再用精确名称或 insert_block。
- 插入点未指定时，选择靠近相关图形或图纸空白处的合理位置，并在回复中说明插入点。
- 保存块不改变画布；插入块会进入预览并只占一步撤销。`,
    category: "Blocks",
    priority: 35,
    toolNames: [
      "list_blocks",
      "insert_block",
      "insert_block_by_name",
      "save_selection_as_block",
      "query_elements",
      "get_canvas_info",
    ],
    keywords: [
      "块", "图块", "块库", "符号", "标准件", "复用", "插入块", "放置块", "保存为块",
      "做成块", "block", "symbol", "library",
    ],
    negativeKeywords: ["块参照", "外部参照"],
    selectionTypes: [],
    requiredContext: [],
    steps: [
      { title: "确认块名称与对象", detail: "保存块必须有名称；插入块按用户给出的名称检索。", tool: "list_blocks" },
      { title: "插入或保存", detail: "插入用 insert_block_by_name，保存用 save_selection_as_block。", tool: "insert_block_by_name" },
      { title: "复核结果", detail: "插入后确认图元数量与位置；保存后提示块已进入块库。", tool: "get_canvas_info" },
    ],
    checks: ["块名称与用户要求一致", "插入点合理且图元完整", "保存块没有改动画布"],
    examples: ["把选中的图形保存为块，名字叫法兰", "在右下角插入一个门块"],
  },
  {
    code: "cad_versioning",
    name: "版本存档",
    description: "把当前图纸保存为一个命名版本或快照。",
    promptTemplate: `你正在处理版本存档。
- 用户要求“保存版本 / 存一个版本 / 存档 / 记快照”时，调用 save_version，message 使用用户描述；没有描述时写一句简洁的变更摘要。
- 保存版本不改变画布，也不占撤销步骤。
- 用户只是说“保存文件”时，提示使用顶部保存按钮，不要调用 save_version。
- 保存前不要为了“让版本更完整”而擅自修改图形。`,
    category: "Versioning",
    priority: 45,
    toolNames: ["save_version", "get_canvas_info"],
    keywords: [
      "保存版本", "存版本", "版本", "快照", "存档", "记一个版本", "version", "snapshot", "archive",
    ],
    negativeKeywords: ["恢复版本", "回滚", "对比版本"],
    selectionTypes: [],
    requiredContext: [],
    steps: [
      { title: "确认版本说明", detail: "从用户指令提取简短说明；没有则使用当前变更摘要。" },
      { title: "保存版本", detail: "调用 save_version，等待服务端返回版本号。", tool: "save_version" },
    ],
    checks: ["版本说明与用户要求一致", "没有改动图形", "回复中报告版本号"],
    examples: ["给当前图纸存一个版本，说明写“增加安装孔”", "保存当前版本"],
  },
  {
    code: "cad_plot_review",
    name: "图纸审查",
    description: "只读检查图纸，输出问题清单而不修改图形。",
    promptTemplate: `你正在审查图纸，本轮是只读模式。
- 先调用 check_drawing 获取确定性问题清单，再用 query_elements / measure_geometry 核实细节。
- 不要绘制或修改任何图元。
- 输出结构化问题清单：位置/图元、问题、建议改法，按严重程度排序。
- 如果信息不足以判断，明确说明缺少什么，不要臆测。`,
    category: "Review",
    priority: 60,
    toolNames: [
      "get_canvas_info",
      "query_elements",
      "measure_geometry",
      "check_drawing",
    ],
    keywords: [
      "检查", "审查", "评审", "优化", "问题", "规范", "对不对", "有没有", "review",
      "check", "audit",
    ],
    negativeKeywords: ["直接修复", "修复", "画一个", "移动", "删除", "修改", "调整"],
    selectionTypes: [],
    requiredContext: ["revision"],
    steps: [
      { title: "运行确定性检查", detail: "先调用 check_drawing 获取问题清单。", tool: "check_drawing" },
      { title: "按需补充查询", detail: "用 query_elements / measure_geometry 核实具体图元。", tool: "query_elements" },
      { title: "输出分级问题", detail: "按 error / warning / info 排序，给出定位与建议。" },
    ],
    checks: ["只读，不修改任何图元", "每条问题附图元 id 或位置", "说明哪些结论需要人工确认"],
    examples: ["检查这张图有没有未闭合的轮廓", "看看图里缺哪些标注"],
  },
];
