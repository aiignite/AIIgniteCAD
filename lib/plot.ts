/**
 * plot.ts — 图框 / 打印布局的纯计算
 *
 * 坐标约定：图纸尺寸用毫米，绘图内容用世界单位。
 * 比例尺 scale 表示“每世界单位对应多少毫米图纸”，即 1:N 时 scale = 1/N。
 * 所有函数不依赖 React 与 DOM，便于单测和预览复用。
 */

import { CADElement } from "../types";
import { BoundingBox, getElementBoundingBox } from "./geometry";
import { unionBounds } from "./viewport";

export type PaperSizeId = "A4" | "A3" | "A2" | "A1" | "A0" | "LETTER";
export type PlotOrientation = "portrait" | "landscape";
export type PlotScaleMode = "fit" | "fixed";

export interface PaperDefinition {
    label: string;
    widthMm: number;
    heightMm: number;
}

/** ISO A 系列按短边 × 长边定义，LETTER 使用美国标准 */
export const PAPER_SIZES: Record<PaperSizeId, PaperDefinition> = {
    A4: { label: "A4", widthMm: 210, heightMm: 297 },
    A3: { label: "A3", widthMm: 297, heightMm: 420 },
    A2: { label: "A2", widthMm: 420, heightMm: 594 },
    A1: { label: "A1", widthMm: 594, heightMm: 841 },
    A0: { label: "A0", widthMm: 841, heightMm: 1189 },
    LETTER: { label: "Letter", widthMm: 215.9, heightMm: 279.4 },
};

export type PaperSizeOption = PaperSizeId;

export const PAPER_SIZE_OPTIONS: PaperSizeOption[] = [
    "A4",
    "A3",
    "A2",
    "A1",
    "A0",
    "LETTER",
];

/** 常用机械制图比例分母 */
export const SCALE_DENOMINATORS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/** 标题栏高度（毫米），大图纸上保持不变以接近制图惯例 */
export const TITLE_BLOCK_HEIGHT_MM = 32;
export const DEFAULT_PLOT_MARGIN_MM = 10;
export const MIN_PLOT_MARGIN_MM = 5;
export const MAX_PLOT_MARGIN_MM = 30;
/** 默认线宽（毫米），打印时换算成世界单位 */
export const PLOT_LINE_WEIGHT_MM = 0.25;
/** 虚线图案单位换算到纸面的毫米数，保持 1:100 出图时虚线仍清晰可见 */
export const PLOT_DASH_UNIT_MM = 0.35;
/** 适配模式四周留白比例，避免图形贴边 */
export const FIT_PADDING_RATIO = 0.02;

export interface PlotSettings {
    paper: PaperSizeId;
    orientation: PlotOrientation;
    scaleMode: PlotScaleMode;
    /** 固定比例 1:N 中的 N */
    scaleDenominator: number;
    marginMm: number;
    titleBlock: boolean;
    /** 单色输出：白纸黑线 */
    monochrome: boolean;
    title: string;
    drawingNumber: string;
    author: string;
    date: string;
}

export interface PlotRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PlotLayout {
    paper: { widthMm: number; heightMm: number };
    drawingArea: PlotRect;
    titleBlockArea: PlotRect | null;
    /** 绘图区对应的世界坐标视口 */
    viewBox: { x: number; y: number; w: number; h: number };
    /** 每世界单位对应的图纸毫米数；1:N 时为 1/N */
    scale: number;
    contentBounds: BoundingBox;
    /** 固定比例下内容超出绘图区 */
    overflow: boolean;
}

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

/** 应用纸张方向，返回实际宽高（毫米） */
export function getPaperDimensionsMm(
    paper: PaperSizeId,
    orientation: PlotOrientation,
): { widthMm: number; heightMm: number } {
    const definition = PAPER_SIZES[paper] ?? PAPER_SIZES.A4;
    return orientation === "landscape"
        ? { widthMm: definition.heightMm, heightMm: definition.widthMm }
        : { widthMm: definition.widthMm, heightMm: definition.heightMm };
}

/** 空图纸使用默认 800×600 视口，保证预览与比例尺可读 */
const EMPTY_CONTENT_BOUNDS: BoundingBox = {
    minX: 0,
    minY: 0,
    maxX: 800,
    maxY: 600,
};

/** 计算内容包围盒；过滤退化图元后为空时回退到默认视口 */
export function getPlotContentBounds(elements: CADElement[]): BoundingBox {
    if (elements.length === 0) return { ...EMPTY_CONTENT_BOUNDS };
    const bounds = unionBounds(elements.map(getElementBoundingBox));
    if (!bounds) return { ...EMPTY_CONTENT_BOUNDS };
    return bounds;
}

/** 根据纸张、边距、标题栏与比例计算绘图区与世界视口 */
export function computePlotLayout(
    elements: CADElement[],
    settings: PlotSettings,
): PlotLayout {
    const paper = getPaperDimensionsMm(settings.paper, settings.orientation);
    const maxMargin = Math.min(paper.widthMm, paper.heightMm) / 4;
    const margin = clamp(settings.marginMm, 0, maxMargin);

    const innerWidth = Math.max(paper.widthMm - margin * 2, 1);
    const innerHeight = Math.max(paper.heightMm - margin * 2, 1);

    const titleBlockHeight = settings.titleBlock
        ? Math.min(TITLE_BLOCK_HEIGHT_MM, innerHeight * 0.35)
        : 0;

    const drawingArea: PlotRect = {
        x: margin,
        y: margin,
        width: innerWidth,
        height: Math.max(innerHeight - titleBlockHeight, 1),
    };

    const titleBlockArea: PlotRect | null = settings.titleBlock
        ? {
              x: margin,
              y: margin + drawingArea.height,
              width: innerWidth,
              height: titleBlockHeight,
          }
        : null;

    const contentBounds = getPlotContentBounds(elements);
    const contentWidth = Math.max(
        contentBounds.maxX - contentBounds.minX,
        1e-6,
    );
    const contentHeight = Math.max(
        contentBounds.maxY - contentBounds.minY,
        1e-6,
    );

    let scale: number;
    if (settings.scaleMode === "fixed") {
        const denominator = clamp(settings.scaleDenominator, 0.001, 1e6);
        scale = 1 / denominator;
    } else {
        const usableWidth = drawingArea.width * (1 - FIT_PADDING_RATIO * 2);
        const usableHeight = drawingArea.height * (1 - FIT_PADDING_RATIO * 2);
        scale = Math.min(
            usableWidth / contentWidth,
            usableHeight / contentHeight,
        );
        if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    }

    const viewBox = {
        x: (contentBounds.minX + contentBounds.maxX) / 2 - drawingArea.width / scale / 2,
        y: (contentBounds.minY + contentBounds.maxY) / 2 - drawingArea.height / scale / 2,
        w: drawingArea.width / scale,
        h: drawingArea.height / scale,
    };

    const overflow =
        settings.scaleMode === "fixed" &&
        (contentWidth > viewBox.w + 1e-9 || contentHeight > viewBox.h + 1e-9);

    return {
        paper,
        drawingArea,
        titleBlockArea,
        viewBox,
        scale,
        contentBounds,
        overflow,
    };
}

const formatRatioNumber = (value: number): string => {
    const rounded = value >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
    return String(rounded);
};

/** 将 scale 格式化为 CAD 比例：1:100、2:1 等 */
export function formatPlotScale(scale: number): string {
    if (!Number.isFinite(scale) || scale <= 0) return "—";
    const denominator = 1 / scale;
    if (denominator >= 1) {
        return `1:${formatRatioNumber(denominator)}`;
    }
    return `${formatRatioNumber(1 / denominator)}:1`;
}

/** 默认标题取工程文件名（去掉扩展名） */
export function defaultPlotTitle(projectName: string | undefined): string {
    if (!projectName) return "Untitled";
    return projectName.replace(/\.[^.]+$/, "");
}

export function createDefaultPlotSettings(
    overrides: Partial<PlotSettings> = {},
): PlotSettings {
    return {
        paper: "A3",
        orientation: "landscape",
        scaleMode: "fit",
        scaleDenominator: 100,
        marginMm: DEFAULT_PLOT_MARGIN_MM,
        titleBlock: true,
        monochrome: true,
        title: "",
        drawingNumber: "",
        author: "",
        date: new Date().toISOString().slice(0, 10),
        ...overrides,
    };
}
