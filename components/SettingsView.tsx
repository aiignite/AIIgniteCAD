import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { SettingsSection } from "../lib/menus";
import type { ProjectFile } from "../types";
import { useAIRegistry, type UseAIRegistryResult } from "../hooks/useAIRegistry";
import { useI18n, type TranslationKey } from "../lib/i18n";
import LLMModelsPanel from "./LLMModelsPanel";
import AssistantsPanel from "./AssistantsPanel";
import AISkillsPanel from "./AISkillsPanel";
import DrawingSettingsSection from "./settings/DrawingSettingsSection";
import AppearanceSection from "./settings/AppearanceSection";
import AccountSection from "./settings/AccountSection";
import DrawingsSection from "./settings/DrawingsSection";
import UsersSection from "./settings/UsersSection";
import {
    buildDefaultModelOptions,
    buildRegistryView,
    summarizeRegistryRows,
    type RegistryRows,
    type RegistrySection,
    type RegistrySummary,
} from "../lib/settingsRegistry";
import {
    FOLLOW_ASSISTANT_VALUE,
    preferencesFromSelect,
    readAIPreferences,
    selectValueFromPreferences,
    writeAIPreferences,
} from "../lib/aiPreferences";

export interface SettingsViewProps {
    section: SettingsSection;
    onSectionChange: (section: SettingsSection) => void;
    onClose: () => void;
    onLogout?: () => void;
    /** 图纸管理分区需要的数据与动作 */
    files: ProjectFile[];
    activeFileId: string | null;
    onLoadFile: (file: ProjectFile) => void;
    onCreateFile: (name: string) => void;
    onRenameFile: (id: string, newName: string) => void;
    onDeleteFile: (id: string) => void;
    /** 当前用户角色：admin 时左导航出现「用户管理」分区 */
    currentUserRole?: string | null;
}

interface NavItem {
    section: SettingsSection;
    labelKey: TranslationKey;
    icon: string;
}

interface NavGroup {
    id: string;
    /** 单独成组时不给标题，避免和条目文案重复 */
    labelKey: TranslationKey | null;
    items: NavItem[];
}

const BASE_NAV_GROUPS: readonly NavGroup[] = [
    {
        id: "ai",
        labelKey: "settings.groupAI" as TranslationKey,
        items: [
            { section: "models", labelKey: "settings.navModels", icon: "psychology" },
            { section: "assistants", labelKey: "settings.navAssistants", icon: "support_agent" },
            { section: "skills", labelKey: "settings.navSkills", icon: "extension" },
        ],
    },
    {
        id: "workspace",
        labelKey: "settings.groupWorkspace" as TranslationKey,
        items: [
            { section: "drawings", labelKey: "settings.navDrawings", icon: "library_books" },
            { section: "drawing", labelKey: "settings.navDrawing", icon: "settings" },
            { section: "appearance", labelKey: "settings.navAppearance", icon: "palette" },
        ],
    },
    {
        id: "user",
        labelKey: null,
        items: [
            { section: "users", labelKey: "settings.navUsers", icon: "group" },
            { section: "account", labelKey: "settings.navAccount", icon: "manage_accounts" },
        ],
    },
];

const SECTION_META: Record<
    SettingsSection,
    { titleKey: TranslationKey; subtitleKey: TranslationKey }
> = {
    models: {
        titleKey: "settings.modelsTitle",
        subtitleKey: "settings.modelsSubtitle",
    },
    assistants: {
        titleKey: "settings.assistantsTitle",
        subtitleKey: "settings.assistantsSubtitle",
    },
    skills: { titleKey: "settings.skillsTitle", subtitleKey: "settings.skillsSubtitle" },
    drawings: {
        titleKey: "settings.drawingsTitle",
        subtitleKey: "settings.drawingsSubtitle",
    },
    drawing: { titleKey: "settings.drawingTitle", subtitleKey: "settings.drawingSubtitle" },
    appearance: {
        titleKey: "settings.appearanceTitle",
        subtitleKey: "settings.appearanceSubtitle",
    },
    users: { titleKey: "settings.usersTitle", subtitleKey: "settings.usersSubtitle" },
    account: { titleKey: "settings.accountTitle", subtitleKey: "settings.accountSubtitle" },
};

const REGISTRY_SEARCH_KEY: Record<RegistrySection, TranslationKey> = {
    models: "settings.modelsSearch",
    assistants: "settings.assistantsSearch",
    skills: "settings.skillsSearch",
};

const REGISTRY_EMPTY_KEY: Record<RegistrySection, { title: TranslationKey; hint: TranslationKey }> =
    {
        models: { title: "settings.modelsEmpty", hint: "settings.modelsEmptyHint" },
        assistants: { title: "settings.assistantsEmpty", hint: "settings.assistantsEmptyHint" },
        skills: { title: "settings.skillsEmpty", hint: "settings.skillsEmptyHint" },
    };

/** 注册表分区可以搜索，配置分区没有可过滤的集合 */
function asRegistrySection(section: SettingsSection): RegistrySection | null {
    return section === "models" || section === "assistants" || section === "skills"
        ? section
        : null;
}

function sectionCount(section: SettingsSection, summary: RegistrySummary): number | null {
    if (section === "models") return summary.modelCount;
    if (section === "assistants") return summary.assistantCount;
    if (section === "skills") return summary.skillCount;
    return null;
}

const navButtonClass =
    "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-medium transition-colors border";

/**
 * 偏好块钉在左导航底部，只放跨分区都常用的首选项。
 * 默认模型同时写 localStorage 和服务端 isDefault，AI 会话才会真的用上；
 * 栅格、标注比例这类图纸字段留给「绘图设置」，一处只有一个编辑器。
 */
function PreferencesBlock({
    rows,
    registry,
    onSaved,
}: {
    rows: RegistryRows;
    registry: UseAIRegistryResult;
    onSaved: (modelId: string | null) => void;
}) {
    const { t } = useI18n();
    const summary = useMemo(() => summarizeRegistryRows(rows), [rows]);
    const modelOptions = useMemo(() => buildDefaultModelOptions(rows.models), [rows.models]);

    const [draftModel, setDraftModel] = useState<string>(() =>
        selectValueFromPreferences(readAIPreferences()),
    );
    const [savedModel, setSavedModel] = useState(draftModel);
    const [savedHint, setSavedHint] = useState(false);

    // 删掉某个模型后，存档里残留的 id 不能让下拉指向不存在的选项
    const clampToModels = useCallback(
        (value: string) =>
            value === FOLLOW_ASSISTANT_VALUE || rows.models.some((model) => model.id === value)
                ? value
                : FOLLOW_ASSISTANT_VALUE,
        [rows.models],
    );
    const selectedModel = clampToModels(draftModel);
    const isDirty = selectedModel !== clampToModels(savedModel);

    const handleSave = useCallback(() => {
        const preferences = preferencesFromSelect(selectedModel);
        const persisted = writeAIPreferences(preferences);
        const targetId = preferences.defaultModelId;
        if (persisted && targetId && targetId !== summary.defaultModelId) {
            // 默认模型同时对服务端注册表生效，AI 会话才能真的用上
            void registry.markDefaultModel(targetId);
        }
        setSavedModel(selectedModel);
        setSavedHint(true);
        onSaved(targetId);
    }, [onSaved, registry, selectedModel, summary.defaultModelId]);

    useEffect(() => {
        if (!savedHint) return;
        const timer = window.setTimeout(() => setSavedHint(false), 2000);
        return () => window.clearTimeout(timer);
    }, [savedHint]);

    const inputClass =
        "w-full h-7 bg-transparent border border-cad-border rounded px-2 text-[11px] font-mono text-cad-text focus:border-cad-primary outline-none";

    return (
        <div className="shrink-0 border-t border-cad-border bg-cad-panel p-3 space-y-2">
            <h4 className="flex items-center gap-1.5 text-[10px] font-bold text-cad-muted uppercase tracking-wider">
                <span className="material-symbols-outlined text-[14px] text-cad-primary">tune</span>
                {t("settings.prefsTitle")}
            </h4>

            <label className="block space-y-1">
                <span className="text-[10px] text-cad-muted font-medium">
                    {t("settings.prefsDefaultModel")}
                </span>
                <select
                    data-action="prefs-default-model"
                    value={selectedModel}
                    onChange={(e) => setDraftModel(e.target.value)}
                    className={inputClass}
                >
                    <option value={FOLLOW_ASSISTANT_VALUE}>
                        {t("settings.prefsFollowAssistant")}
                    </option>
                    {modelOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <span className="block text-[10px] text-cad-muted truncate">
                    {t("settings.modelsDefault")} · {summary.defaultModelName || t("profile.na")}
                </span>
            </label>

            <button
                data-action="settings-prefs-save"
                onClick={handleSave}
                disabled={!isDirty}
                className="w-full h-7 rounded bg-cad-primary text-white text-[11px] font-bold hover:bg-cad-primaryHover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
                {savedHint ? t("settings.prefsSaved") : t("settings.prefsSave")}
            </button>
        </div>
    );
}

export const SettingsView: React.FC<SettingsViewProps> = ({
    section,
    onSectionChange,
    onClose,
    onLogout,
    files,
    activeFileId,
    onLoadFile,
    onCreateFile,
    onRenameFile,
    onDeleteFile,
    currentUserRole,
}) => {
    const { t } = useI18n();
    const registry = useAIRegistry();
    const isAdmin = currentUserRole === "admin";
    // 非管理员不出现「用户管理」入口；误入时落回账户分区
    const NAV_GROUPS = useMemo(
        () =>
            isAdmin
                ? BASE_NAV_GROUPS
                : BASE_NAV_GROUPS.map((group) => ({
                      ...group,
                      items: group.items.filter((item) => item.section !== "users"),
                  })),
        [isAdmin],
    );
    const [draft, setDraft] = useState<{ section: SettingsSection; query: string }>({
        section,
        query: "",
    });
    // 搜索词按分区暂存：切到别的分区自动失效，不需要额外 effect
    const query = draft.section === section ? draft.query : "";

    const registrySection = asRegistrySection(section);

    // 满屏界面支持 Esc 返回画布；输入控件内不拦截
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            const target = event.target as HTMLElement | null;
            if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
            onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    // 非管理员落到 users 分区（菜单残留 / 直链）时退回账户页
    useEffect(() => {
        if (section === "users" && !isAdmin) onSectionChange("account");
    }, [section, isAdmin, onSectionChange]);

    const rows = useMemo<RegistryRows>(
        () => ({
            models: registry.models,
            assistants: registry.assistants,
            skills: registry.skills,
        }),
        [registry.models, registry.assistants, registry.skills],
    );

    const summary = useMemo(() => summarizeRegistryRows(rows), [rows]);
    const view = useMemo<RegistryRows>(
        () => (registrySection ? buildRegistryView(rows, registrySection, query) : rows),
        [rows, registrySection, query],
    );

    // 面板只接收 registry，过滤后的行通过覆盖字段传下去，回调仍是原 hook 的
    const panelRegistry = useMemo(() => ({ ...registry, ...view }), [registry, view]);

    const matchedCount = registrySection ? sectionCount(section, summary) : null;
    const filteredCount = registrySection
        ? (registrySection === "models"
              ? view.models.length
              : registrySection === "assistants"
                ? view.assistants.length
                : view.skills.length) || 0
        : 0;
    const isNoMatch = Boolean(registrySection) && query.trim().length > 0 && filteredCount === 0;

    const meta = SECTION_META[section];

    const renderBody = () => {
        if (section === "drawings") {
            return (
                <DrawingsSection
                    files={files}
                    activeFileId={activeFileId}
                    onLoadFile={onLoadFile}
                    onCreateFile={onCreateFile}
                    onRenameFile={onRenameFile}
                    onDeleteFile={onDeleteFile}
                />
            );
        }
        if (section === "users") return <UsersSection />;
        if (section === "drawing") return <DrawingSettingsSection />;
        if (section === "appearance") return <AppearanceSection />;
        if (section === "account") return <AccountSection onLogout={onLogout} />;
        if (isNoMatch) {
            const keys = REGISTRY_EMPTY_KEY[registrySection as RegistrySection];
            return (
                <div className="h-full rounded-lg border border-cad-border bg-cad-panel flex flex-col items-center justify-center gap-2 p-8">
                    <span className="material-symbols-outlined text-[28px] text-cad-muted">
                        search
                    </span>
                    <p className="text-sm font-bold text-cad-text">{t(keys.title)}</p>
                    <p className="text-xs text-cad-muted">{t(keys.hint)}</p>
                </div>
            );
        }
        return (
            <div className="h-full min-h-0 overflow-hidden rounded-lg border border-cad-border bg-cad-panel">
                {section === "models" && <LLMModelsPanel registry={panelRegistry} />}
                {section === "assistants" && <AssistantsPanel registry={panelRegistry} />}
                {section === "skills" && <AISkillsPanel registry={panelRegistry} />}
            </div>
        );
    };

    return (
        <div
            className="absolute inset-0 z-40 flex bg-cad-bg"
            role="dialog"
            aria-modal="true"
            aria-label={t("settings.navTitle")}
        >
            <aside className="w-60 shrink-0 flex flex-col border-r border-cad-border bg-cad-panel">
                <div className="p-4 border-b border-cad-border space-y-0.5">
                    <h2 className="text-sm font-bold text-cad-text">{t("settings.navTitle")}</h2>
                    <p className="text-[11px] text-cad-muted">{t("settings.navSubtitle")}</p>
                </div>

                <nav className="flex-1 min-h-0 overflow-y-auto p-2 space-y-3">
                    {NAV_GROUPS.map((group) => (
                        <div key={group.id} className="space-y-1">
                            {group.labelKey && (
                                <p className="px-2 pt-1 text-[10px] font-bold text-cad-muted uppercase tracking-wider">
                                    {t(group.labelKey)}
                                </p>
                            )}
                            {group.items.map((item) => {
                                const isActive = item.section === section;
                                const count = sectionCount(item.section, summary);
                                return (
                                    <button
                                        key={item.section}
                                        data-nav={item.section}
                                        onClick={() => onSectionChange(item.section)}
                                        aria-current={isActive ? "page" : undefined}
                                        className={`${navButtonClass} ${
                                            isActive
                                                ? "bg-cad-primary/15 border-cad-primary text-cad-primary"
                                                : "border-transparent text-cad-muted hover:bg-cad-text/5 hover:text-cad-text"
                                        }`}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">
                                            {item.icon}
                                        </span>
                                        <span className="flex-1 text-left truncate">
                                            {t(item.labelKey)}
                                        </span>
                                        {count !== null && (
                                            <span className="font-mono text-[10px] opacity-70">
                                                {count}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </nav>

                <PreferencesBlock rows={rows} registry={registry} onSaved={() => undefined} />
            </aside>

            <main className="flex-1 min-w-0 flex flex-col">
                <header className="shrink-0 flex items-start justify-between gap-3 p-4 border-b border-cad-border bg-cad-panel">
                    <div className="min-w-0">
                        <h3 className="text-base font-bold text-cad-text">{t(meta.titleKey)}</h3>
                        <p className="text-xs text-cad-muted mt-0.5">{t(meta.subtitleKey)}</p>
                    </div>
                    <button
                        data-action="settings-close"
                        onClick={onClose}
                        title={t("settings.backToCanvas")}
                        aria-label={t("settings.backToCanvas")}
                        className="shrink-0 flex items-center gap-1.5 h-8 px-2.5 rounded border border-cad-border text-xs text-cad-muted hover:bg-cad-border/40 hover:text-cad-text transition-colors"
                    >
                        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                        <span className="hidden md:inline">{t("settings.backToCanvas")}</span>
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </header>

                {registrySection && (
                    <div className="shrink-0 flex items-center gap-2 px-4 pt-3">
                        <div className="relative flex-1 max-w-xl">
                            <span className="material-symbols-outlined text-[16px] text-cad-muted absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">
                                search
                            </span>
                            <input
                                value={query}
                                onChange={(e) => setDraft({ section, query: e.target.value })}
                                placeholder={t(REGISTRY_SEARCH_KEY[registrySection])}
                                aria-label={t("settings.searchPlaceholder")}
                                className="w-full h-8 pl-8 pr-2 rounded border border-cad-border bg-cad-panel text-xs text-cad-text focus:border-cad-primary outline-none"
                            />
                        </div>
                        {matchedCount !== null && (
                            <span
                                data-settings-count=""
                                className="shrink-0 font-mono text-[11px] text-cad-muted"
                            >
                                {query.trim() ? `${filteredCount}/${matchedCount}` : matchedCount}
                            </span>
                        )}
                    </div>
                )}

                <div
                    data-settings-body={section}
                    className={`flex-1 min-h-0 p-4 ${
                        registrySection ? "overflow-hidden" : "overflow-y-auto"
                    }`}
                >
                    {renderBody()}
                </div>
            </main>
        </div>
    );
};

export default SettingsView;
