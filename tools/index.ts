/**
 * tools/index.ts — 工具注册表
 *
 * 将 ToolType 映射到具体的画布工具状态机；未注册的工具（PAN/ARRAY）由
 * useCanvasInteraction 本身或参数弹窗处理。
 */

import { ToolType } from "../types";
import type { CanvasTool } from "./BaseTool";
import AdvancedShapeTool from "./AdvancedShapeTool";
import ArcTool from "./ArcTool";
import CircleTool from "./CircleTool";
import CopyTool from "./CopyTool";
import DimensionTool from "./DimensionTool";
import HatchTool from "./HatchTool";
import LineTool from "./LineTool";
import MeasureTool from "./MeasureTool";
import MirrorTool from "./MirrorTool";
import OffsetTool from "./OffsetTool";
import PolylineTool from "./PolylineTool";
import RectangleTool from "./RectangleTool";
import RotateTool from "./RotateTool";
import ScaleTool from "./ScaleTool";
import SelectTool from "./SelectTool";
import TextTool from "./TextTool";
import TrimTool from "./TrimTool";

const TOOL_REGISTRY: Partial<Record<ToolType, CanvasTool>> = {
    [ToolType.SELECT]: SelectTool,
    [ToolType.LINE]: LineTool,
    [ToolType.CIRCLE]: CircleTool,
    [ToolType.RECTANGLE]: RectangleTool,
    [ToolType.TEXT]: TextTool,
    [ToolType.POLYLINE]: PolylineTool,
    [ToolType.ARC]: ArcTool,
    [ToolType.HATCH]: HatchTool,
    [ToolType.COPY]: CopyTool,
    [ToolType.TRIM]: TrimTool,
    [ToolType.MIRROR]: MirrorTool,
    [ToolType.ROTATE]: RotateTool,
    [ToolType.SCALE]: ScaleTool,
    [ToolType.OFFSET]: OffsetTool,
    [ToolType.DIMENSION]: DimensionTool,
    [ToolType.MEASURE]: MeasureTool,
    [ToolType.GEAR]: AdvancedShapeTool,
    [ToolType.INVOLUTE]: AdvancedShapeTool,
    [ToolType.SPIRAL]: AdvancedShapeTool,
    [ToolType.SPRING]: AdvancedShapeTool,
    [ToolType.POLYGON]: AdvancedShapeTool,
    [ToolType.ELLIPSE]: AdvancedShapeTool,
};

export function getTool(tool: ToolType): CanvasTool | undefined {
    return TOOL_REGISTRY[tool];
}
