import { describe, expect, it } from "vitest";
import {
    buildDefaultModelOptions,
    buildRegistryView,
    filterRegistryRows,
    summarizeRegistryRows,
    toRegistryRows,
    type RegistryRows,
} from "../lib/settingsRegistry";
import type { AiSkill, Assistant, LLMModel } from "../types";

function model(partial: Partial<LLMModel> & { id: string; name: string }): LLMModel {
    return {
        modelId: partial.modelId ?? "glm-4.7",
        provider: partial.provider ?? ("glm" as LLMModel["provider"]),
        ...partial,
    } as LLMModel;
}

function assistant(partial: Partial<Assistant> & { id: string; name: string }): Assistant {
    return partial as Assistant;
}

function skill(partial: Partial<AiSkill> & { id: string; name: string }): AiSkill {
    return partial as AiSkill;
}

const rows: RegistryRows = {
    models: [
        model({
            id: "m1",
            name: "GLM-4.7",
            modelId: "glm-4.7",
            provider: "glm" as LLMModel["provider"],
        }),
        model({
            id: "m2",
            name: "本地 Qwen",
            modelId: "qwen2.5-coder",
            provider: "ollama" as LLMModel["provider"],
            isDefault: true,
        }),
    ],
    assistants: [
        assistant({ id: "a1", name: "图纸审查", description: "检查标注与线型", llmModelId: "m1" }),
        assistant({ id: "a2", name: "参数化建模", category: "建模" }),
    ],
    skills: [
        skill({
            id: "s1",
            code: "draw_circle",
            name: "画圆",
            keywords: ["圆", "半径"],
            isEnabled: true,
            priority: 10,
        }),
        skill({
            id: "s2",
            code: "plot_sheet",
            name: "出图",
            toolNames: ["exportDxf"],
            isEnabled: false,
            priority: 5,
        }),
    ],
};

describe("设置页注册表过滤", () => {
    it("空查询不过滤，且服务端缺字段时按空表处理", () => {
        expect(filterRegistryRows(rows, "models", "")).toEqual(rows);
        expect(filterRegistryRows(rows, "models", "   ")).toEqual(rows);
        expect(toRegistryRows(null)).toEqual({ models: [], assistants: [], skills: [] });
    });

    it("忽略大小写与多余空格", () => {
        expect(filterRegistryRows(rows, "models", "  GLM  ").models.map((m) => m.id)).toEqual([
            "m1",
        ]);
        expect(filterRegistryRows(rows, "models", "glm-4.7").models.map((m) => m.id)).toEqual([
            "m1",
        ]);
    });

    it("模型可按名称、模型 ID 与提供商命中", () => {
        expect(filterRegistryRows(rows, "models", "ollama").models.map((m) => m.id)).toEqual([
            "m2",
        ]);
        expect(filterRegistryRows(rows, "models", "qwen2.5").models.map((m) => m.id)).toEqual([
            "m2",
        ]);
    });

    it("助手可按名称、描述、分类与绑定的模型命中", () => {
        expect(filterRegistryRows(rows, "assistants", "审查").assistants.map((a) => a.id)).toEqual([
            "a1",
        ]);
        expect(filterRegistryRows(rows, "assistants", "建模").assistants.map((a) => a.id)).toEqual([
            "a2",
        ]);
    });

    it("技能可按编码、关键词与工具名命中", () => {
        expect(filterRegistryRows(rows, "skills", "draw_circle").skills.map((s) => s.id)).toEqual([
            "s1",
        ]);
        expect(filterRegistryRows(rows, "skills", "半径").skills.map((s) => s.id)).toEqual(["s1"]);
        expect(filterRegistryRows(rows, "skills", "exportdxf").skills.map((s) => s.id)).toEqual([
            "s2",
        ]);
    });

    it("未命中返回空表，其它分区的行不受当前分区搜索影响", () => {
        const filtered = filterRegistryRows(rows, "models", "不存在");
        expect(filtered.models).toEqual([]);
        expect(filtered.assistants).toHaveLength(2);
        expect(filtered.skills).toHaveLength(2);
    });

    it("视图模型会默认排序：默认模型置顶、技能按优先级倒序", () => {
        const view = buildRegistryView(rows, "models", "");
        expect(view.models.map((m) => m.id)).toEqual(["m2", "m1"]);
        expect(view.skills.map((s) => s.id)).toEqual(["s1", "s2"]);
    });
});

describe("设置页统计与偏好选项", () => {
    it("汇总各表数量与可用能力", () => {
        const summary = summarizeRegistryRows(rows);
        expect(summary).toMatchObject({
            modelCount: 2,
            assistantCount: 2,
            skillCount: 2,
            enabledSkillCount: 1,
            toolCapableModelCount: 0,
            modelBoundAssistantCount: 1,
            defaultModelName: "本地 Qwen",
        });
        expect(summary.providers).toEqual(["glm", "ollama"]);
    });

    it("默认模型下拉把服务端默认项排在首位并带上提供商明细", () => {
        const options = buildDefaultModelOptions(rows.models);
        expect(options[0]).toEqual({
            value: "m2",
            label: "本地 Qwen · ollama / qwen2.5-coder",
            isDefault: true,
        });
        expect(options[1].label).toBe("GLM-4.7 · glm / glm-4.7");
    });

    it("服务端返回不完整数据时不抛异常", () => {
        expect(summarizeRegistryRows(toRegistryRows()).modelCount).toBe(0);
        expect(buildDefaultModelOptions([])).toEqual([]);
    });
});
