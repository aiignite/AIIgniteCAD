#!/usr/bin/env node
/**
 * generate-examples.mjs — 生成可导入的示例 DXF
 *
 * 复用与 services/dxfService.ts 相同的组码约定：应用坐标 Y 向下，写入 DXF 时取反。
 * 产物位于 examples/，通过 `node scripts/generate-examples.mjs` 可重复生成。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "examples");
mkdirSync(outDir, { recursive: true });

const num = (value) => {
    const rounded = Math.round(value * 1e6) / 1e6;
    return String(rounded);
};

const colorFields = (hex) => {
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `62\n7\n420\n${(r << 16) | (g << 8) | b}\n`;
};

const dxfPoint = (point) => ({ x: point.x, y: -point.y });

const entities = [];

function line(layer, color, start, end) {
    const a = dxfPoint(start);
    const b = dxfPoint(end);
    entities.push(
        `0\nLINE\n8\n${layer}\n${colorFields(color)}10\n${num(a.x)}\n20\n${num(a.y)}\n11\n${num(b.x)}\n21\n${num(b.y)}\n`,
    );
}

function circle(layer, color, center, radius) {
    const c = dxfPoint(center);
    entities.push(
        `0\nCIRCLE\n8\n${layer}\n${colorFields(color)}10\n${num(c.x)}\n20\n${num(c.y)}\n40\n${num(radius)}\n`,
    );
}

function polyline(layer, color, points, closed = false) {
    const pts = points.map(dxfPoint);
    if (closed && pts.length > 1) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) pts.pop();
    }
    let out = `0\nLWPOLYLINE\n8\n${layer}\n${colorFields(color)}90\n${pts.length}\n70\n${closed ? 1 : 0}\n`;
    for (const point of pts) out += `10\n${num(point.x)}\n20\n${num(point.y)}\n`;
    entities.push(out);
}

function arc(layer, color, center, radius, startAngle, endAngle) {
    // 传入的是屏幕角度（Y 向下），转换到 DXF 的逆时针角度
    const c = dxfPoint(center);
    const normalize = (angle) => ((angle % 360) + 360) % 360;
    const start = normalize(-startAngle);
    const end = normalize(-endAngle);
    entities.push(
        `0\nARC\n8\n${layer}\n${colorFields(color)}10\n${num(c.x)}\n20\n${num(c.y)}\n40\n${num(radius)}\n50\n${num(start)}\n51\n${num(end)}\n`,
    );
}

function text(layer, color, start, content, height = 24) {
    const p = dxfPoint(start);
    entities.push(
        `0\nTEXT\n8\n${layer}\n${colorFields(color)}10\n${num(p.x)}\n20\n${num(p.y)}\n30\n0\n40\n${num(height)}\n1\n${content}\n`,
    );
}

function writeDxf(fileName) {
    const dxf = [
        "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1018\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n",
        "0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n",
        '0\nTABLE\n2\nLAYER\n70\n3\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n0\nLAYER\n2\nOUTLINE\n70\n0\n62\n5\n6\nCONTINUOUS\n0\nLAYER\n2\nDETAIL\n70\n0\n62\n3\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC\n',
        "0\nSECTION\n2\nENTITIES\n",
        ...entities,
        "0\nENDSEC\n0\nEOF",
    ].join("");
    writeFileSync(join(outDir, fileName), dxf, "utf8");
    console.log(`wrote examples/${fileName} (${(dxf.length / 1024).toFixed(1)} KB)`);
}

/* ── 1. 齿轮 ─────────────────────────────────────────────── */
{
    const teeth = 20;
    const rootRadius = 88;
    const tipRadius = 108;
    const points = [];
    for (let i = 0; i < teeth; i++) {
        const base = (i / teeth) * Math.PI * 2;
        const step = (Math.PI * 2) / teeth / 4;
        points.push({ x: Math.cos(base) * rootRadius, y: Math.sin(base) * rootRadius });
        points.push({
            x: Math.cos(base + step) * tipRadius,
            y: Math.sin(base + step) * tipRadius,
        });
        points.push({
            x: Math.cos(base + step * 2) * tipRadius,
            y: Math.sin(base + step * 2) * tipRadius,
        });
        points.push({
            x: Math.cos(base + step * 3) * rootRadius,
            y: Math.sin(base + step * 3) * rootRadius,
        });
    }
    polyline("OUTLINE", "#137fec", points, true);
    circle("OUTLINE", "#137fec", { x: 0, y: 0 }, 28);
    circle("DETAIL", "#4ade80", { x: 0, y: 0 }, 60);
    for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        circle("DETAIL", "#4ade80", {
            x: Math.cos(angle) * 60,
            y: Math.sin(angle) * 60,
        }, 10);
    }
    text("DETAIL", "#e6edf3", { x: -70, y: 150 }, "GEAR m=2 z=20", 20);
    writeDxf("gear.dxf");
    entities.length = 0;
}

/* ── 2. 弹簧（压缩弹簧的二维投影） ───────────────────────── */
{
    const coils = 12;
    const pitch = 40;
    const amplitude = 45;
    const points = [];
    for (let i = 0; i <= coils * 24; i++) {
        const t = i / 24;
        points.push({
            x: t * pitch,
            y: amplitude * Math.sin(t * Math.PI * 2),
        });
    }
    polyline("OUTLINE", "#137fec", points);
    line("DETAIL", "#4ade80", { x: 0, y: -amplitude }, { x: 0, y: amplitude });
    line("DETAIL", "#4ade80", {
        x: coils * pitch,
        y: -amplitude,
    }, { x: coils * pitch, y: amplitude });
    text("DETAIL", "#e6edf3", { x: 40, y: amplitude + 40 }, "COMPRESSION SPRING", 18);
    writeDxf("spring.dxf");
    entities.length = 0;
}

/* ── 3. 建筑平面 ─────────────────────────────────────────── */
{
    const walls = "#e6edf3";
    // 外墙
    line("OUTLINE", walls, { x: 0, y: 0 }, { x: 800, y: 0 });
    line("OUTLINE", walls, { x: 800, y: 0 }, { x: 800, y: 560 });
    line("OUTLINE", walls, { x: 800, y: 560 }, { x: 0, y: 560 });
    line("OUTLINE", walls, { x: 0, y: 560 }, { x: 0, y: 0 });
    // 内墙：客厅 / 卧室 / 厨房
    line("OUTLINE", walls, { x: 460, y: 0 }, { x: 460, y: 360 });
    line("OUTLINE", walls, { x: 460, y: 360 }, { x: 800, y: 360 });
    line("OUTLINE", walls, { x: 200, y: 360 }, { x: 200, y: 560 });
    // 门洞与门扇
    arc("DETAIL", "#4ade80", { x: 460, y: 240 }, 80, 270, 360);
    line("DETAIL", "#4ade80", { x: 460, y: 240 }, { x: 540, y: 240 });
    arc("DETAIL", "#4ade80", { x: 200, y: 440 }, 70, 0, 90);
    line("DETAIL", "#4ade80", { x: 200, y: 440 }, { x: 200, y: 510 });
    // 窗
    line("DETAIL", "#38bdf8", { x: 560, y: 0 }, { x: 720, y: 0 });
    line("DETAIL", "#38bdf8", { x: 560, y: 12 }, { x: 720, y: 12 });
    // 家具示意
    line("DETAIL", walls, { x: 60, y: 60 }, { x: 300, y: 60 });
    line("DETAIL", walls, { x: 300, y: 60 }, { x: 300, y: 180 });
    line("DETAIL", walls, { x: 300, y: 180 }, { x: 60, y: 180 });
    line("DETAIL", walls, { x: 60, y: 180 }, { x: 60, y: 60 });
    circle("DETAIL", walls, { x: 560, y: 160 }, 60);
    text("DETAIL", "#e6edf3", { x: 120, y: 300 }, "LIVING", 28);
    text("DETAIL", "#e6edf3", { x: 520, y: 200 }, "BEDROOM", 28);
    text("DETAIL", "#e6edf3", { x: 60, y: 470 }, "KITCHEN", 28);
    text("DETAIL", "#4ade80", { x: 20, y: 600 }, "FLOOR PLAN 8000 x 5600 mm", 18);
    writeDxf("floor-plan.dxf");
}
