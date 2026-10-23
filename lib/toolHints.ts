/**
 * toolHints.ts — 当前工具与下一步提示
 *
 * 画布顶部、状态栏、底栏曾各自维护一套提示，容易互相矛盾。
 * 这里统一成纯函数输出，状态栏是唯一展示位置。
 */

import type { DragMode } from "../types";
import { ToolType } from "../types";

/** 提示语言；默认中文 */
export type HintLocale = "zh" | "en";

export interface ToolHintInput {
    tool: ToolType;
    dragMode: DragMode | null;
    /** 是否已有第一点（直线/矩形/圆） */
    hasAnchor: boolean;
    polyCount: number;
    arcCount: number;
    dimCount: number;
    selectedCount: number;
}

export interface ToolHint {
    /** 工具名 */
    tool: string;
    /** 下一步操作提示 */
    next: string;
}

const TOOL_LABELS: Record<HintLocale, Record<ToolType, string>> = {
    zh: {
        [ToolType.SELECT]: "选择",
        [ToolType.PAN]: "平移",
        [ToolType.LINE]: "直线",
        [ToolType.POLYLINE]: "多段线",
        [ToolType.CIRCLE]: "圆",
        [ToolType.ARC]: "圆弧",
        [ToolType.RECTANGLE]: "矩形",
        [ToolType.TEXT]: "文字",
        [ToolType.HATCH]: "填充",
        [ToolType.COPY]: "复制",
        [ToolType.TRIM]: "修剪",
        [ToolType.EXTEND]: "延伸",
        [ToolType.MIRROR]: "镜像",
        [ToolType.ROTATE]: "旋转",
        [ToolType.SCALE]: "缩放",
        [ToolType.OFFSET]: "偏移",
        [ToolType.ARRAY]: "阵列",
        [ToolType.DIMENSION]: "标注",
        [ToolType.MEASURE]: "测量",
        [ToolType.GEAR]: "齿轮",
        [ToolType.INVOLUTE]: "渐开线",
        [ToolType.SPIRAL]: "螺旋",
        [ToolType.SPRING]: "弹簧",
        [ToolType.POLYGON]: "多边形",
        [ToolType.ELLIPSE]: "椭圆",
    },
    en: {
        [ToolType.SELECT]: "Select",
        [ToolType.PAN]: "Pan",
        [ToolType.LINE]: "Line",
        [ToolType.POLYLINE]: "Polyline",
        [ToolType.CIRCLE]: "Circle",
        [ToolType.ARC]: "Arc",
        [ToolType.RECTANGLE]: "Rectangle",
        [ToolType.TEXT]: "Text",
        [ToolType.HATCH]: "Hatch",
        [ToolType.COPY]: "Copy",
        [ToolType.TRIM]: "Trim",
        [ToolType.EXTEND]: "Extend",
        [ToolType.MIRROR]: "Mirror",
        [ToolType.ROTATE]: "Rotate",
        [ToolType.SCALE]: "Scale",
        [ToolType.OFFSET]: "Offset",
        [ToolType.ARRAY]: "Array",
        [ToolType.DIMENSION]: "Dimension",
        [ToolType.MEASURE]: "Measure",
        [ToolType.GEAR]: "Gear",
        [ToolType.INVOLUTE]: "Involute",
        [ToolType.SPIRAL]: "Spiral",
        [ToolType.SPRING]: "Spring",
        [ToolType.POLYGON]: "Polygon",
        [ToolType.ELLIPSE]: "Ellipse",
    },
};

const ADVANCED_TOOLS = new Set<ToolType>([
    ToolType.GEAR,
    ToolType.INVOLUTE,
    ToolType.SPIRAL,
    ToolType.SPRING,
    ToolType.POLYGON,
    ToolType.ELLIPSE,
]);

export function toolLabel(tool: ToolType, locale: HintLocale = "zh"): string {
    return TOOL_LABELS[locale][tool] ?? tool;
}

export function describeToolHint(
    input: ToolHintInput,
    locale: HintLocale = "zh",
): ToolHint {
    const { tool, dragMode, hasAnchor, polyCount, arcCount, dimCount, selectedCount } = input;
    const toolName = toolLabel(tool, locale);
    const next = (text: string): ToolHint => ({ tool: toolName, next: text });

    if (locale === "en") {
        switch (tool) {
            case ToolType.SELECT:
                if (selectedCount > 0) {
                    return next(
                        `${selectedCount} selected: drag to move, or edit with grips; Shift + click to add`,
                    );
                }
                return next(
                    "Click to select; drag right for a window selection, drag left for a crossing selection",
                );
            case ToolType.PAN:
                return next("Drag to pan the canvas; scroll to zoom at the cursor");
            case ToolType.LINE:
                return hasAnchor
                    ? next("Specify the next point: move, click, or type a length and press Enter")
                    : next(
                          "Specify the start point: drag, or click twice (the second click sets the end)",
                      );
            case ToolType.RECTANGLE:
                return hasAnchor
                    ? next(
                          "Specify the opposite corner: move, click, or type width/height and press Enter",
                      )
                    : next("Specify the first corner");
            case ToolType.CIRCLE:
                return hasAnchor
                    ? next("Specify the radius: move, click, or type a radius and press Enter")
                    : next("Specify the center");
            case ToolType.POLYLINE:
                return polyCount > 0
                    ? next(
                          `${polyCount} points: keep clicking or type a length, Enter to finish, Esc to cancel`,
                      )
                    : next("Specify the start point");
            case ToolType.ARC:
                if (arcCount === 0) return next("Specify the arc start point");
                if (arcCount === 1) return next("Specify the second point of the arc");
                return next("Specify the arc end point");
            case ToolType.DIMENSION:
                if (dimCount === 0) return next("Specify the dimension start point");
                if (dimCount === 1) {
                    return next("Specify the dimension end point: click or type a length and press Enter");
                }
                return next("Specify the dimension position");
            case ToolType.MEASURE:
                return dragMode === "MEASURE"
                    ? next("Release the mouse to finish measuring")
                    : next("Click the measurement start point");
            case ToolType.MIRROR:
                return dragMode === "MIRROR_LINE"
                    ? next("Specify the mirror line end: drag, or type an angle and press Enter")
                    : next("Specify the start of the mirror line");
            case ToolType.COPY:
                return next(
                    selectedCount > 0
                        ? "Drag the selection to the target position"
                        : "Select the objects to copy first",
                );
            case ToolType.ROTATE:
                return dragMode === "ROTATE_ITEMS"
                    ? next("Set the angle: drag, or type an angle and press Enter")
                    : next(
                          selectedCount > 0
                              ? "Click the base point, then drag to set the angle"
                              : "Select the objects to rotate first",
                      );
            case ToolType.SCALE:
                if (dragMode === "SCALE_ITEMS") {
                    return next("Move to set the factor, click to apply, or type a factor and press Enter");
                }
                return next(
                    selectedCount > 0 ? "Click the scale base point" : "Select the objects to scale first",
                );
            case ToolType.OFFSET:
                return next(
                    selectedCount > 0
                        ? "Click to offset, or type a distance first"
                        : "Select the objects to offset first",
                );
            case ToolType.TRIM:
                return next("Click the segment to trim away; other objects act as cutting edges");
            case ToolType.EXTEND:
                return next("Click the end to extend; it grows to the nearest boundary");
            case ToolType.ARRAY:
                return next("Set rows, columns and spacing in the dialog");
            case ToolType.TEXT:
                return next("Click to place the text");
            case ToolType.HATCH:
                return next("Click inside a closed region to hatch it");
            default:
                if (ADVANCED_TOOLS.has(tool)) {
                    return next("Click the insertion point and set parameters in the dialog");
                }
                return next("Click the canvas to start");
        }
    }

    switch (tool) {
        case ToolType.SELECT:
            if (selectedCount > 0) {
                return next(`已选 ${selectedCount} 个：拖拽移动，或用夹点编辑；Shift + 点击可加选`);
            }
            return next("点击选择；向右拖拽为窗口选择，向左拖拽为交叉选择");
        case ToolType.PAN:
            return next("拖拽平移画布；滚轮以光标为中心缩放");
        case ToolType.LINE:
            return hasAnchor
                ? next("指定下一点：移动光标、点击，或键入长度后回车")
                : next("指定起点：可拖拽，也可点击两次（第二次确定终点）");
        case ToolType.RECTANGLE:
            return hasAnchor
                ? next("指定对角点：移动光标、点击，或键入宽高后回车")
                : next("指定第一个角点");
        case ToolType.CIRCLE:
            return hasAnchor
                ? next("指定半径：移动光标、点击，或键入半径后回车")
                : next("指定圆心");
        case ToolType.POLYLINE:
            return polyCount > 0
                ? next(`已取 ${polyCount} 点：继续点击或键入长度，Enter 完成，Esc 取消`)
                : next("指定起点");
        case ToolType.ARC:
            if (arcCount === 0) return next("指定圆弧起点");
            if (arcCount === 1) return next("指定圆弧第二点");
            return next("指定圆弧端点");
        case ToolType.DIMENSION:
            if (dimCount === 0) return next("指定标注起点");
            if (dimCount === 1) return next("指定标注终点：点击或键入长度后回车");
            return next("指定标注位置");
        case ToolType.MEASURE:
            return dragMode === "MEASURE" ? next("松开鼠标完成测量") : next("点击测量起点");
        case ToolType.MIRROR:
            return dragMode === "MIRROR_LINE"
                ? next("指定镜像线终点：拖拽，或键入角度后回车")
                : next("指定镜像线起点");
        case ToolType.COPY:
            return next(selectedCount > 0 ? "拖拽所选对象到目标位置" : "先选中要复制的对象");
        case ToolType.ROTATE:
            return dragMode === "ROTATE_ITEMS"
                ? next("确定角度：拖拽，或键入角度后回车")
                : next(selectedCount > 0 ? "点击基点，再拖拽确定角度" : "先选中要旋转的对象");
        case ToolType.SCALE:
            if (dragMode === "SCALE_ITEMS") return next("移动光标确定倍率、点击应用，或键入倍率后回车");
            return next(selectedCount > 0 ? "点击缩放基点" : "先选中要缩放的对象");
        case ToolType.OFFSET:
            return next(selectedCount > 0 ? "点击完成偏移，或先键入距离" : "先选中要偏移的对象");
        case ToolType.TRIM:
            return next("点击要剪掉的线段，其余图元即为剪切边界");
        case ToolType.EXTEND:
            return next("点击要延伸的端点，延伸到最近的边界");
        case ToolType.ARRAY:
            return next("在弹窗中设置行列与间距");
        case ToolType.TEXT:
            return next("点击放置文字");
        case ToolType.HATCH:
            return next("点击闭合区域内部进行填充");
        default:
            if (ADVANCED_TOOLS.has(tool)) return next("点击插入位置并在弹窗中设置参数");
            return next("点击画布开始");
    }
}
