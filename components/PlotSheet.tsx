/**
 * PlotSheet.tsx — 图框 / 打印图纸渲染
 *
 * 使用毫米坐标绘制纸张、内边框、标题栏与按比例缩放的世界坐标视口。
 * 同一组件同时用于屏幕预览与打印输出，保证所见即所得。
 */

import React, { useMemo } from "react";
import { CADElement, DrawingSettings } from "../types";
import {
    computePlotLayout,
    formatPlotScale,
    PAPER_SIZES,
    PLOT_LINE_WEIGHT_MM,
    PlotRect,
    PlotSettings,
} from "../lib/plot";
import CADElementRenderer, {
    CADElementRenderOverrides,
} from "./CADElementRenderer";

export interface PlotSheetProps {
    elements: CADElement[];
    settings: PlotSettings;
    drawingSettings: DrawingSettings;
    projectName?: string;
    className?: string;
    id?: string;
    style?: React.CSSProperties;
}

const truncate = (value: string, maxLength: number): string =>
    value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

const LABEL_COLOR = "#444444";

interface TitleBlockProps {
    area: PlotRect;
    settings: PlotSettings;
    projectName: string;
    scaleLabel: string;
}

/** 右下角标题栏：左侧图纸标题，右侧图号 / 比例 / 图幅 / 日期 */
const TitleBlock: React.FC<TitleBlockProps> = ({
    area,
    settings,
    projectName,
    scaleLabel,
}) => {
    const rightWidth = Math.min(95, area.width * 0.42);
    const splitX = area.x + area.width - rightWidth;
    const rows = [
        { label: "DRAWING NO.", value: settings.drawingNumber || "—" },
        { label: "SCALE", value: scaleLabel },
        {
            label: "SHEET",
            value: `${PAPER_SIZES[settings.paper]?.label ?? settings.paper} · ${
                settings.orientation === "landscape" ? "Landscape" : "Portrait"
            }`,
        },
        { label: "DATE", value: settings.date || "—" },
    ];
    const rowHeight = area.height / rows.length;

    return (
        <g>
            <rect
                x={area.x}
                y={area.y}
                width={area.width}
                height={area.height}
                fill="#ffffff"
                stroke="#000000"
                strokeWidth={0.35}
            />
            <line
                x1={splitX}
                y1={area.y}
                x2={splitX}
                y2={area.y + area.height}
                stroke="#000000"
                strokeWidth={0.35}
            />

            <text
                x={area.x + 4}
                y={area.y + 5.5}
                fill={LABEL_COLOR}
                fontSize={2.2}
                fontFamily="Arial, 'Noto Sans SC', sans-serif"
                letterSpacing={0.3}
            >
                DRAWING TITLE
            </text>
            <text
                x={area.x + 4}
                y={area.y + 12.5}
                fill="#000000"
                fontSize={4.6}
                fontWeight="bold"
                fontFamily="Arial, 'Noto Sans SC', sans-serif"
            >
                {truncate(settings.title || projectName || "Untitled", 42)}
            </text>
            <text
                x={area.x + 4}
                y={area.y + 18.5}
                fill="#000000"
                fontSize={2.8}
                fontFamily="Arial, 'Noto Sans SC', sans-serif"
            >
                {truncate(projectName, 64)}
            </text>
            <text
                x={area.x + 4}
                y={area.y + area.height - 4}
                fill={LABEL_COLOR}
                fontSize={2.4}
                fontFamily="Arial, 'Noto Sans SC', sans-serif"
            >
                AUTHOR: {truncate(settings.author || "—", 32)}
            </text>

            {rows.map((row, index) => {
                const rowY = area.y + index * rowHeight;
                return (
                    <g key={row.label}>
                        {index > 0 && (
                            <line
                                x1={splitX}
                                y1={rowY}
                                x2={area.x + area.width}
                                y2={rowY}
                                stroke="#000000"
                                strokeWidth={0.25}
                            />
                        )}
                        <text
                            x={splitX + 3}
                            y={rowY + 3.2}
                            fill={LABEL_COLOR}
                            fontSize={2}
                            fontFamily="Arial, 'Noto Sans SC', sans-serif"
                            letterSpacing={0.2}
                        >
                            {row.label}
                        </text>
                        <text
                            x={splitX + 3}
                            y={rowY + 7}
                            fill="#000000"
                            fontSize={3.1}
                            fontFamily="Arial, 'Noto Sans SC', sans-serif"
                        >
                            {truncate(row.value, 30)}
                        </text>
                    </g>
                );
            })}
        </g>
    );
};

const PlotSheet: React.FC<PlotSheetProps> = ({
    elements,
    settings,
    drawingSettings,
    projectName = "Untitled",
    className,
    id,
    style,
}) => {
    const layout = useMemo(
        () => computePlotLayout(elements, settings),
        [elements, settings],
    );
    const scaleLabel = formatPlotScale(layout.scale);
    const lineWidthWorld = PLOT_LINE_WEIGHT_MM / layout.scale;
    const overrides = useMemo<CADElementRenderOverrides>(
        () => ({
            monochrome: settings.monochrome,
            strokeWidth: lineWidthWorld,
            nonScalingStroke: false,
        }),
        [settings.monochrome, lineWidthWorld],
    );

    const { paper, drawingArea, titleBlockArea, viewBox } = layout;
    const margin = drawingArea.x;

    return (
        <svg
            id={id}
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 0 ${paper.widthMm} ${paper.heightMm}`}
            width={`${paper.widthMm}mm`}
            height={`${paper.heightMm}mm`}
            className={className}
            style={{ backgroundColor: "#ffffff", ...style }}
            role="img"
            aria-label={`Plot sheet ${PAPER_SIZES[settings.paper]?.label ?? settings.paper}, ${scaleLabel}`}
        >
            <rect
                x={0}
                y={0}
                width={paper.widthMm}
                height={paper.heightMm}
                fill="#ffffff"
            />

            <rect
                x={margin}
                y={margin}
                width={paper.widthMm - margin * 2}
                height={paper.heightMm - margin * 2}
                fill="none"
                stroke="#000000"
                strokeWidth={0.5}
            />

            <svg
                x={drawingArea.x}
                y={drawingArea.y}
                width={drawingArea.width}
                height={drawingArea.height}
                viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
                preserveAspectRatio="xMidYMid meet"
            >
                <g data-plot-elements="true">
                    {elements.map((element) => (
                        <CADElementRenderer
                            key={element.id}
                            element={element}
                            isSelected={false}
                            dimScale={drawingSettings.dimScale}
                            dimPrecision={drawingSettings.dimPrecision}
                            overrides={overrides}
                        />
                    ))}
                </g>
            </svg>

            {titleBlockArea && (
                <TitleBlock
                    area={titleBlockArea}
                    settings={settings}
                    projectName={projectName}
                    scaleLabel={scaleLabel}
                />
            )}
        </svg>
    );
};

export default React.memo(PlotSheet);
