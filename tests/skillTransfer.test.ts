import { describe, expect, it } from "vitest";
import type { AiSkill } from "../types";
import {
    SKILL_EXPORT_KIND,
    SKILL_EXPORT_VERSION,
    buildSkillExport,
    parseSkillImport,
    resolveImportCode,
    skillExportFileName,
    skillImportToInput,
} from "../lib/skillTransfer";

const skill: AiSkill = {
    id: "skill-1",
    code: "mech-draft",
    name: "机械制图",
    description: "常用机械件绘制流程",
    category: "mechanical",
    promptTemplate: "先查询再绘制，最后用测量确认尺寸。",
    toolNames: ["query_elements", "draw_circle", "measure_geometry"],
    selectionTypes: ["CIRCLE"],
    keywords: ["齿轮", "轴"],
    steps: [{ title: "确定对象", detail: "先查询", tool: "query_elements" }],
    checks: ["尺寸与要求一致"],
    examples: ["画一个直径 20 的圆"],
    requiredContext: ["selection"],
    negativeKeywords: ["三维"],
    version: 3,
    priority: 60,
    isEnabled: true,
    isSystem: false,
    userId: "user-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("buildSkillExport", () => {
    it("输出带版本号的技能文件", () => {
        const payload = buildSkillExport(skill, "2026-01-01T00:00:00.000Z");

        expect(payload.kind).toBe(SKILL_EXPORT_KIND);
        expect(payload.version).toBe(SKILL_EXPORT_VERSION);
        expect(payload.exportedAt).toBe("2026-01-01T00:00:00.000Z");
        expect(payload.skill).toMatchObject({
            code: "mech-draft",
            name: "机械制图",
            promptTemplate: "先查询再绘制，最后用测量确认尺寸。",
            priority: 60,
            isEnabled: true,
        });
        expect(payload.skill.toolNames).toEqual([
            "query_elements",
            "draw_circle",
            "measure_geometry",
        ]);
        expect(payload.skill.requiredContext).toEqual(["selection"]);
    });

    it("导出内容与原技能解耦，修改副本不影响原对象", () => {
        const payload = buildSkillExport(skill);
        payload.skill.toolNames.push("clear_canvas");
        payload.skill.steps[0].title = "改过";

        expect(skill.toolNames).toHaveLength(3);
        expect(skill.steps[0].title).toBe("确定对象");
    });

    it("导出文件名来自技能代码", () => {
        expect(skillExportFileName(skill)).toBe("mech-draft.aiignite-skill.json");
    });
});

describe("parseSkillImport", () => {
    const payload = () => JSON.parse(JSON.stringify(buildSkillExport(skill)));

    it("导出的文件可以原样导入", () => {
        const result = parseSkillImport(payload());

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.name).toBe("机械制图");
        expect(result.value.code).toBe("mech-draft");
        expect(result.value.steps).toEqual([
            { title: "确定对象", detail: "先查询", tool: "query_elements" },
        ]);
        expect(result.value.keywords).toEqual(["齿轮", "轴"]);
    });

    it("拒绝非技能文件与不支持的版本", () => {
        expect(parseSkillImport({ kind: "other", version: 1 }).ok).toBe(false);
        expect(parseSkillImport({ kind: SKILL_EXPORT_KIND, version: 99 }).ok).toBe(false);
        expect(parseSkillImport("not-an-object").ok).toBe(false);
        expect(parseSkillImport(null).ok).toBe(false);
    });

    it("拒绝未知工具与未知上下文信号", () => {
        const badTool = payload();
        badTool.skill.toolNames = ["drop_database"];
        const toolResult = parseSkillImport(badTool);
        expect(toolResult.ok).toBe(false);
        if (toolResult.ok) throw new Error("未知工具应被拒绝");
        expect(toolResult.error).toContain("drop_database");

        const badSignal = payload();
        badSignal.skill.requiredContext = ["weather"];
        const signalResult = parseSkillImport(badSignal);
        expect(signalResult.ok).toBe(false);
        if (signalResult.ok) throw new Error("未知上下文信号应被拒绝");
        expect(signalResult.error).toContain("weather");
    });

    it("拒绝越界的字段", () => {
        const longPrompt = payload();
        longPrompt.skill.promptTemplate = "x".repeat(4001);
        expect(parseSkillImport(longPrompt).ok).toBe(false);

        const tooManySteps = payload();
        tooManySteps.skill.steps = Array.from({ length: 9 }, () => ({ title: "步骤" }));
        expect(parseSkillImport(tooManySteps).ok).toBe(false);

        const emptyKeyword = payload();
        emptyKeyword.skill.keywords = ["  "];
        expect(parseSkillImport(emptyKeyword).ok).toBe(false);

        const badPriority = payload();
        badPriority.skill.priority = 500;
        expect(parseSkillImport(badPriority).ok).toBe(false);

        const badStep = payload();
        badStep.skill.steps = [{ title: "步骤", tool: "not_a_tool" }];
        expect(parseSkillImport(badStep).ok).toBe(false);
    });

    it("缺失可选字段时补默认值", () => {
        const minimal = { kind: SKILL_EXPORT_KIND, version: SKILL_EXPORT_VERSION, skill: { name: "最小技能", promptTemplate: "直接画" } };
        const result = parseSkillImport(minimal);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.toolNames).toEqual([]);
        expect(result.value.steps).toEqual([]);
        expect(result.value.priority).toBe(50);
        expect(result.value.isEnabled).toBe(true);
        expect(result.value.category).toBe("custom");
        expect(result.value.code).toBe("");
    });
});

describe("resolveImportCode", () => {
    it("代码未被占用时保持原样", () => {
        expect(resolveImportCode("mech-draft", ["other-skill"])).toBe("mech-draft");
    });

    it("代码被占用时追加副本后缀", () => {
        expect(resolveImportCode("mech-draft", ["mech-draft"])).toBe("mech-draft-copy");
        expect(resolveImportCode("mech-draft", ["mech-draft", "mech-draft-copy"])).toBe(
            "mech-draft-copy2",
        );
    });

    it("空代码退回到默认代码", () => {
        const code = resolveImportCode("", []);
        expect(code).toBe("imported-skill");
    });
});

describe("skillImportToInput", () => {
    it("转换成创建技能的请求体", () => {
        const result = parseSkillImport(
            JSON.parse(JSON.stringify(buildSkillExport(skill))),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const input = skillImportToInput(result.value, "mech-draft-2");

        expect(input).toMatchObject({
            name: "机械制图",
            code: "mech-draft-2",
            promptTemplate: "先查询再绘制，最后用测量确认尺寸。",
            priority: 60,
            isEnabled: true,
        });
        expect(input.toolNames).toEqual([
            "query_elements",
            "draw_circle",
            "measure_geometry",
        ]);
        expect(input.requiredContext).toEqual(["selection"]);
    });
});
