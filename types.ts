export enum ToolType {
    SELECT = "SELECT",
    PAN = "PAN",
    LINE = "LINE",
    CIRCLE = "CIRCLE",
    RECTANGLE = "RECTANGLE",
    TEXT = "TEXT",
    POLYLINE = "POLYLINE",
    ARC = "ARC",
    HATCH = "HATCH",
    COPY = "COPY",
    TRIM = "TRIM",
    MIRROR = "MIRROR",
    ROTATE = "ROTATE",
    SCALE = "SCALE",
    OFFSET = "OFFSET",
    ARRAY = "ARRAY",
    DIMENSION = "DIMENSION",
    MEASURE = "MEASURE",
    // Advanced shapes
    GEAR = "GEAR",
    INVOLUTE = "INVOLUTE",
    SPIRAL = "SPIRAL",
    SPRING = "SPRING",
    POLYGON = "POLYGON",
    ELLIPSE = "ELLIPSE",
}

export enum SidePanelMode {
    REVIEW = "REVIEW",
    CONVENTIONS = "CONVENTIONS",
    SETTINGS = "SETTINGS",
    USER_INFO = "USER_INFO",
}

export type UnitType = "mm" | "cm" | "m" | "in" | "ft";

export interface DrawingSettings {
    units: UnitType;
    gridSpacing: number; // The visual grid spacing
    snapDistance: number; // 对象捕捉孔径（屏幕像素），按当前缩放换算为世界单位
    dimScale: number; // Global scale factor for dimension text/arrows
    dimPrecision: number; // Decimal places (0-8)
    /** 已启用的捕捉类型；未设置时按 DEFAULT_SNAP_TYPES 处理（兼容旧存档） */
    enabledSnapTypes?: SnapType[];
}

export interface Point {
    x: number;
    y: number;
}

export interface CADElement {
    id: string;
    type:
        | "LINE"
        | "CIRCLE"
        | "RECTANGLE"
        | "LWPOLYLINE"
        | "TEXT"
        | "DIMENSION"
        | "ARC"
        | "BLOCK_REFERENCE"
        | "ELLIPSE"
        | "GEAR"
        | "SPIRAL"
        | "SPRING"
        | "HATCH";
    layer: string;
    color: string; // Hex or AutoCAD color index
    // Geometry properties
    start?: Point;
    end?: Point; // For Line, Dimension
    center?: Point; // For Circle, Arc, Ellipse, Gear
    radius?: number; // For Circle, Arc
    width?: number; // For Rect
    height?: number; // For Rect
    points?: Point[]; // For Polyline, Spiral, Spring
    /** LWPOLYLINE 是否闭合（DXF 70 标志） */
    closed?: boolean;
    text?: string; // For Text
    fontSize?: number; // For Text
    // Dimension specific
    offsetPoint?: Point; // The third point determining height of dimension
    // Arc specific
    startAngle?: number;
    endAngle?: number;
    clockwise?: boolean; // Direction of the arc
    // Block reference specific
    blockReferenceId?: string; // Reference to BlockReference
    /** 组合 id：同一 groupId 的图元视为一个对象，可整体移动与解散 */
    groupId?: string;
    // Ellipse specific
    radiusX?: number;
    radiusY?: number;
    rotation?: number; // Rotation angle in degrees
    // Gear specific
    numTeeth?: number; // Number of teeth
    module?: number; // Module (size of teeth)
    pressureAngle?: number; // Pressure angle in degrees (typically 20)
    addendum?: number; // Tooth height above pitch circle
    dedendum?: number; // Tooth depth below pitch circle
    // Spiral specific
    turns?: number; // Number of turns
    radiusIncrement?: number; // How much radius increases per turn
    // Spring specific
    coils?: number; // Number of coils
    wireRadius?: number; // Radius of the wire
    springRadius?: number; // Radius of the spring coil
    // Hatch specific
    hatchPattern?: HatchPattern; // Pattern configuration
    hatchAngle?: number; // Pattern rotation angle in degrees
    hatchScale?: number; // Pattern scale factor
    hatchColor?: string; // Hatch line color
}

// Hatch pattern types
export type HatchPatternType =
    | "SOLID" // Solid fill
    | "HORIZONTAL" // Horizontal lines
    | "VERTICAL" // Vertical lines
    | "DIAGONAL_RIGHT" // Diagonal lines (\)
    | "DIAGONAL_LEFT" // Diagonal lines (/)
    | "CROSS" // Cross hatch (+)
    | "GRID" // Grid pattern (#)
    | "DOT" // Dot pattern
    | "ANSI31" // Standard ANSI 45° lines
    | "ANSI32" // Standard ANSI horizontal/vertical
    | "ISO02W100"; // ISO wide line

export interface HatchPattern {
    type: HatchPatternType;
    spacing?: number; // Line spacing for pattern fills
    angle?: number; // Pattern angle in degrees (for custom patterns)
}

export interface BlockCategory {
    id: string;
    name: string;
    parentId?: string;
    projectId?: string;
    userId: string;
    children?: BlockCategory[];
    blocks?: BlockDefinition[];
    createdAt: string;
    updatedAt: string;
}

// 块定义 - 定义一个可重用的图形单元
export interface BlockDefinition {
    id: string;
    name: string;
    description?: string;
    basePoint: Point; // 块的基准点（插入点）
    elements: CADElement[]; // 组成块的图形元素
    thumbnail?: string; // Base64 thumbnail
    isPublic?: boolean; // 是否公开共享
    userId?: string; // 创建者ID
    projectId?: string; // 项目特定块（如果为空则为全局块）
    categoryId?: string;
    createdAt: string;
    updatedAt: string;
}

// 块引用 - 在图纸中插入的块实例
export interface BlockReference {
    id: string;
    blockDefinitionId: string;
    blockDefinition?: BlockDefinition; // 可选的块定义引用（用于渲染）
    layer: string;
    insertionPoint: Point; // 插入位置
    rotation: number; // 旋转角度（度）
    scaleX: number; // X方向缩放
    scaleY: number; // Y方向缩放
    properties?: Record<string, any>; // 可覆盖的属性
    color?: string; // 可覆盖块的颜色
}

// 图层定义
export interface Layer {
    id: string;
    name: string;
    color: string;
    isVisible: boolean;
    isLocked: boolean;
    lineType: "CONTINUOUS" | "DASHED" | "DOTTED" | "DASHDOT";
    lineWeight?: number; // 线宽
}

// 变换矩阵
export interface Transform {
    translation: Point;
    rotation: number; // 角度
    scale: Point; // {x: scaleX, y: scaleY}
}

// 选择集
export interface SelectionSet {
    elements: CADElement[];
    blockReferences: BlockReference[];
}

// 捕捉点类型
export enum SnapType {
    ENDPOINT = "ENDPOINT",
    MIDPOINT = "MIDPOINT",
    CENTER = "CENTER",
    QUADRANT = "QUADRANT",
    INTERSECTION = "INTERSECTION",
    PERPENDICULAR = "PERPENDICULAR",
    TANGENT = "TANGENT",
    NEAREST = "NEAREST",
    GRID = "GRID",
    NONE = "NONE",
}

/**
 * 默认启用的捕捉类型。
 * NEAREST 默认关闭：它会把光标吸附到图元任意位置，容易在绘制时产生非预期端点。
 */
export const DEFAULT_SNAP_TYPES: SnapType[] = [
    SnapType.ENDPOINT,
    SnapType.MIDPOINT,
    SnapType.CENTER,
    SnapType.QUADRANT,
    SnapType.INTERSECTION,
    SnapType.PERPENDICULAR,
    SnapType.TANGENT,
];

// 捕捉点信息
export interface SnapPoint {
    point: Point;
    type: SnapType;
    elementId?: string;
}

/** 画布拖拽/多步交互的状态机模式 */
export type DragMode =
    | "DRAW"
    | "PAN"
    | "SELECT_BOX"
    | "MOVE_ITEMS"
    | "COPY_ITEMS"
    | "MIRROR_LINE"
    | "MEASURE"
    | "DIMENSION_HEIGHT"
    | "POLYLINE_ADD"
    | "ARC_POINT"
    | "ROTATE_ITEMS"
    | "SCALE_ITEMS"
    | "GRIP_EDIT";

export interface DesignLayerRule {
    name: string;
    purpose?: string;
}

/** 项目级设计约定：随 Project 存储并注入 AI 提示词 */
export interface DesignConventions {
    standard: string;
    units: UnitType;
    textHeight: number;
    dimensionPrecision: number;
    layerRules: DesignLayerRule[];
    notes: string[];
}

export interface ProjectFile {
    id: string;
    name: string;
    description?: string;
    lastModified: string;
    lastOpened?: string;
    elements?: CADElement[];
    blockReferences?: BlockReference[]; // 块引用
    blockDefinitions?: BlockDefinition[]; // 项目中的块定义
    layers?: Layer[]; // 图层
    thumbnail?: string;
    userId?: string;
    isDeleted?: boolean;
    elementCount?: number;
    designConventions?: DesignConventions | null;
    /** 离线创建后服务端 id 回填时保持不变，用于识别"同一张图纸" */
    chatKey?: string;
}

export interface VersionChangeSummary {
    added: number;
    removed: number;
    /** 同一图元被修改的数量；旧版本摘要没有该字段 */
    modified?: number;
    addedByType: Record<string, number>;
    removedByType: Record<string, number>;
    modifiedByType?: Record<string, number>;
    layersTouched: string[];
}

// 项目版本/历史快照
export interface ProjectVersion {
    id: string;
    projectId: string;
    versionNumber: number;
    snapshotData: {
        elements: CADElement[];
        blockReferences?: BlockReference[];
        layers?: Layer[];
        settings?: DrawingSettings;
    };
    elementCount?: number;
    commitMessage?: string;
    changeSummary?: VersionChangeSummary | null;
    createdBy?: string;
    createdAt: string;
}

// 版本列表项（不含完整快照）
export interface ProjectVersionSummary {
    id: string;
    projectId: string;
    versionNumber: number;
    elementCount: number;
    commitMessage?: string;
    changeSummary?: VersionChangeSummary | null;
    createdBy?: string;
    createdAt: string;
}

// 同步队列项（用于IndexedDB离线同步）
export interface SyncQueueItem {
    id: string;
    idempotencyKey: string;
    operation: "CREATE" | "UPDATE" | "DELETE";
    entityType: "PROJECT" | "ELEMENT" | "BLOCK_DEFINITION" | "BLOCK_REFERENCE" | "LAYER";
    entityId: string;
    data: any;
    timestamp: string;
    status: "PENDING" | "SYNCED" | "FAILED";
    baseUpdatedAt?: string;
    retryCount?: number;
    error?: string;
}

// 用户信息
export interface User {
    id: string;
    username: string;
    email: string;
    createdAt: string;
    updatedAt: string;
}

export interface Assistant {
    id: string;
    name: string;
    icon: string;
    description: string;
    color: string;
    category?: string;
    prompt?: string | null;
    isActive?: boolean;
    isPublic?: boolean;
    llmModelId?: string | null;
    /** 会话级覆盖：助手未绑定模型时使用 */
    temperature?: number | null;
    maxTokens?: number | null;
    /** 单次提问允许的工具轮次上限 */
    maxToolRounds?: number;
    /** null / undefined 表示不限制工具 */
    toolNames?: string[] | null;
    skills?: AssistantSkillBinding[];
    skillIds?: string[];
    llmModel?: LLMModel | null;
    userId?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

/** 助手与技能的绑定行，weight 决定技能打分加成 */
export interface AssistantSkillBinding {
    assistantId: string;
    skillId: string;
    weight: number;
    createdAt?: string;
}

export interface AiSkill {
    id: string;
    code: string;
    name: string;
    description: string;
    category: string;
    promptTemplate: string;
    toolNames: string[];
    selectionTypes: string[];
    keywords: string[];
    /** 可执行步骤：标题 + 可选说明/工具 */
    steps: SkillStep[];
    /** 完成检查清单 */
    checks: string[];
    /** 示例请求 */
    examples: string[];
    /** 技能路由需要的设计上下文信号 */
    requiredContext: SkillContextSignal[];
    /** 出现这些词时降低命中分 */
    negativeKeywords: string[];
    /** 每次更新递增，便于追踪提示词版本 */
    version: number;
    priority: number;
    isEnabled: boolean;
    isSystem: boolean;
    userId: string | null;
    updatedAt: string;
}

export interface SkillStep {
    title: string;
    detail?: string;
    tool?: string;
}

export type SkillContextSignal = "selection" | "layers" | "blocks" | "revision" | "dimensions";

/** 候选条展示的技能：与后端路由同一套打分，前端只做筛选与保留 */
export interface AiSkillCandidate {
    code: string;
    name: string;
    description: string;
    category: string;
    score: number;
    reasons: string[];
    tools: string[];
    version: number;
}

export interface SkillResolveInput {
    message: string;
    assistantId?: string | null;
    selectionTypes?: string[];
    contextSignals?: SkillContextSignal[];
    pinnedSkillCodes?: string[];
    recentSkillCodes?: string[];
    historyTexts?: string[];
}

export interface ChatSessionInfo {
    id: string;
    projectId: string;
    userId?: string;
    title: string | null;
    assistantId: string | null;
    modelId: string | null;
    contextSummaryUpToId: string | null;
    contextUpdatedAt: string | null;
    lastMessageAt: string | null;
    createdAt: string;
    updatedAt: string;
    /** 列表与详情只给出摘要规模，正文按需单独拉取 */
    hasSummary?: boolean;
    summaryChars?: number;
    contextSummary?: string | null;
    messageCount?: number;
}

/** 会话落库的消息，role 与前端 sender 分开：工具结果也是一等公民 */
export interface ChatLogMessage {
    id: string;
    sessionId: string;
    senderType: "user" | "ai";
    messageType: "text" | "action";
    content: string;
    metadata?: Record<string, unknown> | null;
    role: "user" | "assistant" | "tool" | "system";
    clientMessageId: string | null;
    toolCallId: string | null;
    toolName: string | null;
    toolCalls?: AIToolCall[] | null;
    promptTokens: number | null;
    completionTokens: number | null;
    status: string;
    createdAt: string;
}

export interface AIUsageByProvider {
    provider: string;
    calls: number;
    failures: number;
}

export interface AIUsageSummary {
    days: number;
    calls: number;
    failures: number;
    failureRate: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    avgLatencyMs: number;
    byProvider: AIUsageByProvider[];
}

export interface ChatMessage {
    id: string;
    sender: "user" | "ai";
    text: string;
    timestamp: string;
    type: "text" | "action";
}

/** 模型通过 Function Calling 返回的单个工具调用 */
export interface AIToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface AIActionResponse {
    message: string;
    operation?:
        | "ADD"
        | "CLEAR"
        | "DELETE_LAST"
        | "DELETE"
        | "NONE"
        | "ROTATE"
        | "MIRROR"
        | "COPY"
        | "MOVE"
        | "SCALE"
        | "OFFSET"
        | "ARRAY"
        | "ALIGN"
        | "DISTRIBUTE"
        | "SET_LAYER"
        | "SAVE_BLOCK"
        | "SAVE_VERSION";
    elements?: CADElement[];
    params?: {
        angle?: number;
        center?: Point;
        p1?: Point;
        p2?: Point;
        dx?: number;
        dy?: number;
        /** SAVE_BLOCK：块名、说明与基点；elements 为要入库的选中图元 */
        blockName?: string;
        blockDescription?: string;
        basePoint?: Point;
        /** SAVE_VERSION：版本说明 */
        versionMessage?: string;
        [key: string]: any;
    };
}

export interface LLMModel {
    id: string;
    name: string;
    provider: "Google" | "Ollama" | "Anthropic" | "OpenAI";
    modelId?: string;
    configuration?: {
        apiUrl?: string;
        [key: string]: any;
    };
    userId?: string | null;
    isActive: boolean;
    isDefault?: boolean;
    supportsTools?: boolean;
    contextWindow?: number;
    maxOutputTokens?: number | null;
    temperature?: number | null;
    topP?: number | null;
    timeoutSeconds?: number;
    promptPricePer1k?: number | null;
    completionPricePer1k?: number | null;
    /** 服务端只回掩码，明文 Key 永不出网关 */
    hasApiKey?: boolean;
    apiKeyPreview?: string;
    createdAt?: string;
    updatedAt?: string;
}

/** Agent 一次 HTTP 回合的请求体（phase 区分首轮与工具续轮） */
export interface AgentChatRequest {
    phase: "user_turn" | "tool_results";
    turnId: string;
    round: number;
    message?: string;
    sessionId?: string | null;
    projectId?: string | null;
    assistantId?: string | null;
    modelId?: string | null;
    enableTools?: boolean;
    /** 计划模式：只允许只读工具与 propose_plan */
    planMode?: boolean;
    /** 多方案模式：只允许只读工具与 propose_variants */
    variantMode?: boolean;
    pinnedSkillCodes?: string[];
    /** 前端候选条保留的技能：加分参与路由，但不像固定技能那样绕过规则 */
    recommendedSkillCodes?: string[];
    canvasContext?: CanvasContextPayload;
    toolResults?: AgentToolResultPayload[];
}

/** 模型面板表单载荷；apiKey 为空字符串表示不修改已存 Key */
export interface LLMModelInput {
    name: string;
    provider: LLMModel["provider"];
    modelId: string;
    apiKey?: string;
    isActive?: boolean;
    isDefault?: boolean;
    supportsTools?: boolean;
    contextWindow?: number;
    maxOutputTokens?: number | null;
    temperature?: number | null;
    topP?: number | null;
    timeoutSeconds?: number;
    promptPricePer1k?: number | null;
    completionPricePer1k?: number | null;
    configuration?: { apiUrl?: string | null; [key: string]: unknown };
}

/** 助手表单载荷；toolNames 为 null 表示不限制工具 */
export interface AssistantInput {
    name: string;
    icon?: string;
    description?: string;
    color?: string;
    category?: string;
    prompt?: string | null;
    isActive?: boolean;
    isPublic?: boolean;
    llmModelId?: string | null;
    temperature?: number | null;
    maxTokens?: number | null;
    maxToolRounds?: number;
    toolNames?: string[] | null;
    /** 与后端 POST/PUT 一致：绑定用 skillId + weight，读取时才用 skillIds */
    skills?: Array<{ skillId: string; weight?: number }>;
}

export interface SkillInput {
    name: string;
    code?: string;
    description?: string;
    category?: string;
    promptTemplate: string;
    toolNames?: string[];
    keywords?: string[];
    selectionTypes?: string[];
    steps?: SkillStep[];
    checks?: string[];
    examples?: string[];
    requiredContext?: SkillContextSignal[];
    negativeKeywords?: string[];
    priority?: number;
    isEnabled?: boolean;
}

export interface CanvasContextPayload {
    text?: string;
    elementCount: number;
    selectedIds: string[];
    selectionTypes: string[];
    units?: string;
    bounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
    /** 设计上下文元数据：供技能路由与提示词判断图纸状态 */
    projectName?: string;
    layerNames?: string[];
    blockCount?: number;
    revision?: number;
    hiddenCount?: number;
    hasDimensions?: boolean;
}

export interface AgentToolResultPayload {
    toolCallId: string;
    name: string;
    ok: boolean;
    summary?: string;
    error?: string;
    changedIds?: string[];
}
