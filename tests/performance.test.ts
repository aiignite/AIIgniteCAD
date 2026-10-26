/**
 * performance.test.ts — 2000 元素的可复现渲染基准
 *
 * 记录首帧静态渲染耗时，以及连续平移 60 帧时的裁剪 + 命中测试预算。
 * 阈值按 50 FPS（每帧 20ms）设定；基准只覆盖渲染管线本身，
 * 不含浏览器合成与 GPU 绘制，因此结果是 FPS 的上界估计。
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CADElementRenderer from "../components/CADElementRenderer";
import type { CADElement } from "../types";
import { SpatialGrid } from "../lib/spatialIndex";
import { svgRenderer } from "../renderer/svgRenderer";
import { bufferedViewportBounds } from "../renderer/svgRenderer";

const ELEMENT_COUNT = 2000;
const FRAME_BUDGET_MS = 20;

/** 确定性伪随机，保证基准在不同机器上复现同一张图纸 */
function createRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0xffffffff;
    };
}

function buildDrawing(): CADElement[] {
    const random = createRandom(20261022);
    const elements: CADElement[] = [];
    for (let i = 0; i < ELEMENT_COUNT; i++) {
        if (i % 4 === 0) {
            elements.push({
                id: `bench-${i}`,
                type: "CIRCLE",
                center: { x: random() * 8000, y: random() * 6000 },
                radius: 5 + random() * 40,
                layer: "0",
                color: "#e6edf3",
            });
        } else {
            const x = random() * 8000;
            const y = random() * 6000;
            elements.push({
                id: `bench-${i}`,
                type: "LINE",
                start: { x, y },
                end: { x: x + 20 + random() * 120, y: y + 20 + random() * 120 },
                layer: "0",
                color: "#e6edf3",
            });
        }
    }
    return elements;
}

describe("2000 元素渲染基准", () => {
    it("首帧渲染与连续平移帧预算", () => {
        const elements = buildDrawing();

        const buildStart = performance.now();
        const grid = new SpatialGrid(elements);
        const buildMs = performance.now() - buildStart;

        const renderStart = performance.now();
        const markup = renderToStaticMarkup(
            React.createElement(
                "svg",
                { width: 1200, height: 900 },
                elements.map((element) =>
                    React.createElement(CADElementRenderer, {
                        key: element.id,
                        element,
                        isSelected: false,
                    }),
                ),
            ),
        );
        const firstFrameMs = performance.now() - renderStart;
        expect(markup.length).toBeGreaterThan(0);

        // 模拟平移 60 帧：每帧裁剪一次，并对视口中心做一次命中测试
        const frameTimes: number[] = [];
        for (let frame = 0; frame < 60; frame++) {
            const frameStart = performance.now();
            const viewport = {
                viewBox: { x: frame * 8, y: frame * 4, w: 1200, h: 900 },
                width: 1200,
                height: 900,
            };
            const bounds = bufferedViewportBounds(viewport);
            // 与 useCanvasInteraction 的可见元素计算保持一致：索引查询即精确裁剪
            const visible = grid.queryVisible(
                bounds.minX,
                bounds.minY,
                bounds.maxX,
                bounds.maxY,
            );
            svgRenderer.hitTestAll(
                { x: viewport.viewBox.x + 600, y: viewport.viewBox.y + 450 },
                visible,
                2,
            );
            frameTimes.push(performance.now() - frameStart);
        }

        const averageFrameMs =
            frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
        const estimatedFps = 1000 / Math.max(averageFrameMs, 0.001);

        console.log(
            `[benchmark] ${ELEMENT_COUNT} elements: index ${buildMs.toFixed(1)}ms, ` +
                `first frame ${firstFrameMs.toFixed(1)}ms, ` +
                `pan ${averageFrameMs.toFixed(2)}ms/frame (~${estimatedFps.toFixed(0)} FPS budget)`,
        );

        expect(averageFrameMs).toBeLessThan(FRAME_BUDGET_MS);
        expect(estimatedFps).toBeGreaterThanOrEqual(50);
    });

    it("10000 元素平移帧预算（索引查询 + 精确裁剪）", () => {
        const random = createRandom(20261026);
        const elements: CADElement[] = [];
        for (let i = 0; i < 10000; i++) {
            if (i % 4 === 0) {
                elements.push({
                    id: `big-${i}`,
                    type: "CIRCLE",
                    center: { x: random() * 12000, y: random() * 9000 },
                    radius: 5 + random() * 40,
                    layer: "0",
                    color: "#e6edf3",
                });
            } else {
                const x = random() * 12000;
                const y = random() * 9000;
                elements.push({
                    id: `big-${i}`,
                    type: "LINE",
                    start: { x, y },
                    end: { x: x + 20 + random() * 120, y: y + 20 + random() * 120 },
                    layer: "0",
                    color: "#e6edf3",
                });
            }
        }

        const buildStart = performance.now();
        const grid = new SpatialGrid(elements);
        const buildMs = performance.now() - buildStart;

        const frameTimes: number[] = [];
        let visibleTotal = 0;
        for (let frame = 0; frame < 60; frame++) {
            const frameStart = performance.now();
            const viewport = {
                viewBox: { x: frame * 30, y: frame * 15, w: 1200, h: 900 },
                width: 1200,
                height: 900,
            };
            const bounds = bufferedViewportBounds(viewport);
            const visible = grid.queryVisible(
                bounds.minX,
                bounds.minY,
                bounds.maxX,
                bounds.maxY,
            );
            visibleTotal += visible.length;
            frameTimes.push(performance.now() - frameStart);
        }

        const averageFrameMs =
            frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
        const estimatedFps = 1000 / Math.max(averageFrameMs, 0.001);

        console.log(
            `[benchmark] 10000 elements: index ${buildMs.toFixed(1)}ms, ` +
                `pan ${averageFrameMs.toFixed(2)}ms/frame (~${estimatedFps.toFixed(0)} FPS budget), ` +
                `avg visible ${(visibleTotal / 60).toFixed(0)}`,
        );

        // 索引构建是一次性成本，给 500ms 的宽松上限；帧预算仍按 50 FPS 约束
        expect(buildMs).toBeLessThan(500);
        expect(averageFrameMs).toBeLessThan(FRAME_BUDGET_MS);
        expect(visibleTotal).toBeGreaterThan(0);
    });
});
