/**
 * MiniMap.tsx — 右下角迷你导航图
 *
 * 示意全部可显示图元与当前视口；点击或拖拽导航图即把视口移到对应位置。
 * 导航图只读视口，不产生撤销步骤。
 */

import React, { useEffect, useMemo, useRef } from "react";
import type { CADElement, Point } from "../types";
import type { ViewBox } from "../lib/viewport";
import {
    miniMapToWorld,
    minimapBounds,
    minimapShapes,
    minimapTransform,
    worldToMiniMap,
    type MiniMapSize,
} from "../lib/minimap";

const SIZE: MiniMapSize = { width: 180, height: 120 };

interface MiniMapProps {
    /** 参与导航的图元（调用方只传可显示的图元） */
    elements: CADElement[];
    /** 当前视口 */
    viewBox: ViewBox;
    /** 把视口中心移动到指定世界坐标 */
    onCenter: (point: Point) => void;
}

export const MiniMap: React.FC<MiniMapProps> = ({ elements, viewBox, onCenter }) => {
    const dragging = useRef(false);

    const bounds = useMemo(() => minimapBounds(elements), [elements]);
    const transform = useMemo(
        () =>
            bounds
                ? minimapTransform(bounds, SIZE)
                : { scale: 1, offsetX: 0, offsetY: 0 },
        [bounds],
    );
    const shapes = useMemo(() => minimapShapes(elements), [elements]);

    // 在导航图外松开鼠标也要结束拖拽，否则视口会一直跟着走
    useEffect(() => {
        const stop = () => {
            dragging.current = false;
        };
        window.addEventListener("mouseup", stop);
        return () => window.removeEventListener("mouseup", stop);
    }, []);

    /** 鼠标位置（导航图用户坐标）对应的世界坐标 */
    const toWorld = (event: React.MouseEvent<SVGSVGElement>): Point => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
        const px = ((event.clientX - rect.left) / rect.width) * SIZE.width;
        const py = ((event.clientY - rect.top) / rect.height) * SIZE.height;
        return miniMapToWorld({ x: px, y: py }, transform);
    };

    const handleMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
        event.preventDefault();
        event.stopPropagation();
        dragging.current = true;
        onCenter(toWorld(event));
    };

    const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
        if (!dragging.current) return;
        onCenter(toWorld(event));
    };

    const viewportTopLeft = worldToMiniMap({ x: viewBox.x, y: viewBox.y }, transform);
    const viewportBottomRight = worldToMiniMap(
        { x: viewBox.x + viewBox.w, y: viewBox.y + viewBox.h },
        transform,
    );

    return (
        <div
            data-action="minimap"
            className="absolute bottom-4 right-4 z-10 select-none rounded border border-cad-border bg-cad-panel/90 backdrop-blur shadow-lg"
        >
            <svg
                width={SIZE.width}
                height={SIZE.height}
                viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                style={{ cursor: "crosshair", display: "block" }}
            >
                {shapes.map((entry) => {
                    const { shape } = entry;
                    if (shape.kind === "line") {
                        const from = worldToMiniMap(shape.from, transform);
                        const to = worldToMiniMap(shape.to, transform);
                        return (
                            <line
                                key={entry.id}
                                x1={from.x}
                                y1={from.y}
                                x2={to.x}
                                y2={to.y}
                                stroke="var(--cad-muted)"
                                strokeWidth={1}
                            />
                        );
                    }
                    if (shape.kind === "circle") {
                        const center = worldToMiniMap(shape.center, transform);
                        return (
                            <circle
                                key={entry.id}
                                cx={center.x}
                                cy={center.y}
                                r={shape.radius * transform.scale}
                                fill="none"
                                stroke="var(--cad-muted)"
                                strokeWidth={1}
                            />
                        );
                    }
                    if (shape.kind === "polyline") {
                        const points = shape.points
                            .map((point) => {
                                const mapped = worldToMiniMap(point, transform);
                                return `${mapped.x},${mapped.y}`;
                            })
                            .join(" ");
                        return (
                            <polyline
                                key={entry.id}
                                points={points}
                                fill="none"
                                stroke="var(--cad-muted)"
                                strokeWidth={1}
                            />
                        );
                    }
                    const topLeft = worldToMiniMap(
                        { x: shape.box.minX, y: shape.box.minY },
                        transform,
                    );
                    const bottomRight = worldToMiniMap(
                        { x: shape.box.maxX, y: shape.box.maxY },
                        transform,
                    );
                    return (
                        <rect
                            key={entry.id}
                            x={topLeft.x}
                            y={topLeft.y}
                            width={Math.max(bottomRight.x - topLeft.x, 0.5)}
                            height={Math.max(bottomRight.y - topLeft.y, 0.5)}
                            fill="none"
                            stroke="var(--cad-muted)"
                            strokeWidth={1}
                        />
                    );
                })}

                {/* 当前视口矩形 */}
                <rect
                    data-action="minimap-viewport"
                    x={viewportTopLeft.x}
                    y={viewportTopLeft.y}
                    width={Math.max(viewportBottomRight.x - viewportTopLeft.x, 1)}
                    height={Math.max(viewportBottomRight.y - viewportTopLeft.y, 1)}
                    fill="rgba(19,127,236,0.12)"
                    stroke="#137fec"
                    strokeWidth={1}
                />
            </svg>
        </div>
    );
};
