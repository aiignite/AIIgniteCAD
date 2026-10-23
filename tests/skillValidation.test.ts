import { describe, expect, it } from "vitest";
import type { SkillInput } from "../types";
import { SKILL_LIMITS, describeSkillIssue, validateSkillDraft } from "../lib/skillValidation";
import { SKILL_EXPORT_KIND, SKILL_EXPORT_VERSION, parseSkillImport } from "../lib/skillTransfer";

const draft = (overrides: Partial<SkillInput> = {}): SkillInput => ({
    name: "齿轮绘制",
    promptTemplate: "先查询再绘制。",
    toolNames: ["draw_circle"],
    keywords: ["齿轮"],
    steps: [{ title: "确定作用对象", tool: "query_elements" }],
    checks: ["尺寸与用户要求一致"],
    examples: ["画一个模数 2 的齿轮"],
    requiredContext: ["selection"],
    negativeKeywords: ["渲染"],
    selectionTypes: ["CIRCLE"],
    priority: 50,
    isEnabled: true,
    ...overrides,
});

const issueFor = (overrides: Partial<SkillInput>) => validateSkillDraft(draft(overrides));

describe("技能字段校验（编辑器路径）", () => {
    it("步骤引用未知工具时定位到 steps", () => {
        const issues = issueFor({ steps: [{ title: "画线", tool: "draw_laser" }] });
        expect(issues).toEqual([{ field: "steps", error: "步骤引用了未知工具：draw_laser" }]);
        expect(describeSkillIssue(issues[0])).toBe("执行步骤：步骤引用了未知工具：draw_laser");
    });

    it("名称与提示词模板为空各归各字段", () => {
        expect(issueFor({ name: "  " })).toEqual([{ field: "name", error: "技能名称不能为空" }]);
        expect(issueFor({ promptTemplate: "" })).toEqual([
            { field: "promptTemplate", error: "提示词模板不能为空" },
        ]);
    });

    it("长度与条数上限统一来自规则表", () => {
        expect(issueFor({ name: "名".repeat(SKILL_LIMITS.name + 1) })).toEqual([
            { field: "name", error: `技能名称最多 ${SKILL_LIMITS.name} 字符` },
        ]);
        expect(issueFor({ steps: Array.from({ length: SKILL_LIMITS.steps + 1 }, (_, i) => ({ title: `步${i}` })) }))
            .toEqual([{ field: "steps", error: `steps 最多 ${SKILL_LIMITS.steps} 项` }]);
        expect(issueFor({ keywords: Array.from({ length: SKILL_LIMITS.keywords + 1 }, (_, i) => `k${i}`) }))
            .toEqual([{ field: "keywords", error: `keywords 最多 ${SKILL_LIMITS.keywords} 项` }]);
    });

    it("代码格式、优先级与未知工具白名单各自成条", () => {
        expect(issueFor({ code: "Gear Hobbing" })).toEqual([
            { field: "code", error: "技能代码需匹配 ^[a-z0-9][a-z0-9_-]{2,63}$" },
        ]);
        expect(issueFor({ priority: 999 })).toEqual([
            { field: "priority", error: `优先级必须是 0 到 ${SKILL_LIMITS.priority} 的整数` },
        ]);
        expect(issueFor({ toolNames: ["draw_circle", "warp_drive"] })).toEqual([
            { field: "toolNames", error: "未知的工具：warp_drive" },
        ]);
    });

    it("合法草稿没有问题，多个问题按字段顺序返回", () => {
        expect(validateSkillDraft(draft())).toEqual([]);
        const issues = issueFor({ name: "", promptTemplate: "", priority: -1 });
        expect(issues.map((issue) => issue.field)).toEqual(["name", "promptTemplate", "priority"]);
    });
});

describe("导入与编辑器共用同一份规则", () => {
    const payload = (skill: Record<string, unknown>) => ({
        kind: SKILL_EXPORT_KIND,
        version: SKILL_EXPORT_VERSION,
        skill: { ...draft(), ...skill },
    });

    it("同一处非法在两条路径上给出逐字一致的文案", () => {
        const steps = [{ title: "画线", tool: "draw_laser" }];
        const imported = parseSkillImport(payload({ steps }));
        expect(imported.ok).toBe(false);
        expect(imported.error).toBe(validateSkillDraft(draft({ steps }))[0].error);
    });

    it("导入仍拒绝越界条数与非法上下文信号", () => {
        expect(parseSkillImport(payload({ requiredContext: ["gravity"] }))).toMatchObject({
            ok: false,
            error: "未知的上下文信号：gravity",
        });
        expect(parseSkillImport(payload({ priority: 500 })).error).toBe(
            `优先级必须是 0 到 ${SKILL_LIMITS.priority} 的整数`,
        );
    });
});
