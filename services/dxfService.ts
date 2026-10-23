/**
 * dxfService.ts — DXF (R2004 / AC1018) 导入导出
 *
 * 坐标约定：应用内部为屏幕坐标（Y 向下），DXF 为世界坐标（Y 向上）。
 * 导出时统一取反 Y，导入时再次取反，保证与外部 CAD 的视觉方向一致，
 * 同时应用内的往返导出/导入保持几何不变。
 */

import { CADElement, Point } from '../types';

const uid = () => Math.random().toString(36).substr(2, 9);

/** $INSUNITS = 4 → 毫米；应用当前默认单位为 mm */
const INSUNITS_MM = 4;

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
        out += `10\n${num(point.x)}\n20\n${num(point.y)}\n`;
    });
    return out;
};

/**
 * 导出 DXF。
 * Y 轴取反以匹配 DXF 世界坐标；图层与 LTYPE 表一并写入。
 */
export const exportToDXF = (elements: CADElement[]): string => {
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
    dxf += `9\n$INSUNITS\n70\n${INSUNITS_MM}\n`;
    dxf += '9\n$MEASUREMENT\n70\n1\n';
    dxf += `9\n$EXTMIN\n10\n${num(extMinX)}\n20\n${num(extMinY)}\n30\n0\n`;
    dxf += `9\n$EXTMAX\n10\n${num(extMaxX)}\n20\n${num(extMaxY)}\n30\n0\n`;
    dxf += '0\nENDSEC\n';

    dxf += buildTables(elements);
    dxf += '0\nSECTION\n2\nBLOCKS\n0\nENDSEC\n';
    dxf += '0\nSECTION\n2\nENTITIES\n';

    elements.forEach((el) => {
        const layer = el.layer || '0';
        const color = el.color || DEFAULT_COLOR;

        if (el.type === 'LINE' && el.start && el.end) {
            const start = dxfPoint(el.start);
            const end = dxfPoint(el.end);
            dxf += entityHeader('LINE', layer, color);
            dxf += `10\n${num(start.x)}\n20\n${num(start.y)}\n11\n${num(end.x)}\n21\n${num(end.y)}\n`;
        } else if (el.type === 'CIRCLE' && el.center && el.radius) {
            const center = dxfPoint(el.center);
            dxf += entityHeader('CIRCLE', layer, color);
            dxf += `10\n${num(center.x)}\n20\n${num(center.y)}\n40\n${num(el.radius)}\n`;
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
            ], true);
        } else if (el.type === 'TEXT' && el.start && el.text) {
            const start = dxfPoint(el.start);
            const safeText = el.text.replace(/\r?\n/g, ' ');
            dxf += entityHeader('TEXT', layer, color);
            dxf += `10\n${num(start.x)}\n20\n${num(start.y)}\n30\n0\n40\n${num(el.fontSize || 12)}\n1\n${safeText}\n`;
        } else if (el.type === 'LWPOLYLINE' && el.points) {
            dxf += writePolyline(layer, color, el.points, Boolean(el.closed));
        } else if (el.type === 'ARC' && el.center && el.radius && el.startAngle !== undefined && el.endAngle !== undefined) {
            // 屏幕上顺时针(θ 增大)对应 DXF 的顺时针；DXF ARC 固定逆时针绘制
            const startScreen = normalizeAngle(el.startAngle);
            const endScreen = normalizeAngle(el.endAngle);
            const dxfStart = el.clockwise ? -endScreen : -startScreen;
            const dxfEnd = el.clockwise ? -startScreen : -endScreen;
            const center = dxfPoint(el.center);
            dxf += entityHeader('ARC', layer, color);
            dxf += `10\n${num(center.x)}\n20\n${num(center.y)}\n40\n${num(el.radius)}\n`;
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
            dxf += `10\n${num(center.x)}\n20\n${num(center.y)}\n30\n0\n`;
            dxf += `11\n${num(majorX)}\n21\n${num(majorY)}\n31\n0\n`;
            dxf += `40\n${num(minor / major)}\n41\n0\n42\n${num(Math.PI * 2)}\n`;
        } else if (
            (el.type === 'GEAR' || el.type === 'SPIRAL' || el.type === 'SPRING') &&
            el.points &&
            el.points.length > 1
        ) {
            // 高级曲线以多段线输出，外部 CAD 可直接查看/编辑
            dxf += writePolyline(layer, color, el.points, el.type === 'GEAR');
        }
        // DIMENSION 暂不适配 DXF 标注样式
    });

    dxf += '0\nENDSEC\n0\nEOF';
    return dxf;
};

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

interface PendingEntity {
    type: string;
    layer: string;
    points: Point[];
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    radius?: number;
    measure?: number;
    text?: string;
    startAngle?: number;
    endAngle?: number;
    closed?: boolean;
    aci?: number;
    trueColor?: number;
    majorX?: number;
    majorY?: number;
    ratio?: number;
}

const SUPPORTED_ENTITIES = new Set([
    'LINE',
    'CIRCLE',
    'LWPOLYLINE',
    'TEXT',
    'ARC',
    'ELLIPSE',
]);

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

/** 解析 DXF 文本为应用图元；Y 取反，角度与方向同步翻转 */
export const parseDXF = (dxfContent: string): CADElement[] => {
    const pairs = tokenize(dxfContent);
    const elements: CADElement[] = [];
    const layerColors = new Map<string, string>();

    let section = '';
    let tableName = '';
    let pendingLayer: PendingLayer | null = null;
    let entity: PendingEntity | null = null;

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
        const parsed = finalizeEntity(entity, resolveColor);
        if (parsed) elements.push(parsed);
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
            if (section === 'ENTITIES' && SUPPORTED_ENTITIES.has(value)) {
                entity = { type: value, layer: '0', points: [] };
            }
            continue;
        }

        if (section === 'TABLES' && tableName === 'LAYER' && pendingLayer) {
            if (code === 2) pendingLayer.name = value;
            else if (code === 62) pendingLayer.aci = Number.parseInt(value, 10);
            else if (code === 420) pendingLayer.trueColor = Number.parseInt(value, 10);
            continue;
        }

        if (section === 'ENTITIES' && entity) {
            parseEntityProp(entity, code, value);
        }
    }

    flushEntity();
    flushLayer();
    return elements;
};

function parseEntityProp(entity: PendingEntity, code: number, value: string) {
    const val = Number.parseFloat(value);
    switch (code) {
        case 8:
            entity.layer = value || '0';
            break;
        case 10:
            entity.x1 = val;
            if (entity.type === 'LWPOLYLINE') entity.points.push({ x: val, y: 0 });
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
        case 40:
            if (entity.type === 'ELLIPSE') entity.ratio = val;
            else entity.measure = val;
            break;
        case 41:
            // 椭圆起始参数，当前按整椭圆导入
            break;
        case 42:
            // 椭圆终止参数，当前按整椭圆导入
            break;
        case 50:
            entity.startAngle = val;
            break;
        case 51:
            entity.endAngle = val;
            break;
        case 1:
            entity.text = value;
            break;
        case 62:
            entity.aci = Number.parseInt(value, 10);
            break;
        case 70:
            entity.closed = (Number.parseInt(value, 10) & 1) === 1;
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

function finalizeEntity(
    entity: PendingEntity,
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
            text: entity.text || 'Text',
            fontSize: entity.measure || 12,
        };
    }
    if (entity.type === 'LWPOLYLINE') {
        let points = entity.points.map(screenPoint);
        if (entity.closed && points.length > 1) {
            const first = points[0];
            const last = points[points.length - 1];
            if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
                points = points.slice(0, -1);
            }
        }
        return { ...base, type: 'LWPOLYLINE', points, closed: Boolean(entity.closed) };
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
    return null;
}
