import { describe, expect, it } from "vitest";
import {
    DEFAULT_THEME_PREFERENCE,
    THEME_STORAGE_KEY,
    readThemePreference,
    writeThemePreference,
    resolveTheme,
} from "../lib/themePreferences";
import {
    DEFAULT_UI_PREFERENCES,
    RIGHT_PANEL_WIDTH_MAX,
    RIGHT_PANEL_WIDTH_MIN,
    UI_PREFERENCES_STORAGE_KEY,
    readUIPreferences,
    writeUIPreferences,
} from "../lib/uiPreferences";

function memoryStorage(): Storage & { dump(): Map<string, string> } {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        dump: () => store,
    } as Storage & { dump(): Map<string, string> };
}

describe("主题偏好", () => {
    it("无存储时退回跟随系统", () => {
        expect(readThemePreference(null)).toBe(DEFAULT_THEME_PREFERENCE);
    });

    it("非法取值按跟随系统处理，合法取值原样读回", () => {
        const storage = memoryStorage();
        storage.setItem(THEME_STORAGE_KEY, "sepia");
        expect(readThemePreference(storage)).toBe("system");

        writeThemePreference("dark", storage);
        expect(readThemePreference(storage)).toBe("dark");
    });

    it("写失败（无存储）不影响返回语义", () => {
        expect(writeThemePreference("light", null)).toBe(false);
    });

    it("system 按系统配色解析，显式偏好不被系统配色覆盖", () => {
        expect(resolveTheme("system", true)).toBe("dark");
        expect(resolveTheme("system", false)).toBe("light");
        expect(resolveTheme("light", true)).toBe("light");
        expect(resolveTheme("dark", false)).toBe("dark");
    });
});

describe("界面布局偏好", () => {
    it("无存储或损坏数据时退回默认布局", () => {
        expect(readUIPreferences(null)).toEqual(DEFAULT_UI_PREFERENCES);

        const storage = memoryStorage();
        storage.setItem(UI_PREFERENCES_STORAGE_KEY, "{not-json");
        expect(readUIPreferences(storage)).toEqual(DEFAULT_UI_PREFERENCES);
    });

    it("面板宽度越界时收敛到合法区间", () => {
        const storage = memoryStorage();
        writeUIPreferences({ rightPanelWidth: 99 }, storage);
        expect(readUIPreferences(storage).rightPanelWidth).toBe(RIGHT_PANEL_WIDTH_MIN);

        writeUIPreferences({ rightPanelWidth: 99999 }, storage);
        expect(readUIPreferences(storage).rightPanelWidth).toBe(RIGHT_PANEL_WIDTH_MAX);
    });

    it("合并写入只覆盖传入字段", () => {
        const storage = memoryStorage();
        writeUIPreferences({ sidePanelOpen: true, rightPanelWidth: 500 }, storage);
        writeUIPreferences({ rightPanelWidth: 640 }, storage);

        const prefs = readUIPreferences(storage);
        expect(prefs.sidePanelOpen).toBe(true);
        expect(prefs.rightPanelWidth).toBe(640);
    });
});
