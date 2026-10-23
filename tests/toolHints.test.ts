/**
 * toolHints.test.ts — lib/toolHints.ts 单元测试
 *
 * 状态栏是唯一的提示位置，因此要求每个工具都有中文工具名与"下一步"文案，
 * 并校验多点工具随已取点数推进。
 */

import { describe, expect, it } from "vitest";
import { ToolType } from "../types";
import { describeToolHint, toolLabel, type ToolHintInput } from "../lib/toolHints";

const input = (partial: Partial<ToolHintInput> = {}): ToolHintInput => ({
    tool: ToolType.SELECT,
    dragMode: null,
    hasAnchor: false,
    polyCount: 0,
    arcCount: 0,
    dimCount: 0,
    selectedCount: 0,
    ...partial,
});

describe("describeToolHint", () => {
    it("默认中文，英文模式返回对应文案", () => {
        expect(toolLabel(ToolType.LINE)).toBe("直线");
        expect(toolLabel(ToolType.LINE, "en")).toBe("Line");
        expect(describeToolHint(input({ tool: ToolType.LINE }), "en").tool).toBe("Line");
        expect(describeToolHint(input({ tool: ToolType.LINE }), "en").next).toContain(
            "Specify the start point",
        );
        expect(
            describeToolHint(input({ tool: ToolType.SELECT, selectedCount: 2 }), "en").next,
        ).toContain("2 selected");
    });

    it("直线区分起点与下一点阶段", () => {
        expect(describeToolHint(input({ tool: ToolType.LINE })).next).toContain("指定起点");
        expect(describeToolHint(input({ tool: ToolType.LINE, hasAnchor: true })).next).toContain(
            "键入长度",
        );
    });

    it("选择工具在已选与未选时给出不同提示", () => {
        expect(describeToolHint(input({})).next).toContain("窗口选择");
        expect(describeToolHint(input({ selectedCount: 3 }))).toEqual({
            tool: "选择",
            next: "已选 3 个：拖拽移动，或用夹点编辑；Shift + 点击可加选",
        });
    });

    it("标注随已取点数推进三段提示", () => {
        expect(describeToolHint(input({ tool: ToolType.DIMENSION })).next).toBe("指定标注起点");
        expect(describeToolHint(input({ tool: ToolType.DIMENSION, dimCount: 1 })).tool).toBe(
            "标注",
        );
        expect(describeToolHint(input({ tool: ToolType.DIMENSION, dimCount: 2 })).next).toBe(
            "指定标注位置",
        );
    });

    it("多段线提示已取点数并说明完成方式", () => {
        expect(describeToolHint(input({ tool: ToolType.POLYLINE, polyCount: 2 })).next).toContain(
            "已取 2 点",
        );
    });

    it("复制/旋转/缩放/偏移在未选中时先提示选择", () => {
        [ToolType.COPY, ToolType.ROTATE, ToolType.SCALE, ToolType.OFFSET].forEach((tool) => {
            expect(describeToolHint(input({ tool })).next).toContain("先选中");
        });
    });

    it("高级图形统一提示弹窗设置参数", () => {
        expect(describeToolHint(input({ tool: ToolType.GEAR })).tool).toBe("齿轮");
        expect(describeToolHint(input({ tool: ToolType.GEAR })).next).toContain("弹窗中设置参数");
    });

    it("每个工具都有中文工具名与下一步提示", () => {
        Object.values(ToolType).forEach((tool) => {
            const hint = describeToolHint(input({ tool }));
            expect(hint.tool).toBe(toolLabel(tool));
            expect(hint.next.length).toBeGreaterThan(0);
            expect(/[A-Za-z]/.test(hint.tool)).toBe(false);
        });
    });
});
