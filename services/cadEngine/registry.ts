/**
 * CAD算法注册表
 * 定义所有可用的CAD算法及其元数据
 */

import { Point, CADElement } from '../../types';

// 参数类型定义
export type ParameterType = 
    | 'Point' 
    | 'number' 
    | 'string' 
    | 'boolean' 
    | 'CADElement' 
    | 'CADElement[]'
    | 'Point[]'
    | 'selection';

export interface ParameterSchema {
    name: string;
    type: ParameterType;
    description: string;
    required: boolean;
    default?: any;
    min?: number;
    max?: number;
    enum?: string[];
}

export interface ReturnSchema {
    type: string;
    description: string;
}

export interface AlgorithmExample {
    input: string;
    params: Record<string, any>;
    description: string;
}

export interface AlgorithmMetadata {
    id: string;
    name: string;
    category: 
        | 'PRIMITIVES'      // 基础图元
        | 'GEOMETRY'        // 几何计算
        | 'TRANSFORM'       // 变换操作
        | 'ADVANCED'        // 高级操作
        | 'MEASUREMENT'     // 测量分析
        | 'CONSTRAINT';     // 约束求解
    description: string;
    parameters: ParameterSchema[];
    returns: ReturnSchema;
    examples: AlgorithmExample[];
    tags: string[];
    version: string;
}

// ==================== 基础图元算法 ====================

export const DRAW_LINE: AlgorithmMetadata = {
    id: 'DRAW_LINE',
    name: '绘制直线',
    category: 'PRIMITIVES',
    description: '在两点之间绘制一条直线',
    parameters: [
        { name: 'start', type: 'Point', description: '起点坐标', required: true },
        { name: 'end', type: 'Point', description: '终点坐标', required: true },
        { name: 'color', type: 'string', description: '颜色', required: false, default: '#8b949e' },
        { name: 'layer', type: 'string', description: '图层', required: false, default: '0' }
    ],
    returns: { type: 'CADElement', description: '直线元素' },
    examples: [
        {
            input: '从(100,100)到(200,200)画一条线',
            params: { start: {x: 100, y: 100}, end: {x: 200, y: 200} },
            description: '绘制对角线'
        }
    ],
    tags: ['draw', 'line', 'basic'],
    version: '1.0.0'
};

export const DRAW_CIRCLE: AlgorithmMetadata = {
    id: 'DRAW_CIRCLE',
    name: '绘制圆',
    category: 'PRIMITIVES',
    description: '以指定圆心和半径绘制圆',
    parameters: [
        { name: 'center', type: 'Point', description: '圆心坐标', required: true },
        { name: 'radius', type: 'number', description: '半径', required: true, min: 0 },
        { name: 'color', type: 'string', description: '颜色', required: false, default: '#8b949e' },
        { name: 'layer', type: 'string', description: '图层', required: false, default: '0' }
    ],
    returns: { type: 'CADElement', description: '圆元素' },
    examples: [
        {
            input: '在(400,300)画一个半径50的圆',
            params: { center: {x: 400, y: 300}, radius: 50 },
            description: '画布中心绘制圆'
        }
    ],
    tags: ['draw', 'circle', 'basic'],
    version: '1.0.0'
};

export const DRAW_RECTANGLE: AlgorithmMetadata = {
    id: 'DRAW_RECTANGLE',
    name: '绘制矩形',
    category: 'PRIMITIVES',
    description: '绘制矩形',
    parameters: [
        { name: 'corner', type: 'Point', description: '起始角点', required: true },
        { name: 'width', type: 'number', description: '宽度', required: true },
        { name: 'height', type: 'number', description: '高度', required: true },
        { name: 'color', type: 'string', description: '颜色', required: false, default: '#8b949e' },
        { name: 'layer', type: 'string', description: '图层', required: false, default: '0' }
    ],
    returns: { type: 'CADElement', description: '矩形元素' },
    examples: [
        {
            input: '画一个100x50的矩形',
            params: { corner: {x: 100, y: 100}, width: 100, height: 50 },
            description: '绘制矩形'
        }
    ],
    tags: ['draw', 'rectangle', 'basic'],
    version: '1.0.0'
};

export const DRAW_POLYGON: AlgorithmMetadata = {
    id: 'DRAW_POLYGON',
    name: '绘制正多边形',
    category: 'PRIMITIVES',
    description: '绘制正多边形',
    parameters: [
        { name: 'center', type: 'Point', description: '中心点', required: true },
        { name: 'sides', type: 'number', description: '边数', required: true, min: 3, max: 100 },
        { name: 'radius', type: 'number', description: '外接圆半径', required: true, min: 1 },
        { name: 'rotation', type: 'number', description: '旋转角度', required: false, default: 0 },
        { name: 'color', type: 'string', description: '颜色', required: false, default: '#8b949e' },
        { name: 'layer', type: 'string', description: '图层', required: false, default: '0' }
    ],
    returns: { type: 'CADElement', description: '多边形元素' },
    examples: [
        {
            input: '画一个正六边形',
            params: { center: {x: 400, y: 300}, sides: 6, radius: 50 },
            description: '绘制六边形'
        }
    ],
    tags: ['draw', 'polygon', 'shape'],
    version: '1.0.0'
};

// ==================== 几何计算算法 ====================

export const FIND_INTERSECTION: AlgorithmMetadata = {
    id: 'FIND_INTERSECTION',
    name: '求交点',
    category: 'GEOMETRY',
    description: '计算两个图元的交点',
    parameters: [
        { name: 'element1', type: 'CADElement', description: '第一个元素', required: true },
        { name: 'element2', type: 'CADElement', description: '第二个元素', required: true }
    ],
    returns: { type: 'Point[]', description: '交点数组' },
    examples: [
        {
            input: '找出两条线的交点',
            params: { element1: 'line1', element2: 'line2' },
            description: '求两线交点'
        }
    ],
    tags: ['geometry', 'intersection', 'calculation'],
    version: '1.0.0'
};

export const MEASURE_DISTANCE: AlgorithmMetadata = {
    id: 'MEASURE_DISTANCE',
    name: '测量距离',
    category: 'GEOMETRY',
    description: '计算两点之间的距离',
    parameters: [
        { name: 'point1', type: 'Point', description: '第一个点', required: true },
        { name: 'point2', type: 'Point', description: '第二个点', required: true }
    ],
    returns: { type: 'number', description: '距离值' },
    examples: [
        {
            input: '测量两点距离',
            params: { point1: {x: 0, y: 0}, point2: {x: 100, y: 0} },
            description: '水平距离100'
        }
    ],
    tags: ['geometry', 'distance', 'measure'],
    version: '1.0.0'
};

// ==================== 变换操作算法 ====================

export const MOVE_ELEMENTS: AlgorithmMetadata = {
    id: 'MOVE_ELEMENTS',
    name: '移动元素',
    category: 'TRANSFORM',
    description: '移动选中的元素',
    parameters: [
        { name: 'elements', type: 'selection', description: '要移动的元素', required: true },
        { name: 'dx', type: 'number', description: 'X方向位移', required: true },
        { name: 'dy', type: 'number', description: 'Y方向位移', required: true }
    ],
    returns: { type: 'CADElement[]', description: '移动后的元素' },
    examples: [
        {
            input: '将选中的元素向右移动50',
            params: { elements: 'selected', dx: 50, dy: 0 },
            description: '水平移动'
        }
    ],
    tags: ['transform', 'move', 'translate'],
    version: '1.0.0'
};

export const ROTATE_ELEMENTS: AlgorithmMetadata = {
    id: 'ROTATE_ELEMENTS',
    name: '旋转元素',
    category: 'TRANSFORM',
    description: '围绕中心点旋转元素',
    parameters: [
        { name: 'elements', type: 'selection', description: '要旋转的元素', required: true },
        { name: 'center', type: 'Point', description: '旋转中心', required: true },
        { name: 'angle', type: 'number', description: '旋转角度（度）', required: true }
    ],
    returns: { type: 'CADElement[]', description: '旋转后的元素' },
    examples: [
        {
            input: '将选中元素绕中心旋转45度',
            params: { elements: 'selected', center: {x: 400, y: 300}, angle: 45 },
            description: '旋转45度'
        }
    ],
    tags: ['transform', 'rotate'],
    version: '1.0.0'
};

export const MIRROR_ELEMENTS: AlgorithmMetadata = {
    id: 'MIRROR_ELEMENTS',
    name: '镜像元素',
    category: 'TRANSFORM',
    description: '沿指定轴线镜像元素',
    parameters: [
        { name: 'elements', type: 'selection', description: '要镜像的元素', required: true },
        { name: 'axisStart', type: 'Point', description: '镜像轴起点', required: true },
        { name: 'axisEnd', type: 'Point', description: '镜像轴终点', required: true }
    ],
    returns: { type: 'CADElement[]', description: '镜像后的元素' },
    examples: [
        {
            input: '沿Y轴镜像',
            params: { 
                elements: 'selected', 
                axisStart: {x: 400, y: 0}, 
                axisEnd: {x: 400, y: 600} 
            },
            description: '垂直镜像'
        }
    ],
    tags: ['transform', 'mirror', 'symmetry'],
    version: '1.0.0'
};

// ==================== 高级操作算法 ====================

export const ARRAY_LINEAR: AlgorithmMetadata = {
    id: 'ARRAY_LINEAR',
    name: '线性阵列',
    category: 'ADVANCED',
    description: '沿直线方向创建元素阵列',
    parameters: [
        { name: 'element', type: 'CADElement', description: '要阵列的元素', required: true },
        { name: 'count', type: 'number', description: '数量', required: true, min: 2, max: 1000 },
        { name: 'dx', type: 'number', description: 'X方向间距', required: true },
        { name: 'dy', type: 'number', description: 'Y方向间距', required: true }
    ],
    returns: { type: 'CADElement[]', description: '阵列元素' },
    examples: [
        {
            input: '创建10个间距为50的线性阵列',
            params: { element: 'circle1', count: 10, dx: 50, dy: 0 },
            description: '水平阵列'
        }
    ],
    tags: ['array', 'pattern', 'repeat'],
    version: '1.0.0'
};

export const ARRAY_CIRCULAR: AlgorithmMetadata = {
    id: 'ARRAY_CIRCULAR',
    name: '环形阵列',
    category: 'ADVANCED',
    description: '围绕中心点创建环形阵列',
    parameters: [
        { name: 'element', type: 'CADElement', description: '要阵列的元素', required: true },
        { name: 'center', type: 'Point', description: '阵列中心', required: true },
        { name: 'count', type: 'number', description: '数量', required: true, min: 2, max: 360 },
        { name: 'radius', type: 'number', description: '阵列半径', required: false }
    ],
    returns: { type: 'CADElement[]', description: '阵列元素' },
    examples: [
        {
            input: '围绕中心创建12个环形阵列',
            params: { element: 'circle1', center: {x: 400, y: 300}, count: 12 },
            description: '时钟样式阵列'
        }
    ],
    tags: ['array', 'circular', 'polar'],
    version: '1.0.0'
};

export const OFFSET_ELEMENT: AlgorithmMetadata = {
    id: 'OFFSET_ELEMENT',
    name: '偏移',
    category: 'ADVANCED',
    description: '创建元素的偏移副本',
    parameters: [
        { name: 'element', type: 'CADElement', description: '要偏移的元素', required: true },
        { name: 'distance', type: 'number', description: '偏移距离', required: true },
        { name: 'side', type: 'string', description: '偏移方向', required: false, enum: ['inside', 'outside', 'both'] }
    ],
    returns: { type: 'CADElement', description: '偏移后的元素' },
    examples: [
        {
            input: '向外偏移10个单位',
            params: { element: 'rect1', distance: 10, side: 'outside' },
            description: '外部偏移'
        }
    ],
    tags: ['offset', 'parallel', 'advanced'],
    version: '1.0.0'
};

// ==================== 测量分析算法 ====================

export const MEASURE_AREA: AlgorithmMetadata = {
    id: 'MEASURE_AREA',
    name: '测量面积',
    category: 'MEASUREMENT',
    description: '计算封闭图形的面积',
    parameters: [
        { name: 'elements', type: 'selection', description: '要测量的元素', required: true }
    ],
    returns: { type: 'number', description: '面积值' },
    examples: [
        {
            input: '计算选中矩形的面积',
            params: { elements: 'selected' },
            description: '面积测量'
        }
    ],
    tags: ['measure', 'area', 'analysis'],
    version: '1.0.0'
};

export const MEASURE_PERIMETER: AlgorithmMetadata = {
    id: 'MEASURE_PERIMETER',
    name: '测量周长',
    category: 'MEASUREMENT',
    description: '计算图形的周长',
    parameters: [
        { name: 'elements', type: 'selection', description: '要测量的元素', required: true }
    ],
    returns: { type: 'number', description: '周长值' },
    examples: [
        {
            input: '计算圆的周长',
            params: { elements: 'selected' },
            description: '周长测量'
        }
    ],
    tags: ['measure', 'perimeter', 'length'],
    version: '1.0.0'
};

// ==================== 算法注册表 ====================

export const CAD_ALGORITHM_REGISTRY: Record<string, AlgorithmMetadata> = {
    // 基础图元
    DRAW_LINE,
    DRAW_CIRCLE,
    DRAW_RECTANGLE,
    DRAW_POLYGON,
    
    // 几何计算
    FIND_INTERSECTION,
    MEASURE_DISTANCE,
    
    // 变换操作
    MOVE_ELEMENTS,
    ROTATE_ELEMENTS,
    MIRROR_ELEMENTS,
    
    // 高级操作
    ARRAY_LINEAR,
    ARRAY_CIRCULAR,
    OFFSET_ELEMENT,
    
    // 测量分析
    MEASURE_AREA,
    MEASURE_PERIMETER
};

// ==================== 辅助函数 ====================

/**
 * 按类别获取算法
 */
export function getAlgorithmsByCategory(category: AlgorithmMetadata['category']): AlgorithmMetadata[] {
    return Object.values(CAD_ALGORITHM_REGISTRY).filter(alg => alg.category === category);
}

/**
 * 搜索算法
 */
export function searchAlgorithms(query: string): AlgorithmMetadata[] {
    const lowerQuery = query.toLowerCase();
    return Object.values(CAD_ALGORITHM_REGISTRY).filter(alg => 
        alg.name.toLowerCase().includes(lowerQuery) ||
        alg.description.toLowerCase().includes(lowerQuery) ||
        alg.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
}

/**
 * 获取算法元数据
 */
export function getAlgorithm(id: string): AlgorithmMetadata | undefined {
    return CAD_ALGORITHM_REGISTRY[id];
}

/**
 * 获取所有算法ID
 */
export function getAllAlgorithmIds(): string[] {
    return Object.keys(CAD_ALGORITHM_REGISTRY);
}
