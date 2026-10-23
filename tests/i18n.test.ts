import { describe, expect, it } from "vitest";
import { LOCALE_STORAGE_KEY, en, translate, zh } from "../lib/i18n";

describe("i18n 字典", () => {
    it("中英文键集合完全一致，且没有空文案", () => {
        const zhKeys = Object.keys(zh).sort();
        const enKeys = Object.keys(en).sort();
        expect(enKeys).toEqual(zhKeys);
        for (const key of zhKeys) {
            expect(zh[key as keyof typeof zh].trim(), key).not.toBe("");
            expect(en[key as keyof typeof en].trim(), key).not.toBe("");
        }
    });

    it("默认语言为中文，英文可切换", () => {
        expect(translate("zh", "header.save")).toBe("保存");
        expect(translate("en", "header.save")).toBe("Save");
        expect(translate("zh", "review.title")).toBe("图纸检查");
        expect(translate("en", "review.title")).toBe("Drawing review");
    });

    it("支持 {placeholder} 插值，缺少参数时保留原样", () => {
        expect(translate("zh", "common.elements", { count: 3 })).toBe("3 个图元");
        expect(translate("en", "common.elements", { count: 3 })).toBe("3 elements");
        expect(translate("zh", "notify.deleted", { count: 2 })).toContain("2 个图元");
        expect(translate("en", "chat.autoModel", { name: "GLM" })).toBe("Auto · GLM");
        expect(translate("zh", "notify.deleted")).toContain("{count}");
    });

    it("语言选择使用固定存储键", () => {
        expect(LOCALE_STORAGE_KEY).toBe("aiignitecad.locale");
    });
});
