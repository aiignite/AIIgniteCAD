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
  LLM_MODELS = "LLM_MODELS",
  ASSISTANTS = "ASSISTANTS",
  CHAT = "CHAT",
  FILES = "FILES",
  SETTINGS = "SETTINGS",
  USER_INFO = "USER_INFO",
}

export type UnitType = "mm" | "cm" | "m" | "in" | "ft";

export interface DrawingSettings {
  units: UnitType;
  gridSpacing: number; // The visual grid spacing
  snapDistance: number; // How close to snap
  dimScale: number; // Global scale factor for dimension text/arrows
  dimPrecision: number; // Decimal places (0-8)
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
    | "SPRING";
  layer: string;
  color: string; // Hex or AutoCAD color index
  selected?: boolean;
  // Geometry properties
  start?: Point;
  end?: Point; // For Line, Dimension
  center?: Point; // For Circle, Arc, Ellipse, Gear
  radius?: number; // For Circle, Arc
  width?: number; // For Rect
  height?: number; // For Rect
  points?: Point[]; // For Polyline, Spiral, Spring
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
  selected?: boolean;
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

// 捕捉点信息
export interface SnapPoint {
  point: Point;
  type: SnapType;
  elementId?: string;
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
  commitMessage?: string;
  createdBy?: string;
  createdAt: string;
}

// 同步队列项（用于IndexedDB离线同步）
export interface SyncQueueItem {
  id: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  entityType:
    | "PROJECT"
    | "ELEMENT"
    | "BLOCK_DEFINITION"
    | "BLOCK_REFERENCE"
    | "LAYER";
  entityId: string;
  data: any;
  timestamp: string;
  status: "PENDING" | "SYNCED" | "FAILED";
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
  desc: string;
  color: string;
  prompt?: string;
  isActive?: boolean;
  isPublic?: boolean;
  llmModelId?: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: string;
  type: "text" | "action";
}

export interface AIActionResponse {
  message: string;
  operation?:
    | "ADD"
    | "CLEAR"
    | "DELETE_LAST"
    | "NONE"
    | "ROTATE"
    | "MIRROR"
    | "COPY"
    | "MOVE";
  elements?: CADElement[];
  params?: {
    angle?: number;
    center?: Point;
    p1?: Point;
    p2?: Point;
    dx?: number;
    dy?: number;
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
  status: "Active" | "Inactive";
}

// Voice-driven CAD command schema
export type CadAction =
  | "draw"
  | "modify"
  | "constrain"
  | "feature"
  | "query"
  | "view"
  | "undo"
  | "redo";

export type CadEntity =
  | "line"
  | "circle"
  | "rect"
  | "polyline"
  | "arc"
  | "ellipse"
  | "gear"
  | "spiral"
  | "spring"
  | "profile"
  | "solid"
  | "face"
  | "edge";

export interface CadCommand {
  id: string;
  action: CadAction;
  entity?: CadEntity;
  params?: Record<string, any>;
  targets?: string[];
  units?: UnitType;
  tolerance?: number;
  layer?: string;
  style?: {
    color?: string;
    lineType?: string;
    lineWeight?: number;
  };
  meta?: {
    source: "voice" | "text" | "script";
    confidence?: number;
    transcript?: string;
  };
}

export interface CadDiff {
  added: CADElement[];
  updated: CADElement[];
  removed: string[];
}

export interface CadResult {
  ok: boolean;
  error?: { code: string; message: string; detail?: any };
  elements?: CADElement[];
  diff?: CadDiff;
  summary?: string;
  needsClarification?: { fields: string[]; question: string };
}

export interface NeedsClarification {
  needsClarification: true;
  fields: string[];
  question: string;
  transcript?: string;
}

export interface VoiceCommandContext {
  transcript: string;
  confidence: number;
  timestamp: number;
  locale?: string;
}
