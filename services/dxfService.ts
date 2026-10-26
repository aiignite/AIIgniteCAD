/**
 * dxfService.ts — DXF (R2004 / AC1018) 导入导出
 *
 * 坐标约定：应用内部为屏幕坐标（Y 向下），DXF 为世界坐标（Y 向上）。
 * 导出时统一取反 Y，导入时再次取反，保证与外部 CAD 的视觉方向一致，
 * 同时应用内的往返导出/导入保持几何不变。
 *
 * 单位约定：应用内部 canonical 单位为 mm（与默认绘图设置一致）。
 * 导入时按 $INSUNITS 换算到 mm；导出时按目标单位换算并写入对应的
 * $INSUNITS，保证外部 CAD 按声明的单位解释坐标。
 * 无法表达的图元（DIMENSION / HATCH 图案 / 未知类型）不静默丢弃：
 * 导入汇总为 unsupported 报告，导出汇总为 skipped 报告。
 */

import { CADElement, Point, UnitType } from '../types';

const uid = () => Math.random().toString(36).substr(2, 9);

/** $INSUNITS 代码 → 该单位相对 mm 的换算系数 */
const INSUNITS_TO_MM: Record<number, number> = {
    0: 1, // unitless：按 1:1 处理
    1: 25.4, // inches
    2: 304.8, // feet
    3: 1_609_344, // miles
    4: 1, // millimeters
    5: 10, // centimeters
    6: 1000, // meters
    7: 1_000_000, // kilometers
    8: 0.001, // microinches
    9: 0.000_001, // mils
    10: 914.4, // yards
    11: 10_000_000, // angstroms
    12: 1_000_000, // nanometers
    13: 1_000, // micrometers
    14: 100, // decimeters
    15: 10, // dekameters
    16: 100_000, // hectometers
    17: 1_000_000_000, // gigameters
    18: 1.495_978_7e14, // astronomical units
    19: 1.798_691_0e15, // light years
    20: 9.460_730_5e19, // parsecs
};

/** 应用单位 → $INSUNITS 代码 */
const UNIT_TO_INSUNITS: Record<UnitType, number> = {
    mm: 4,
    cm: 5,
    m: 6,
    in: 1,
    ft: 2,
};

/** 应用单位 → 每单位多少 mm */
const MM_PER_UNIT: Record<UnitType, number> = {
    mm: 1,
    cm: 10,
    m: 1000,
    in: 25.4,
    ft: 304.8,
};

/** 导入单位换算：$INSUNITS → 应用内部 mm 的系数；无法识别时按 1:1 */
export const dxfImportScale = (insunits: number | null): number => {
    if (insunits === null || !Number.isFinite(insunits)) return 1;
    const factor = INSUNITS_TO_MM[insunits];
    return factor ?? 1;
};

/** 常用 AutoCAD 颜色索引（ACI）到十六进制颜色 */
const ACI_TO_HEX: Record<number, string> = {
    1: '#ff0000',
    2: '#ffff00',
    3: '#00ff00',
    4: '#00ffff',
    5: '#0000ff',
    6: '#ff00ff',
    7: '#e6edf3',
    8: '#808080',
    9: '#c0c0c0',
    250: '#333333',
    251: '#505050',
    252: '#696969',
    253: '#828282',
    254: '#bebebe',
    255: '#ffffff',
};

const HEX_TO_ACI: Record<string, number> = Object.entries(ACI_TO_HEX).reduce(
    (acc, [aci, hex]) => {
        acc[hex] = Number(aci);
        return acc;
    },
    {} as Record<string, number>,
);

const DEFAULT_COLOR = '#e6edf3';

const normalizeHex = (color: string | undefined): string | null => {
    if (!color) return null;
    const value = color.trim();
    const long = /^#?([0-9a-f]{6})$/i.exec(value);
    if (long) return `#${long[1].toLowerCase()}`;
    const short = /^#?([0-9a-f]{3})$/i.exec(value);
    if (short) {
        const [r, g, b] = short[1].toLowerCase();
        return `#${r}${r}${g}${g}${b}${b}`;
    }
    return null;
};

const hexToTrueColor = (color: string): number | null => {
    const hex = normalizeHex(color);
    if (!hex) return null;
    return parseInt(hex.slice(1), 16);
};

const trueColorToHex = (value: number): string | null => {
    if (!Number.isFinite(value) || value < 0 || value > 0xffffff) return null;
    return `#${Math.round(value).toString(16).padStart(6, '0')}`;
};

const aciToHex = (index: number): string | null => {
    const normalized = Math.abs(Math.trunc(index));
    if (normalized === 0 || normalized === 256) return null;
    return ACI_TO_HEX[normalized] ?? null;
};

/** 写入实体/图层的颜色字段：62 兼容 ACI，420 精确保留 true color */
const colorFields = (color: string | undefined): string => {
    const hex = normalizeHex(color) ?? DEFAULT_COLOR;
    const aci = HEX_TO_ACI[hex] ?? 7;
    const trueColor = hexToTrueColor(hex);
    let out = `62\n${aci}\n`;
    if (trueColor !== null) out += `420\n${trueColor}\n`;
    return out;
};

const num = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    return String(Number(value.toFixed(6)));
};

/** 屏幕坐标 → DXF 世界坐标（Y 取反） */
const dxfPoint = (point: Point): Point => ({ x: point.x, y: -point.y });

/** DXF → 屏幕坐标；归一化 -0，避免坐标断言与显示出现 "-0" */
const negate = (value: number): number => (value === 0 ? 0 : -value);

const screenPoint = (point: Point): Point => ({ x: point.x, y: negate(point.y) });

const normalizeAngle = (angle: number): number => ((angle % 360) + 360) % 360;

/** 采样椭圆，供应用内渲染与命中测试使用 */
const sampleEllipse = (center: Point, radiusX: number, radiusY: number, rotation: number): Point[] => {
    const points: Point[] = [];
    const segments = 64;
    const rotationRad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rotationRad);
    const sin = Math.sin(rotationRad);
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const x = radiusX * Math.cos(angle);
        const y = radiusY * Math.sin(angle);
        points.push({
            x: center.x + x * cos - y * sin,
            y: center.y + x * sin + y * cos,
        });
    }
    return points;
};

/** 图元在屏幕坐标下的外包范围，用于生成 $EXTMIN/$EXTMAX */
const boundsOfElement = (el: CADElement): { minX: number; minY: number; maxX: number; maxY: number } | null => {
    const fromPoints = (points: Point[]) => {
        if (points.length === 0) return null;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        points.forEach((point) => {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        });
        return { minX, minY, maxX, maxY };
    };

    if (el.type === 'LINE' && el.start && el.end) return fromPoints([el.start, el.end]);
    if (el.type === 'CIRCLE' && el.center && el.radius) {
        return {
            minX: el.center.x - el.radius,
            minY: el.center.y - el.radius,
            maxX: el.center.x + el.radius,
            maxY: el.center.y + el.radius,
        };
    }
    if (el.type === 'RECTANGLE' && el.start && el.width && el.height) {
        const x = Math.min(el.start.x, el.start.x + el.width);
        const y = Math.min(el.start.y, el.start.y + el.height);
        return {
            minX: x,
            minY: y,
            maxX: x + Math.abs(el.width),
            maxY: y + Math.abs(el.height),
        };
    }
    if (el.type === 'TEXT' && el.start) {
        const height = el.fontSize || 12;
        const width = (el.text?.length || 1) * height * 0.6;
        return { minX: el.start.x, minY: el.start.y - height, maxX: el.start.x + width, maxY: el.start.y };
    }
    if (el.type === 'ARC' && el.center && el.radius) {
        return {
            minX: el.center.x - el.radius,
            minY: el.center.y - el.radius,
            maxX: el.center.x + el.radius,
            maxY: el.center.y + el.radius,
        };
    }
    if (el.type === 'ELLIPSE' && el.radiusX && el.radiusY) {
        if (el.points && el.points.length > 0) return fromPoints(el.points);
        const center = el.center ?? { x: 0, y: 0 };
        const rad = ((el.rotation || 0) * Math.PI) / 180;
        const halfW = Math.hypot(el.radiusX * Math.cos(rad), el.radiusY * Math.sin(rad));
        const halfH = Math.hypot(el.radiusX * Math.sin(rad), el.radiusY * Math.cos(rad));
        return {
            minX: center.x - halfW,
            minY: center.y - halfH,
            maxX: center.x + halfW,
            maxY: center.y + halfH,
        };
    }
    if (el.points && el.points.length > 0) return fromPoints(el.points);
    return null;
};

const collectLayers = (elements: CADElement[]): Array<{ name: string; color: string }> => {
    const layers = new Map<string, string>();
    layers.set('0', DEFAULT_COLOR);
    elements.forEach((el) => {
        const name = el.layer || '0';
        if (!layers.has(name)) layers.set(name, el.color || DEFAULT_COLOR);
    });
    return [...layers].map(([name, color]) => ({ name, color }));
};

const buildTables = (elements: CADElement[]): string => {
    let out = '0\nSECTION\n2\nTABLES\n';

    out += '0\nTABLE\n2\nLTYPE\n70\n4\n';
    out += '0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n';
    out += '0\nLTYPE\n2\nDASHED\n70\n0\n3\n__ __ __ __\n72\n65\n73\n2\n40\n0.75\n49\n0.5\n49\n-0.25\n';
    out += '0\nLTYPE\n2\nDOTTED\n70\n0\n3\n. . . .\n72\n65\n73\n2\n40\n0.25\n49\n0.0\n49\n-0.25\n';
    out += '0\nLTYPE\n2\nDASHDOT\n70\n0\n3\n__ . __ .\n72\n65\n73\n4\n40\n1.0\n49\n0.5\n49\n-0.25\n49\n0.0\n49\n-0.25\n';
    out += '0\nENDTAB\n';

    const layers = collectLayers(elements);
    out += `0\nTABLE\n2\nLAYER\n70\n${layers.length}\n`;
    layers.forEach(({ name, color }) => {
        out += `0\nLAYER\n2\n${name}\n70\n0\n`;
        out += colorFields(color);
        out += '6\nCONTINUOUS\n';
    });
    out += '0\nENDTAB\n';

    out += '0\nENDSEC\n';
    return out;
};

const entityHeader = (type: string, layer: string, color: string): string =>
    `0\n${type}\n8\n${layer || '0'}\n${colorFields(color)}`;

/** 导出 LWPOLYLINE；closed 时去掉与起点重合的末点，由 70 标志表达闭合 */
const writePolyline = (
    layer: string,
    color: string,
    sourcePoints: Point[],
    closed: boolean,
    format: (value: number) => string = num,
): string => {
    const points = sourcePoints.map(dxfPoint);
    if (closed && points.length > 1) {
        const first = points[0];
        const last = points[points.length - 1];
        if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
            points.pop();
        }
    }
    if (points.length < 2) return '';
    let out = entityHeader('LWPOLYLINE', layer, color);
    out += `90\n${points.length}\n70\n${closed ? 1 : 0}\n`;
    points.forEach((point) => {
        out += `10\n${format(point.x)}\n20\n${format(point.y)}\n`;
    });
    return out;
};

/** 导出选项 */
export interface DxfExportOptions {
    /** 图纸单位：坐标按该单位换算，$INSUNITS 同步声明；默认 mm */
    units?: UnitType;
}

/** 导出报告：未被写入 DXF 的图元按类型汇总，替代静默丢弃 */
export interface DxfExportReport {
    units: UnitType;
    exported: number;
    skipped: Array<{ type: string; count: number }>;
}

export interface DxfExportResult {
    dxf: string;
    report: DxfExportReport;
}

/**
 * 导出 DXF（带报告）。
 * Y 轴取反以匹配 DXF 世界坐标；图层与 LTYPE 表一并写入。
 * 坐标按 options.units 换算，并在 $INSUNITS 声明该单位。
 */
export const exportToDXFWithReport = (
    elements: CADElement[],
    options: DxfExportOptions = {},
): DxfExportResult => {
    const units: UnitType = options.units ?? 'mm';
    const unitScale = 1 / MM_PER_UNIT[units];
    /** 长度类数值（坐标 / 半径 / 字高）按单位换算 */
    const length = (value: number): string => num(value * unitScale);

    const skipped = new Map<string, number>();
    const noteSkipped = (type: string) => {
        skipped.set(type, (skipped.get(type) ?? 0) + 1);
    };

    // 范围
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    elements.forEach((el) => {
        const box = boundsOfElement(el);
        if (!box) return;
        minX = Math.min(minX, box.minX);
        minY = Math.min(minY, box.minY);
        maxX = Math.max(maxX, box.maxX);
        maxY = Math.max(maxY, box.maxY);
    });

    let extMinX = 0;
    let extMinY = 0;
    let extMaxX = 100;
    let extMaxY = 100;
    if (minX !== Infinity) {
        const padding = 10;
        extMinX = minX - padding;
        extMaxX = maxX + padding;
        // 屏幕 Y 向下 → DXF Y 向上：屏幕下边界成为 DXF 最小 Y
        extMinY = -maxY - padding;
        extMaxY = -minY + padding;
    }

    let dxf = '0\nSECTION\n2\nHEADER\n';
    dxf += '9\n$ACADVER\n1\nAC1018\n';
    dxf += `9\n$INSUNITS\n70\n${UNIT_TO_INSUNITS[units]}\n`;
    dxf += '9\n$MEASUREMENT\n70\n1\n';
    dxf += `9\n$EXTMIN\n10\n${length(extMinX)}\n20\n${length(extMinY)}\n30\n0\n`;
    dxf += `9\n$EXTMAX\n10\n${length(extMaxX)}\n20\n${length(extMaxY)}\n30\n0\n`;
    dxf += '0\nENDSEC\n';

    dxf += buildTables(elements);
    dxf += '0\nSECTION\n2\nBLOCKS\n0\nENDSEC\n';
    dxf += '0\nSECTION\n2\nENTITIES\n';

    let exported = 0;
    elements.forEach((el) => {
        const layer = el.layer || '0';
        const color = el.color || DEFAULT_COLOR;

        if (el.type === 'LINE' && el.start && el.end) {
            const start = dxfPoint(el.start);
            const end = dxfPoint(el.end);
            dxf += entityHeader('LINE', layer, color);
            dxf += `10\n${length(start.x)}\n20\n${length(start.y)}\n11\n${length(end.x)}\n21\n${length(end.y)}\n`;
        } else if (el.type === 'CIRCLE' && el.center && el.radius) {
            const center = dxfPoint(el.center);
            dxf += entityHeader('CIRCLE', layer, color);
            dxf += `10\n${length(center.x)}\n20\n${length(center.y)}\n40\n${length(el.radius)}\n`;
        } else if (el.type === 'RECTANGLE' && el.start && el.width && el.height) {
            const x = Math.min(el.start.x, el.start.x + el.width);
            const y = Math.min(el.start.y, el.start.y + el.height);
            const w = Math.abs(el.width);
            const h = Math.abs(el.height);
            dxf += writePolyline(layer, color, [
                { x, y },
                { x: x + w, y },
                { x: x + w, y: y + h },
                { x, y: y + h },
            ], true, length);
        } else if (el.type === 'TEXT' && el.start && el.text) {
            const start = dxfPoint(el.start);
            const safeText = el.text.replace(/\r?\n/g, ' ');
            dxf += entityHeader('TEXT', layer, color);
            dxf += `10\n${length(start.x)}\n20\n${length(start.y)}\n30\n0\n40\n${length(el.fontSize || 12)}\n`;
            if (el.rotation && Math.abs(el.rotation) > 1e-9) {
                dxf += `50\n${num(el.rotation)}\n`;
            }
            dxf += `1\n${safeText}\n`;
        } else if (el.type === 'LWPOLYLINE' && el.points) {
            dxf += writePolyline(layer, color, el.points, Boolean(el.closed), length);
        } else if (el.type === 'ARC' && el.center && el.radius && el.startAngle !== undefined && el.endAngle !== undefined) {
            // 屏幕上顺时针(θ 增大)对应 DXF 的顺时针；DXF ARC 固定逆时针绘制
            const startScreen = normalizeAngle(el.startAngle);
            const endScreen = normalizeAngle(el.endAngle);
            const dxfStart = el.clockwise ? -endScreen : -startScreen;
            const dxfEnd = el.clockwise ? -startScreen : -endScreen;
            const center = dxfPoint(el.center);
            dxf += entityHeader('ARC', layer, color);
            dxf += `10\n${length(center.x)}\n20\n${length(center.y)}\n40\n${length(el.radius)}\n`;
            dxf += `50\n${num(normalizeAngle(dxfStart))}\n51\n${num(normalizeAngle(dxfEnd))}\n`;
        } else if (el.type === 'ELLIPSE' && el.center && el.radiusX && el.radiusY) {
            const center = dxfPoint(el.center);
            const rotation = ((el.rotation || 0) * Math.PI) / 180;
            const majorIsX = el.radiusX >= el.radiusY;
            const major = Math.max(el.radiusX, el.radiusY);
            const minor = Math.min(el.radiusX, el.radiusY);
            const axisAngle = majorIsX ? rotation : rotation + Math.PI / 2;
            const majorX = major * Math.cos(axisAngle);
            const majorY = -major * Math.sin(axisAngle);
            dxf += entityHeader('ELLIPSE', layer, color);
            dxf += `10\n${length(center.x)}\n20\n${length(center.y)}\n30\n0\n`;
            dxf += `11\n${length(majorX)}\n21\n${length(majorY)}\n31\n0\n`;
            // 40 为长短轴之比，不随单位缩放
            dxf += `40\n${num(minor / major)}\n41\n0\n42\n${num(Math.PI * 2)}\n`;
        } else if (
            (el.type === 'GEAR' || el.type === 'SPIRAL' || el.type === 'SPRING') &&
            el.points &&
            el.points.length > 1
        ) {
            // 高级曲线以多段线输出，外部 CAD 可直接查看/编辑
            dxf += writePolyline(layer, color, el.points, el.type === 'GEAR', length);
        } else if (el.type === 'HATCH' && el.points && el.points.length > 1) {
            // DXF HATCH 的图案定义依赖目标环境的图案表，这里只导出边界轮廓，
            // 保证填充区域不丢失；图案本身在报告中说明
            dxf += writePolyline(layer, color, el.points, true, length);
        } else {
            // DIMENSION 等未适配 DXF 语义的图元：计入报告，不静默丢弃
            noteSkipped(el.type);
            return;
        }
        exported += 1;
    });

    dxf += '0\nENDSEC\n0\nEOF';

    return {
        dxf,
        report: {
            units,
            exported,
            skipped: [...skipped].map(([type, count]) => ({ type, count })),
        },
    };
};

/**
 * 导出 DXF（仅文本）。
 * 需要跳过明细时使用 exportToDXFWithReport。
 */
export const exportToDXF = (
    elements: CADElement[],
    options: DxfExportOptions = {},
): string => exportToDXFWithReport(elements, options).dxf;

/* ─── 导入 ─────────────────────────────────────────────────── */

interface DxfPair {
    code: number;
    value: string;
}

interface PendingLayer {
    name: string;
    aci?: number;
    trueColor?: number;
}

/** DXF 世界坐标下的原始实体（Y 向上）；块展开完成后再统一转屏幕坐标 */
interface RawDxfEntity {
    type: string;
    layer: string;
    points: Point[];
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    x3?: number;
    y3?: number;
    x4?: number;
    y4?: number;
    measure?: number;
    text?: string;
    startAngle?: number;
    endAngle?: number;
    rotation?: number;
    closed?: boolean;
    aci?: number;
    trueColor?: number;
    majorX?: number;
    majorY?: number;
    ratio?: number;
    /** LWPOLYLINE 每个顶点的凸度（tan(圆心角/4)） */
    bulges?: number[];
    /** INSERT / DIMENSION 引用的块名 */
    blockName?: string;
    scaleX?: number;
    scaleY?: number;
    columnCount?: number;
    rowCount?: number;
    columnSpacing?: number;
    rowSpacing?: number;
}

interface RawBlock {
    name: string;
    basePoint: Point;
    entities: RawDxfEntity[];
}

/** 2D 仿射矩阵：x' = a*x + c*y + e，y' = b*x + d*y + f */
interface DxfTransform {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}

const SUPPORTED_ENTITIES = new Set([
    'LINE',
    'CIRCLE',
    'LWPOLYLINE',
    'TEXT',
    'MTEXT',
    'ARC',
    'ELLIPSE',
    'INSERT',
    'DIMENSION',
    // 旧式多段线：POLYLINE 后跟若干 VERTEX，再以 SEQEND 结束
    'POLYLINE',
    'VERTEX',
]);

const MAX_BLOCK_DEPTH = 8;
const MAX_EXPANDED_ENTITIES = 200_000;

const IDENTITY_TRANSFORM: DxfTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const multiplyTransform = (left: DxfTransform, right: DxfTransform): DxfTransform => ({
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
});

const translationTransform = (x: number, y: number): DxfTransform => ({
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: x,
    f: y,
});

const scalingTransform = (x: number, y: number): DxfTransform => ({
    a: x,
    b: 0,
    c: 0,
    d: y,
    e: 0,
    f: 0,
});

const rotationTransform = (radians: number): DxfTransform => ({
    a: Math.cos(radians),
    b: Math.sin(radians),
    c: -Math.sin(radians),
    d: Math.cos(radians),
    e: 0,
    f: 0,
});

const applyPoint = (matrix: DxfTransform, point: Point): Point => ({
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

const applyVector = (matrix: DxfTransform, x: number, y: number): Point => ({
    x: matrix.a * x + matrix.c * y,
    y: matrix.b * x + matrix.d * y,
});

/** 块内非均匀缩放时按主方向取近似半径，避免圆弧直接消失 */
const uniformScale = (matrix: DxfTransform): number =>
    Math.hypot(matrix.a, matrix.b) ||
    Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) ||
    1;

const transformRotation = (matrix: DxfTransform): number =>
    (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;

const createRawEntity = (type: string): RawDxfEntity => ({
    type,
    layer: '0',
    points: [],
    ...(type === 'LWPOLYLINE' || type === 'VERTEX' ? { bulges: [] } : {}),
    ...(type === 'INSERT'
        ? {
              scaleX: 1,
              scaleY: 1,
              columnCount: 1,
              rowCount: 1,
              columnSpacing: 0,
              rowSpacing: 0,
          }
        : {}),
});

const tokenize = (content: string): DxfPair[] => {
    const lines = content.split(/\r?\n/);
    const pairs: DxfPair[] = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
        const code = Number.parseInt(lines[i].trim(), 10);
        if (!Number.isFinite(code)) continue;
        pairs.push({ code, value: lines[i + 1].trim() });
    }
    return pairs;
};

/** 把旧式 POLYLINE + VERTEX 序列合并成应用支持的 LWPOLYLINE */
const mergeOldPolylines = (source: RawDxfEntity[]): RawDxfEntity[] => {
    const merged: RawDxfEntity[] = [];
    for (let i = 0; i < source.length; i++) {
        const entity = source[i];
        if (entity.type !== 'POLYLINE') {
            merged.push(entity);
            continue;
        }
        const points = [...entity.points];
        const bulges = [...(entity.bulges ?? [])];
        let j = i + 1;
        while (j < source.length && source[j].type === 'VERTEX') {
            const vertex = source[j];
            points.push({ x: vertex.x1 ?? 0, y: vertex.y1 ?? 0 });
            bulges.push(vertex.bulges?.[0] ?? 0);
            j++;
        }
        merged.push({ ...entity, type: 'LWPOLYLINE', points, bulges });
        i = j - 1;
    }
    return merged;
};

/** 解析报告：不静默丢弃任何实体，未支持的按类型汇总 */
export interface DxfImportReport {
    /** 文件声明的 $INSUNITS 代码；缺失为 null */
    insunits: number | null;
    /** $INSUNITS → 应用内部 mm 的换算系数 */
    unitScale: number;
    /** 解析到的受支持实体总数（含块内展开前） */
    supportedEntities: number;
    /** 最终生成的图元数 */
    imported: number;
    /** 不支持的实体类型与数量 */
    unsupported: Array<{ type: string; count: number }>;
    /** 因几何为空被丢弃的实体数 */
    dropped: number;
    /** 触达最大块嵌套深度而被跳过的 INSERT 数 */
    blockDepthLimitHit: boolean;
    /** 触达最大展开实体数而截断 */
    entityLimitHit: boolean;
}

export interface DxfImportResult {
    elements: CADElement[];
    report: DxfImportReport;
}

/** 结构性关键字：不计入"不支持的实体" */
const DXF_STRUCTURAL = new Set([
    'SECTION',
    'ENDSEC',
    'TABLE',
    'ENDTAB',
    'LAYER',
    'BLOCK',
    'ENDBLK',
    'SEQEND',
]);

/** 解析 DXF 文本为应用图元（带报告）；块引用先展开，再统一单位换算、Y 取反与角度翻转 */
export const parseDXFWithReport = (dxfContent: string): DxfImportResult => {
    const pairs = tokenize(dxfContent);
    const layerColors = new Map<string, string>();
    const blocks: RawBlock[] = [];
    const entities: RawDxfEntity[] = [];

    const unsupportedCounts = new Map<string, number>();
    const noteUnsupported = (type: string) => {
        if (!type || DXF_STRUCTURAL.has(type)) return;
        unsupportedCounts.set(type, (unsupportedCounts.get(type) ?? 0) + 1);
    };

    let insunits: number | null = null;
    let pendingHeaderVar: string | null = null;
    let supportedEntities = 0;

    let section = '';
    let tableName = '';
    let pendingLayer: PendingLayer | null = null;
    let entity: RawDxfEntity | null = null;
    let currentBlock: RawBlock | null = null;

    const resolveColor = (record: { aci?: number; trueColor?: number }, layer: string): string => {
        if (record.trueColor !== undefined) {
            const hex = trueColorToHex(record.trueColor);
            if (hex) return hex;
        }
        if (record.aci !== undefined) {
            const hex = aciToHex(record.aci);
            if (hex) return hex;
        }
        return layerColors.get(layer) ?? layerColors.get(layer.toLowerCase()) ?? DEFAULT_COLOR;
    };

    const flushLayer = () => {
        if (!pendingLayer) return;
        const color = resolveColor(pendingLayer, pendingLayer.name);
        layerColors.set(pendingLayer.name, color);
        layerColors.set(pendingLayer.name.toLowerCase(), color);
        pendingLayer = null;
    };

    const flushEntity = () => {
        if (!entity) return;
        if (currentBlock) currentBlock.entities.push(entity);
        else entities.push(entity);
        entity = null;
    };

    for (let i = 0; i < pairs.length; i++) {
        const { code, value } = pairs[i];

        if (code === 0) {
            flushEntity();
            flushLayer();

            if (value === 'SECTION') {
                section = pairs[i + 1]?.code === 2 ? pairs[++i].value : '';
                continue;
            }
            if (value === 'ENDSEC') {
                section = '';
                tableName = '';
                currentBlock = null;
                continue;
            }
            if (value === 'TABLE') {
                tableName = pairs[i + 1]?.code === 2 ? pairs[++i].value : '';
                continue;
            }
            if (value === 'ENDTAB') {
                tableName = '';
                continue;
            }
            if (tableName === 'LAYER' && value === 'LAYER') {
                pendingLayer = { name: '0' };
                continue;
            }
            if (section === 'BLOCKS') {
                if (value === 'BLOCK') {
                    currentBlock = { name: '', basePoint: { x: 0, y: 0 }, entities: [] };
                    continue;
                }
                if (value === 'ENDBLK') {
                    if (currentBlock?.name) blocks.push(currentBlock);
                    currentBlock = null;
                    continue;
                }
                if (currentBlock && SUPPORTED_ENTITIES.has(value)) {
                    entity = createRawEntity(value);
                    supportedEntities += 1;
                } else if (currentBlock) {
                    noteUnsupported(value);
                }
                continue;
            }
            if (section === 'ENTITIES') {
                if (SUPPORTED_ENTITIES.has(value)) {
                    entity = createRawEntity(value);
                    supportedEntities += 1;
                } else {
                    noteUnsupported(value);
                }
            }
            continue;
        }

        if (section === 'HEADER') {
            // 只关心 $INSUNITS（70）；其余头变量跳过
            if (code === 9) pendingHeaderVar = value;
            else if (code === 70 && pendingHeaderVar === '$INSUNITS') {
                const parsed = Number.parseInt(value, 10);
                if (Number.isFinite(parsed)) insunits = parsed;
                pendingHeaderVar = null;
            }
            continue;
        }

        if (section === 'TABLES' && tableName === 'LAYER' && pendingLayer) {
            if (code === 2) pendingLayer.name = value;
            else if (code === 62) pendingLayer.aci = Number.parseInt(value, 10);
            else if (code === 420) pendingLayer.trueColor = Number.parseInt(value, 10);
            continue;
        }

        if (section === 'BLOCKS' && currentBlock) {
            if (!entity) {
                if (code === 2 || code === 3) currentBlock.name = value;
                else if (code === 10) currentBlock.basePoint.x = Number.parseFloat(value) || 0;
                else if (code === 20) currentBlock.basePoint.y = Number.parseFloat(value) || 0;
                continue;
            }
            parseEntityProp(entity, code, value);
            continue;
        }

        if (section === 'ENTITIES' && entity) {
            parseEntityProp(entity, code, value);
        }
    }

    flushEntity();
    flushLayer();

    const mergedEntities = mergeOldPolylines(entities);
    for (const block of blocks) block.entities = mergeOldPolylines(block.entities);

    // 单位换算：$INSUNITS → 应用内部 canonical 单位 mm
    const unitScale = dxfImportScale(insunits);
    const scaleBlock = (block: RawBlock): RawBlock =>
        unitScale === 1
            ? block
            : {
                  ...block,
                  basePoint: {
                      x: block.basePoint.x * unitScale,
                      y: block.basePoint.y * unitScale,
                  },
              };

    const blockMap = new Map<string, RawBlock>();
    for (const block of blocks) blockMap.set(block.name.toLowerCase(), scaleBlock(block));

    const expanded: RawDxfEntity[] = [];
    const stats: ExpandStats = { blockDepthLimitHit: false };
    for (const item of mergedEntities) {
        expanded.push(
            ...expandEntity(item, blockMap, IDENTITY_TRANSFORM, new Set<string>(), 0, stats),
        );
        if (expanded.length >= MAX_EXPANDED_ENTITIES) break;
    }

    const entityLimitHit = expanded.length >= MAX_EXPANDED_ENTITIES;

    const elements: CADElement[] = [];
    let dropped = 0;
    for (const item of expanded.slice(0, MAX_EXPANDED_ENTITIES)) {
        const scaled = unitScale === 1 ? item : scaleRawEntity(item, unitScale);
        const parsed = finalizeEntity(scaled, resolveColor);
        if (parsed) elements.push(parsed);
        else dropped += 1;
    }

    return {
        elements,
        report: {
            insunits,
            unitScale,
            supportedEntities,
            imported: elements.length,
            unsupported: [...unsupportedCounts]
                .map(([type, count]) => ({ type, count }))
                .sort((a, b) => b.count - a.count),
            dropped,
            blockDepthLimitHit: stats.blockDepthLimitHit,
            entityLimitHit,
        },
    };
};

/** 解析 DXF 文本为应用图元；需要导入明细时使用 parseDXFWithReport */
export const parseDXF = (dxfContent: string): CADElement[] =>
    parseDXFWithReport(dxfContent).elements;

function parseEntityProp(entity: RawDxfEntity, code: number, value: string) {
    const val = Number.parseFloat(value);
    switch (code) {
        case 8:
            entity.layer = value || '0';
            break;
        case 2:
            entity.blockName = value;
            break;
        case 10:
            entity.x1 = val;
            if (entity.type === 'LWPOLYLINE') {
                entity.points.push({ x: val, y: 0 });
                entity.bulges?.push(0);
            }
            break;
        case 20:
            entity.y1 = val;
            if (entity.type === 'LWPOLYLINE' && entity.points.length > 0) {
                entity.points[entity.points.length - 1].y = val;
            }
            break;
        case 11:
            if (entity.type === 'ELLIPSE') entity.majorX = val;
            else entity.x2 = val;
            break;
        case 21:
            if (entity.type === 'ELLIPSE') entity.majorY = val;
            else entity.y2 = val;
            break;
        case 13:
            entity.x3 = val;
            break;
        case 23:
            entity.y3 = val;
            break;
        case 14:
            entity.x4 = val;
            break;
        case 24:
            entity.y4 = val;
            break;
        case 40:
            if (entity.type === 'ELLIPSE') entity.ratio = val;
            else entity.measure = val;
            break;
        case 41:
            // INSERT 的 X 缩放；椭圆起止参数当前按整椭圆导入
            if (entity.type === 'INSERT') entity.scaleX = val;
            break;
        case 42:
            if (entity.type === 'INSERT') entity.scaleY = val;
            else if (entity.type === 'DIMENSION') entity.measure = val;
            else if (entity.type === 'LWPOLYLINE' && entity.bulges) {
                entity.bulges[Math.max(0, entity.points.length - 1)] = val;
            } else if (entity.type === 'VERTEX' && entity.bulges) {
                entity.bulges[0] = val;
            }
            break;
        case 44:
            if (entity.type === 'INSERT') entity.columnSpacing = val;
            break;
        case 45:
            if (entity.type === 'INSERT') entity.rowSpacing = val;
            break;
        case 50:
            if (entity.type === 'ARC') entity.startAngle = val;
            else entity.rotation = val;
            break;
        case 51:
            if (entity.type === 'ARC') entity.endAngle = val;
            break;
        case 1:
            entity.text = entity.type === 'MTEXT' ? `${entity.text ?? ''}${value}` : value;
            break;
        case 3:
            if (entity.type === 'MTEXT') entity.text = `${entity.text ?? ''}${value}`;
            break;
        case 62:
            entity.aci = Number.parseInt(value, 10);
            break;
        case 70:
            if (entity.type === 'LWPOLYLINE') {
                entity.closed = (Number.parseInt(value, 10) & 1) === 1;
            } else if (entity.type === 'INSERT') {
                entity.columnCount = Math.max(1, Number.parseInt(value, 10) || 1);
            } else if (entity.type === 'POLYLINE') {
                entity.closed = (Number.parseInt(value, 10) & 1) === 1;
            }
            break;
        case 71:
            if (entity.type === 'INSERT') {
                entity.rowCount = Math.max(1, Number.parseInt(value, 10) || 1);
            }
            break;
        case 420:
            entity.trueColor = Number.parseInt(value, 10);
            break;
        case 210:
        case 220:
        case 230:
            // 法向向量：2D 图纸默认 Z 轴，无需处理
            break;
        default:
            break;
    }
}

/** 解码 DXF 的 Unicode 转义与常见 %% 控制码 */
const decodeDxfText = (raw: string): string =>
    raw
        .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, hex: string) =>
            String.fromCharCode(Number.parseInt(hex, 16)),
        )
        .replace(/%%[dD]/g, '°')
        .replace(/%%[cC]/g, '⌀')
        .replace(/%%[pP]/g, '±');

/** 去掉 MTEXT 的内联格式码，保留可读文本 */
const cleanMText = (raw: string): string =>
    decodeDxfText(raw)
        .replace(/\\P/gi, ' ')
        .replace(/\\~/g, ' ')
        .replace(/\\S([^;^]*)\^([^;]*);/g, '$1/$2')
        .replace(/\\[A-Za-z][^;\\]*;/g, '')
        .replace(/\\[LlOoKk]/g, '')
        .replace(/\\\\/g, '\\')
        .replace(/[{}]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

const inheritLayer = (source: RawDxfEntity, parentLayer: string): RawDxfEntity =>
    source.layer === '0' && parentLayer !== '0' ? { ...source, layer: parentLayer } : source;

/** 单位换算：把 DXF 世界坐标下的原始实体整体缩放到应用内部 mm */
function scaleRawEntity(entity: RawDxfEntity, factor: number): RawDxfEntity {
    if (factor === 1) return entity;
    const scaleCoord = (value: number | undefined): number | undefined =>
        value === undefined ? undefined : value * factor;
    return {
        ...entity,
        points: entity.points.map((point) => ({ x: point.x * factor, y: point.y * factor })),
        x1: scaleCoord(entity.x1),
        y1: scaleCoord(entity.y1),
        x2: scaleCoord(entity.x2),
        y2: scaleCoord(entity.y2),
        x3: scaleCoord(entity.x3),
        y3: scaleCoord(entity.y3),
        x4: scaleCoord(entity.x4),
        y4: scaleCoord(entity.y4),
        measure: scaleCoord(entity.measure),
        majorX: scaleCoord(entity.majorX),
        majorY: scaleCoord(entity.majorY),
    };
}

function transformRawEntity(entity: RawDxfEntity, matrix: DxfTransform): RawDxfEntity {
    const scale = uniformScale(matrix);
    const rotationOffset = transformRotation(matrix);
    const transformed: RawDxfEntity = {
        ...entity,
        points: entity.points.map((point) => applyPoint(matrix, point)),
        ...(entity.bulges
            ? {
                  bulges:
                      matrix.a * matrix.d - matrix.b * matrix.c < 0
                          ? entity.bulges.map((bulge) => -bulge)
                          : [...entity.bulges],
              }
            : {}),
    };

    const move = (x?: number, y?: number): Point | null =>
        x === undefined || y === undefined ? null : applyPoint(matrix, { x, y });

    const p1 = move(entity.x1, entity.y1);
    if (p1) {
        transformed.x1 = p1.x;
        transformed.y1 = p1.y;
    }
    const p2 = move(entity.x2, entity.y2);
    if (p2) {
        transformed.x2 = p2.x;
        transformed.y2 = p2.y;
    }
    if (entity.type === 'DIMENSION') {
        const p3 = move(entity.x3, entity.y3);
        if (p3) {
            transformed.x3 = p3.x;
            transformed.y3 = p3.y;
        }
        const p4 = move(entity.x4, entity.y4);
        if (p4) {
            transformed.x4 = p4.x;
            transformed.y4 = p4.y;
        }
        transformed.rotation = (entity.rotation ?? 0) + rotationOffset;
        return transformed;
    }

    if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
        transformed.measure = (entity.measure ?? 10) * scale;
        if (entity.type === 'ARC') {
            transformed.startAngle = (entity.startAngle ?? 0) + rotationOffset;
            transformed.endAngle = (entity.endAngle ?? 0) + rotationOffset;
        }
        return transformed;
    }
    if (entity.type === 'TEXT') {
        transformed.measure = (entity.measure ?? 12) * scale;
        transformed.rotation = (entity.rotation ?? 0) + rotationOffset;
        return transformed;
    }
    if (entity.type === 'ELLIPSE') {
        const major = applyVector(matrix, entity.majorX ?? 10, entity.majorY ?? 0);
        const ratio = entity.ratio && entity.ratio > 0 ? entity.ratio : 1;
        const minor = applyVector(
            matrix,
            -(entity.majorY ?? 0) * ratio,
            (entity.majorX ?? 10) * ratio,
        );
        const majorLength = Math.hypot(major.x, major.y) || 1;
        const minorLength = Math.hypot(minor.x, minor.y);
        transformed.majorX = major.x;
        transformed.majorY = major.y;
        transformed.ratio = Math.min(1, minorLength / majorLength);
        return transformed;
    }
    return transformed;
}

/** 展开过程中的统计信息：用于导入报告 */
interface ExpandStats {
    blockDepthLimitHit: boolean;
}

function expandEntity(
    entity: RawDxfEntity,
    blocks: Map<string, RawBlock>,
    matrix: DxfTransform,
    stack: Set<string>,
    depth: number,
    stats: ExpandStats,
): RawDxfEntity[] {
    if (entity.type === 'INSERT') {
        return expandInsert(entity, blocks, matrix, stack, depth, stats);
    }
    if (entity.type === 'DIMENSION') {
        return expandDimension(entity, blocks, matrix, stack, depth, stats);
    }
    if (entity.type === 'MTEXT') {
        const text = cleanMText(entity.text ?? '');
        if (!text) return [];
        return [transformRawEntity({ ...entity, type: 'TEXT', text }, matrix)];
    }
    return [transformRawEntity(entity, matrix)];
}

function expandInsert(
    insert: RawDxfEntity,
    blocks: Map<string, RawBlock>,
    parentMatrix: DxfTransform,
    stack: Set<string>,
    depth: number,
    stats: ExpandStats,
): RawDxfEntity[] {
    const name = (insert.blockName ?? '').trim().toLowerCase();
    if (!name || depth >= MAX_BLOCK_DEPTH || stack.has(name)) {
        if (name) stats.blockDepthLimitHit = true;
        return [];
    }
    const block = blocks.get(name);
    if (!block) return [];

    const nextStack = new Set(stack);
    nextStack.add(name);

    const scaleX = insert.scaleX ?? 1;
    const scaleY = insert.scaleY ?? 1;
    const columns = Math.max(1, insert.columnCount ?? 1);
    const rows = Math.max(1, insert.rowCount ?? 1);
    const result: RawDxfEntity[] = [];

    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const local = multiplyTransform(
                translationTransform(insert.x1 ?? 0, insert.y1 ?? 0),
                multiplyTransform(
                    rotationTransform(((insert.rotation ?? 0) * Math.PI) / 180),
                    multiplyTransform(
                        scalingTransform(scaleX, scaleY),
                        translationTransform(
                            column * (insert.columnSpacing ?? 0) - block.basePoint.x,
                            row * (insert.rowSpacing ?? 0) - block.basePoint.y,
                        ),
                    ),
                ),
            );
            const matrix = multiplyTransform(parentMatrix, local);
            for (const child of block.entities) {
                const inherited = inheritLayer(child, insert.layer);
                for (const expanded of expandEntity(
                    inherited,
                    blocks,
                    matrix,
                    nextStack,
                    depth + 1,
                    stats,
                )) {
                    result.push(expanded);
                    if (result.length >= MAX_EXPANDED_ENTITIES) return result;
                }
            }
        }
    }
    return result;
}

function expandDimension(
    dimension: RawDxfEntity,
    blocks: Map<string, RawBlock>,
    parentMatrix: DxfTransform,
    stack: Set<string>,
    depth: number,
    stats: ExpandStats,
): RawDxfEntity[] {
    const name = (dimension.blockName ?? '').trim().toLowerCase();
    if (name && depth < MAX_BLOCK_DEPTH && !stack.has(name)) {
        const block = blocks.get(name);
        if (block) {
            const nextStack = new Set(stack);
            nextStack.add(name);
            const result: RawDxfEntity[] = [];
            for (const child of block.entities) {
                const inherited = inheritLayer(child, dimension.layer);
                for (const expanded of expandEntity(
                    inherited,
                    blocks,
                    parentMatrix,
                    nextStack,
                    depth + 1,
                    stats,
                )) {
                    result.push(expanded);
                    if (result.length >= MAX_EXPANDED_ENTITIES) break;
                }
            }
            // 标注匿名块通常已包含完整的线、箭头与文字，优先使用
            if (result.length > 0) return result;
        }
    }
    return [transformRawEntity(dimension, parentMatrix)];
}

/** 把 LWPOLYLINE 的 bulge 段采样为折线，避免圆角/圆弧槽被拉直 */
function sampleBulge(start: Point, end: Point, bulge: number): Point[] {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const chord = Math.hypot(dx, dy);
    const theta = 4 * Math.atan(bulge);
    if (chord < 1e-9 || Math.abs(theta) < 1e-9) return [];

    const offset = (chord / 2) / Math.tan(theta / 2);
    if (!Number.isFinite(offset)) return [];

    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const center = {
        x: mid.x - (dy / chord) * offset,
        y: mid.y + (dx / chord) * offset,
    };
    const radius = Math.hypot(start.x - center.x, start.y - center.y);
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const segments = Math.min(64, Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 12))));
    const points: Point[] = [];
    for (let i = 1; i < segments; i++) {
        const angle = startAngle + (theta * i) / segments;
        points.push({
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle),
        });
    }
    return points;
}

function finalizeEntity(
    entity: RawDxfEntity,
    resolveColor: (record: { aci?: number; trueColor?: number }, layer: string) => string,
): CADElement | null {
    const color = resolveColor({ aci: entity.aci, trueColor: entity.trueColor }, entity.layer || '0');
    const base = {
        id: uid(),
        layer: entity.layer || '0',
        color,
    };

    if (entity.type === 'LINE') {
        return {
            ...base,
            type: 'LINE',
            start: screenPoint({ x: entity.x1 ?? 0, y: entity.y1 ?? 0 }),
            end: screenPoint({ x: entity.x2 ?? 0, y: entity.y2 ?? 0 }),
        };
    }
    if (entity.type === 'CIRCLE') {
        return {
            ...base,
            type: 'CIRCLE',
            center: screenPoint({ x: entity.x1 ?? 0, y: entity.y1 ?? 0 }),
            radius: entity.measure || 10,
        };
    }
    if (entity.type === 'TEXT') {
        return {
            ...base,
            type: 'TEXT',
            start: screenPoint({ x: entity.x1 ?? 0, y: entity.y1 ?? 0 }),
            text: decodeDxfText(entity.text || 'Text'),
            fontSize: entity.measure || 12,
            ...(entity.rotation && Math.abs(entity.rotation) > 1e-9
                ? { rotation: entity.rotation }
                : {}),
        };
    }
    if (entity.type === 'LWPOLYLINE') {
        const closed = Boolean(entity.closed);
        const source = [...entity.points];
        const bulges = [...(entity.bulges ?? [])];
        if (closed && source.length > 1) {
            const first = source[0];
            const last = source[source.length - 1];
            if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
                source.pop();
                bulges.pop();
            }
        }

        const sampled: Point[] = [];
        const segments = closed ? source.length : source.length - 1;
        for (let i = 0; i < segments; i++) {
            const current = source[i];
            const next = source[(i + 1) % source.length];
            sampled.push(current);
            const bulge = bulges[i] ?? 0;
            if (Math.abs(bulge) > 1e-9) {
                sampled.push(...sampleBulge(current, next, bulge));
            }
        }
        if (!closed && source.length > 0) sampled.push(source[source.length - 1]);

        let points = sampled.map(screenPoint);
        if (points.length === 0) return null;
        if (closed) {
            while (points.length > 1) {
                const first = points[0];
                const last = points[points.length - 1];
                if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
                    points = points.slice(0, -1);
                } else {
                    break;
                }
            }
        }
        return { ...base, type: 'LWPOLYLINE', points, closed };
    }
    if (entity.type === 'ARC') {
        const radius = entity.measure || 10;
        const start = normalizeAngle(-(entity.startAngle ?? 0));
        const end = normalizeAngle(-(entity.endAngle ?? 90));
        return {
            ...base,
            type: 'ARC',
            center: screenPoint({ x: entity.x1 ?? 0, y: entity.y1 ?? 0 }),
            radius,
            startAngle: start,
            endAngle: end,
            // DXF 圆弧固定逆时针，Y 翻转后在屏幕上表现为逆时针（θ 递减）
            clockwise: false,
        };
    }
    if (entity.type === 'ELLIPSE') {
        const center = screenPoint({ x: entity.x1 ?? 0, y: entity.y1 ?? 0 });
        const majorX = entity.majorX ?? 10;
        const majorY = negate(entity.majorY ?? 0);
        const major = Math.hypot(majorX, majorY) || 10;
        const ratio = entity.ratio && entity.ratio > 0 ? entity.ratio : 1;
        const rotation = (Math.atan2(majorY, majorX) * 180) / Math.PI;
        const radiusX = major;
        const radiusY = major * ratio;
        return {
            ...base,
            type: 'ELLIPSE',
            center,
            radiusX,
            radiusY,
            rotation,
            points: sampleEllipse(center, radiusX, radiusY, rotation),
        };
    }
    if (entity.type === 'DIMENSION') {
        const startX = entity.x3 ?? entity.x1 ?? 0;
        const startY = entity.y3 ?? entity.y1 ?? 0;
        const endX = entity.x4 ?? entity.x2 ?? startX;
        const endY = entity.y4 ?? entity.y2 ?? startY;
        return {
            ...base,
            type: 'DIMENSION',
            start: screenPoint({ x: startX, y: startY }),
            end: screenPoint({ x: endX, y: endY }),
            offsetPoint: screenPoint({
                x: entity.x2 ?? (startX + endX) / 2,
                y: entity.y2 ?? (startY + endY) / 2,
            }),
        };
    }
    return null;
}
