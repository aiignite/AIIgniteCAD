
export enum ToolType {
    SELECT = 'SELECT',
    PAN = 'PAN',
    LINE = 'LINE',
    CIRCLE = 'CIRCLE',
    RECTANGLE = 'RECTANGLE',
    TEXT = 'TEXT',
    POLYLINE = 'POLYLINE',
    ARC = 'ARC',
    HATCH = 'HATCH',
    COPY = 'COPY',
    TRIM = 'TRIM',
    MIRROR = 'MIRROR',
    ROTATE = 'ROTATE',
    DIMENSION = 'DIMENSION',
    MEASURE = 'MEASURE'
}

export enum SidePanelMode {
    LLM_MODELS = 'LLM_MODELS',
    ASSISTANTS = 'ASSISTANTS',
    CHAT = 'CHAT',
    FILES = 'FILES',
    SETTINGS = 'SETTINGS'
}

export type UnitType = 'mm' | 'cm' | 'm' | 'in' | 'ft';

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
    type: 'LINE' | 'CIRCLE' | 'RECTANGLE' | 'LWPOLYLINE' | 'TEXT' | 'DIMENSION' | 'ARC';
    layer: string;
    color: string; // Hex or AutoCAD color index
    selected?: boolean;
    // Geometry properties
    start?: Point;
    end?: Point; // For Line, Dimension
    center?: Point; // For Circle, Arc
    radius?: number; // For Circle, Arc
    width?: number; // For Rect
    height?: number; // For Rect
    points?: Point[]; // For Polyline
    text?: string; // For Text
    fontSize?: number; // For Text
    // Dimension specific
    offsetPoint?: Point; // The third point determining height of dimension
    // Arc specific
    startAngle?: number;
    endAngle?: number;
    clockwise?: boolean; // Direction of the arc
}

export interface ProjectFile {
    id: string;
    name: string;
    lastModified: string;
    elements: CADElement[];
}

export interface ChatMessage {
    id: string;
    sender: 'user' | 'ai';
    text: string;
    timestamp: string;
    type: 'text' | 'action';
}

export interface AIActionResponse {
    message: string;
    operation?: 'ADD' | 'CLEAR' | 'DELETE_LAST' | 'NONE';
    elements?: CADElement[];
}

export interface LLMModel {
    id: string;
    name: string;
    provider: 'Google' | 'Ollama' | 'Anthropic' | 'OpenAI';
    status: 'Active' | 'Inactive';
}

export interface Assistant {
    id: string;
    name: string;
    icon: string;
    desc: string;
    color: string;
}