/**
 * Toolbar.tsx — 左侧工具面板
 *
 * 采用 AutoCAD「工具面板」形态：按 导航 / 绘图 / 修改 / 标注 / 参数化 / 整理 / 面板
 * 分组，每组有可见标题且可单独折叠；展开时给出图标 + 名称 + 单键提示，
 * 收起时退回 48px 图标栏把宽度让给画布。折叠偏好记在本地，刷新后保持。
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SidePanelMode, ToolType } from "../types";
import { useCanvas } from "../store/canvasStore";
import { useApp } from "../store/appStore";
import { groupElements, ungroupElements } from "../lib/groups";
import { TOOL_GROUPS, type ToolMeta } from "../lib/toolCatalog";
import { useI18n, type TranslationKey } from "../lib/i18n";

/** 面板整体收起 / 各分组折叠状态的本地偏好 */
const COLLAPSED_KEY = "cad_palette_collapsed_v1";
const CLOSED_GROUPS_KEY = "cad_palette_groups_v1";

/** 面板分组：右侧面板的快捷入口，与顶部菜单指向同一批界面 */
interface PanelEntry {
    key: string;
    icon: string;
    labelKey: TranslationKey;
    onClick: () => void;
    active?: boolean;
}

function readCollapsed(): boolean {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
}

function readClosedGroups(): Set<string> {
    try {
        const raw = localStorage.getItem(CLOSED_GROUPS_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return new Set(
            Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
        );
    } catch {
        // 偏好读不出来不影响功能，退回全部展开
        return new Set();
    }
}

interface ToolbarProps {
    /** 打开图纸（文件夹）管理弹窗 */
    onOpenFiles: () => void;
    /** 打开设置页的指定分区 */
    onOpenSettings: (section: "drawing" | "account") => void;
    /** 当前登录用户，用于面板入口的头像 */
    currentUser?: { username?: string };
}

export const Toolbar: React.FC<ToolbarProps> = ({ onOpenFiles, onOpenSettings, currentUser }) => {
    const { t } = useI18n();
    const { state, selectedIds, setActiveTool, commitAction } = useCanvas();
    const { activeTool, elements } = state;
    const { state: appState, setSideMode, setSidePanelOpen, showNotification } = useApp();
    const [collapsed, setCollapsed] = useState(readCollapsed);
    const [closedGroups, setClosedGroups] = useState<Set<string>>(readClosedGroups);

    useEffect(() => {
        localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    }, [collapsed]);

    useEffect(() => {
        localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify([...closedGroups]));
    }, [closedGroups]);

    const toggleGroup = useCallback((key: string) => {
        setClosedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    /** 把选中的图元聚为一个组合 */
    const handleGroup = useCallback(() => {
        if (selectedIds.size < 2) {
            showNotification(t("notify.groupNeedMore"));
            return;
        }
        commitAction(groupElements(elements, selectedIds));
        showNotification(t("notify.grouped", { count: selectedIds.size }));
    }, [commitAction, elements, selectedIds, showNotification, t]);

    /** 解散选中图元所在的组合 */
    const handleUngroup = useCallback(() => {
        const next = ungroupElements(elements, selectedIds);
        if (next === elements) {
            showNotification(t("notify.notGrouped"));
            return;
        }
        commitAction(next);
        showNotification(t("notify.ungrouped"));
    }, [commitAction, elements, selectedIds, showNotification, t]);

    /** 打开右侧面板并切换到指定模式 */
    const openSidePanel = useCallback(
        (mode: SidePanelMode) => {
            setSideMode(mode);
            setSidePanelOpen(true);
        },
        [setSideMode, setSidePanelOpen],
    );

    const panelEntries = useMemo<PanelEntry[]>(() => {
        const entries: PanelEntry[] = [
            {
                key: "panel-review",
                icon: "rule",
                labelKey: "menu.view.review",
                onClick: () => openSidePanel(SidePanelMode.REVIEW),
                active: appState.sidePanelOpen && appState.sideMode === SidePanelMode.REVIEW,
            },
            {
                key: "panel-conventions",
                icon: "design_services",
                labelKey: "menu.view.conventions",
                onClick: () => openSidePanel(SidePanelMode.CONVENTIONS),
                active: appState.sidePanelOpen && appState.sideMode === SidePanelMode.CONVENTIONS,
            },
            {
                key: "panel-files",
                icon: "folder_open",
                labelKey: "panel.projectFiles",
                onClick: onOpenFiles,
            },
            {
                key: "panel-settings",
                icon: "settings",
                labelKey: "settings.navTitle",
                onClick: () => onOpenSettings("drawing"),
            },
        ];

        if (currentUser) {
            entries.push({
                key: "panel-user",
                icon: "account_circle",
                labelKey: "menu.tools.account",
                onClick: () => onOpenSettings("account"),
            });
        }

        entries.push({
            key: "panel-toggle",
            icon: appState.sidePanelOpen
                ? "keyboard_double_arrow_right"
                : "keyboard_double_arrow_left",
            labelKey: appState.sidePanelOpen ? "panel.collapse" : "panel.expand",
            onClick: () => setSidePanelOpen(!appState.sidePanelOpen),
            active: appState.sidePanelOpen,
        });

        return entries;
    }, [
        appState.sideMode,
        appState.sidePanelOpen,
        currentUser,
        onOpenFiles,
        onOpenSettings,
        openSidePanel,
        setSidePanelOpen,
    ]);

    /** 工具行：展开态给名称与单键，收起态只给图标并靠 title 提示 */
    const renderTool = (meta: ToolMeta) => {
        const label = t(meta.labelKey);
        const hint = meta.shortcutKey ? `${label} (${meta.shortcutKey.toUpperCase()})` : label;
        const active = activeTool === meta.tool;

        if (collapsed) {
            return (
                <button
                    key={meta.tool}
                    data-tool={meta.tool}
                    onClick={() => setActiveTool(meta.tool)}
                    title={hint}
                    aria-label={hint}
                    aria-pressed={active}
                    className={`flex size-9 shrink-0 items-center justify-center rounded transition-all ${
                        active
                            ? "bg-cad-primary text-white shadow-md"
                            : "text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                    }`}
                >
                    <span className="material-symbols-outlined text-[20px]">{meta.icon}</span>
                </button>
            );
        }

        return (
            <button
                key={meta.tool}
                data-tool={meta.tool}
                onClick={() => setActiveTool(meta.tool)}
                title={hint}
                aria-pressed={active}
                className={`flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                    active
                        ? "bg-cad-primary/15 text-cad-primary font-medium"
                        : "text-cad-text hover:bg-cad-text/10"
                }`}
            >
                <span className="material-symbols-outlined shrink-0 text-[18px]">{meta.icon}</span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {meta.shortcutKey && (
                    <span className="shrink-0 font-mono text-[10px] uppercase text-cad-muted">
                        {meta.shortcutKey}
                    </span>
                )}
            </button>
        );
    };

    /** 动作行：组合 / 解散 / 面板入口，与工具行同一视觉节奏 */
    const renderAction = (entry: {
        key: string;
        icon: string;
        labelKey: TranslationKey;
        onClick: () => void;
        active?: boolean;
        disabled?: boolean;
        avatar?: string;
    }) => {
        const label = t(entry.labelKey);
        const active = entry.active ?? false;
        const tone = entry.disabled
            ? "text-cad-muted/50 cursor-not-allowed"
            : active
              ? "bg-cad-primary/15 text-cad-primary font-medium"
              : "text-cad-text hover:bg-cad-text/10";

        if (collapsed) {
            return (
                <button
                    key={entry.key}
                    data-action={entry.key}
                    onClick={entry.onClick}
                    disabled={entry.disabled}
                    title={label}
                    aria-label={label}
                    aria-pressed={active}
                    className={`flex size-9 shrink-0 items-center justify-center rounded transition-all ${
                        entry.disabled ? "text-cad-muted/50 cursor-not-allowed" : tone
                    }`}
                >
                    {entry.avatar ? (
                        <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-[#137fec] to-[#0b63c1] text-[10px] font-bold text-white">
                            {entry.avatar}
                        </span>
                    ) : (
                        <span className="material-symbols-outlined text-[20px]">{entry.icon}</span>
                    )}
                </button>
            );
        }

        return (
            <button
                key={entry.key}
                data-action={entry.key}
                onClick={entry.onClick}
                disabled={entry.disabled}
                title={label}
                aria-pressed={active}
                className={`flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs transition-colors ${tone}`}
            >
                {entry.avatar ? (
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#137fec] to-[#0b63c1] text-[9px] font-bold text-white">
                        {entry.avatar}
                    </span>
                ) : (
                    <span className="material-symbols-outlined shrink-0 text-[18px]">
                        {entry.icon}
                    </span>
                )}
                <span className="min-w-0 flex-1 truncate">{label}</span>
            </button>
        );
    };

    /** 分组标题：点击折叠；收起态只画一条分隔线，名称留给 title */
    const renderGroupHeader = (key: string, labelKey: TranslationKey) => {
        const label = t(labelKey);
        if (collapsed) {
            return (
                <div
                    key={`head-${key}`}
                    data-group={key}
                    title={label}
                    className="my-1 h-px w-6 shrink-0 bg-cad-border"
                />
            );
        }
        const closed = closedGroups.has(key);
        return (
            <button
                key={`head-${key}`}
                data-group={key}
                onClick={() => toggleGroup(key)}
                aria-expanded={!closed}
                className="mt-1 flex w-full items-center gap-1 px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-cad-muted hover:text-cad-text"
            >
                <span className="material-symbols-outlined text-[14px]">
                    {closed ? "chevron_right" : "expand_more"}
                </span>
                {label}
            </button>
        );
    };

    /** 收起态的分组标题只是分隔线、点不动，所以图标条必须展开全部工具 */
    const groupOpen = (key: string) => collapsed || !closedGroups.has(key);

    const organizeEntries = useMemo(
        () => [
            {
                key: "group",
                icon: "group_work",
                labelKey: "toolbar.group" as TranslationKey,
                onClick: handleGroup,
                disabled: selectedIds.size < 2,
            },
            {
                key: "ungroup",
                icon: "group_off",
                labelKey: "toolbar.ungroup" as TranslationKey,
                onClick: handleUngroup,
            },
        ],
        [handleGroup, handleUngroup, selectedIds.size],
    );

    const avatar = currentUser?.username?.substring(0, 2).toUpperCase() ?? undefined;
    const panelEntriesWithAvatar = useMemo(
        () =>
            panelEntries.map((entry) =>
                entry.key === "panel-user" ? { ...entry, avatar } : entry,
            ),
        [avatar, panelEntries],
    );

    return (
        <aside
            className={`flex shrink-0 flex-col z-10 overflow-hidden border-r border-cad-border bg-cad-panel transition-[width] duration-150 ${
                collapsed ? "w-12" : "w-52"
            }`}
        >
            {" "}
            <div
                className={`flex h-8 shrink-0 items-center border-b border-cad-border ${
                    collapsed ? "justify-center" : "justify-between pl-2 pr-1"
                }`}
            >
                {!collapsed && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-cad-muted">
                        {t("toolbar.title")}
                    </span>
                )}
                <button
                    data-action="palette-toggle"
                    onClick={() => setCollapsed((prev) => !prev)}
                    title={t(collapsed ? "toolbar.expandPalette" : "toolbar.collapsePalette")}
                    aria-label={t(collapsed ? "toolbar.expandPalette" : "toolbar.collapsePalette")}
                    aria-expanded={!collapsed}
                    className="flex size-7 items-center justify-center rounded text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                >
                    <span className="material-symbols-outlined text-[18px]">
                        {collapsed ? "keyboard_double_arrow_right" : "keyboard_double_arrow_left"}
                    </span>
                </button>
            </div>
            <div
                className={`flex-1 overflow-y-auto py-1 ${
                    collapsed ? "flex flex-col items-center gap-1" : "flex flex-col gap-0.5 px-1.5"
                }`}
            >
                {TOOL_GROUPS.map((group) => (
                    <React.Fragment key={group.key}>
                        {renderGroupHeader(group.key, group.labelKey)}
                        {groupOpen(group.key) && group.tools.map(renderTool)}
                    </React.Fragment>
                ))}

                {renderGroupHeader("organize", "toolbar.organize")}
                {groupOpen("organize") && organizeEntries.map(renderAction)}

                {renderGroupHeader("panel", "toolbar.panel")}
                {groupOpen("panel") && panelEntriesWithAvatar.map(renderAction)}
            </div>
        </aside>
    );
};

export default Toolbar;
