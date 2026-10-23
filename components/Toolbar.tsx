/**
 * Toolbar.tsx — CAD 工具栏组件
 *
 * 工具按 绘图 / 修改 / 标注 / 参数化 分组：主条常驻高频工具，
 * 低频工具收进溢出菜单，仍按同一套分组展示。
 *
 * 左侧由两列组成：左列是画布工具与组合动作，右列是右侧面板的导航；
 * 竖向放不下时按顺序收进「更多」菜单。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SidePanelMode, ToolType } from '../types';
import { useCanvas } from '../store/canvasStore';
import { useApp } from '../store/appStore';
import { groupElements, ungroupElements } from '../lib/groups';
import { useI18n, type TranslationKey } from '../lib/i18n';

interface ToolEntry {
    tool: ToolType;
    icon: string;
    labelKey: TranslationKey;
}

interface ToolGroup {
    key: string;
    labelKey: TranslationKey;
    tools: ToolEntry[];
}

/** 主工具条：常驻高频工具，按组分隔 */
const PRIMARY_GROUPS: ToolGroup[] = [
    {
        key: 'navigate',
        labelKey: 'toolbar.navigate',
        tools: [
            { tool: ToolType.SELECT, icon: 'arrow_selector_tool', labelKey: 'toolbar.select' },
            { tool: ToolType.PAN, icon: 'drag_pan', labelKey: 'toolbar.pan' },
        ],
    },
    {
        key: 'draw',
        labelKey: 'toolbar.draw',
        tools: [
            { tool: ToolType.LINE, icon: 'remove', labelKey: 'toolbar.line' },
            { tool: ToolType.POLYLINE, icon: 'polyline', labelKey: 'toolbar.polyline' },
            { tool: ToolType.CIRCLE, icon: 'circle', labelKey: 'toolbar.circle' },
            { tool: ToolType.RECTANGLE, icon: 'rectangle', labelKey: 'toolbar.rectangle' },
            { tool: ToolType.ARC, icon: 'architecture', labelKey: 'toolbar.arc' },
            { tool: ToolType.TEXT, icon: 'title', labelKey: 'toolbar.text' },
        ],
    },
    {
        key: 'modify',
        labelKey: 'toolbar.modify',
        tools: [
            { tool: ToolType.COPY, icon: 'content_copy', labelKey: 'toolbar.copy' },
            { tool: ToolType.TRIM, icon: 'content_cut', labelKey: 'toolbar.trim' },
        ],
    },
];

/** 溢出菜单：低频工具，分组与主条保持一致 */
const OVERFLOW_GROUPS: ToolGroup[] = [
    {
        key: 'draw',
        labelKey: 'toolbar.draw',
        tools: [
            { tool: ToolType.HATCH, icon: 'texture', labelKey: 'toolbar.hatch' },
        ],
    },
    {
        key: 'modify',
        labelKey: 'toolbar.modify',
        tools: [
            { tool: ToolType.MIRROR, icon: 'flip', labelKey: 'toolbar.mirror' },
            { tool: ToolType.ROTATE, icon: 'rotate_right', labelKey: 'toolbar.rotate' },
            { tool: ToolType.SCALE, icon: 'aspect_ratio', labelKey: 'toolbar.scale' },
            { tool: ToolType.OFFSET, icon: 'format_indent_increase', labelKey: 'toolbar.offset' },
            { tool: ToolType.ARRAY, icon: 'grid_view', labelKey: 'toolbar.array' },
        ],
    },
    {
        key: 'annotate',
        labelKey: 'toolbar.annotate',
        tools: [
            { tool: ToolType.DIMENSION, icon: 'straighten', labelKey: 'toolbar.dimension' },
            { tool: ToolType.MEASURE, icon: 'square_foot', labelKey: 'toolbar.measure' },
        ],
    },
    {
        key: 'parametric',
        labelKey: 'toolbar.parametric',
        tools: [
            { tool: ToolType.GEAR, icon: 'settings', labelKey: 'toolbar.gear' },
            { tool: ToolType.POLYGON, icon: 'hexagon', labelKey: 'toolbar.polygon' },
            { tool: ToolType.ELLIPSE, icon: 'circle', labelKey: 'toolbar.ellipse' },
            { tool: ToolType.SPIRAL, icon: 'water_voc', labelKey: 'toolbar.spiral' },
            { tool: ToolType.SPRING, icon: 'toys', labelKey: 'toolbar.spring' },
            { tool: ToolType.INVOLUTE, icon: 'show_chart', labelKey: 'toolbar.involute' },
        ],
    },
];

/** 工具栏条目：画布工具，或直接执行的动作 / 面板导航 */
type ToolbarEntry =
    | { kind: 'tool'; key: string; tool: ToolType; icon: string; labelKey: TranslationKey }
    | {
          kind: 'button';
          key: string;
          icon: string;
          labelKey: TranslationKey;
          onClick: () => void;
          active?: boolean;
          disabled?: boolean;
          /** 头像类按钮：用首字缩写代替图标 */
          avatar?: string;
      };

/** 工具栏行：分隔线或条目 */
interface ToolbarRow {
    kind: 'sep' | 'entry';
    sectionKey: string;
    sectionLabel: TranslationKey;
    entry?: ToolbarEntry;
}

/** 「更多」菜单里的分组 */
interface OverflowSection {
    key: string;
    label: TranslationKey;
    entries: ToolbarEntry[];
}

interface ToolbarProps {
    /** 打开图纸（文件夹）管理弹窗 */
    onOpenFiles: () => void;
    /** 当前登录用户，用于面板入口的头像 */
    currentUser?: any;
    /** 打开用户资料 */
    onShowUserProfile?: () => void;
}

/** 竖向排布的尺寸常量，用于判断放不下哪些按钮 */
const ITEM_HEIGHT = 36;
const SEPARATOR_HEIGHT = 9;
const ROW_GAP = 4;
const MORE_BUTTON_HEIGHT = 36;
const ASIDE_PADDING = 24;

/** 分组在「更多」菜单中的展示顺序 */
const SECTION_ORDER = [
    'navigate',
    'draw',
    'modify',
    'annotate',
    'parametric',
    'organize',
    'panel',
];

/**
 * 工具栏图标按钮
 * 提取为模块级组件，避免在 Toolbar 渲染过程中重复创建组件类型
 */
const ToolButton: React.FC<{
    active: boolean;
    tool?: string;
    action?: string;
    icon: string;
    label: string;
    disabled?: boolean;
    avatar?: string;
    onClick: () => void;
}> = ({ active, tool, action, icon, label, disabled, avatar, onClick }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        data-tool={tool}
        data-action={action}
        className={`group relative flex size-9 items-center justify-center rounded transition-all shrink-0
        ${disabled ? 'text-gray-600 cursor-not-allowed' : active ? 'bg-cad-primary text-white shadow-md' : 'text-gray-400 hover:bg-cad-text/10 hover:text-cad-text'}`}
        title={label}
    >
        {avatar ? (
            <span className="size-8 rounded-full bg-gradient-to-br from-[#137fec] to-[#0b63c1] flex items-center justify-center text-[10px] font-bold text-white">
                {avatar}
            </span>
        ) : (
            <span className="material-symbols-outlined text-[20px]">{icon}</span>
        )}
        <span className="absolute left-10 bg-black text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-lg select-none">
            {label}
        </span>
    </button>
);

export const Toolbar: React.FC<ToolbarProps> = ({
    onOpenFiles,
    currentUser,
    onShowUserProfile,
}) => {
    const { t } = useI18n();
    const { state, selectedIds, setActiveTool, commitAction } = useCanvas();
    const { activeTool, elements } = state;
    const { state: appState, setSideMode, setSidePanelOpen, showNotification } = useApp();
    const [showOverflow, setShowOverflow] = useState(false);
    const overflowRef = useRef<HTMLDivElement>(null);
    const asideRef = useRef<HTMLElement>(null);
    /** 工具栏可用高度；null 表示尚未测量，先按全部显示渲染 */
    const [availableHeight, setAvailableHeight] = useState<number | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) {
                setShowOverflow(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // 测量工具栏高度：放不下的按钮收进「更多」菜单
    useEffect(() => {
        const node = asideRef.current;
        if (!node) return undefined;
        const update = () => setAvailableHeight(node.clientHeight);
        update();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', update);
            return () => window.removeEventListener('resize', update);
        }
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    /** 把选中的图元聚为一个组合 */
    const handleGroup = useCallback(() => {
        if (selectedIds.size < 2) {
            showNotification(t('notify.groupNeedMore'));
            return;
        }
        commitAction(groupElements(elements, selectedIds));
        showNotification(t('notify.grouped', { count: selectedIds.size }));
    }, [commitAction, elements, selectedIds, showNotification, t]);

    /** 解散选中图元所在的组合 */
    const handleUngroup = useCallback(() => {
        const next = ungroupElements(elements, selectedIds);
        if (next === elements) {
            showNotification(t('notify.notGrouped'));
            return;
        }
        commitAction(next);
        showNotification(t('notify.ungrouped'));
    }, [commitAction, elements, selectedIds, showNotification, t]);

    /** 打开右侧面板并切换到指定模式 */
    const openSidePanel = useCallback(
        (mode: SidePanelMode) => {
            setSideMode(mode);
            setSidePanelOpen(true);
        },
        [setSideMode, setSidePanelOpen],
    );

    /** 左列：画布工具与组合动作 */
    const toolRows = useMemo<ToolbarRow[]>(() => {
        const rows: ToolbarRow[] = [];

        PRIMARY_GROUPS.forEach((group, index) => {
            if (index > 0) {
                rows.push({ kind: 'sep', sectionKey: group.key, sectionLabel: group.labelKey });
            }
            group.tools.forEach((tool) => {
                rows.push({
                    kind: 'entry',
                    sectionKey: group.key,
                    sectionLabel: group.labelKey,
                    entry: {
                        kind: 'tool',
                        key: tool.tool,
                        tool: tool.tool,
                        icon: tool.icon,
                        labelKey: tool.labelKey,
                    },
                });
            });
        });

        rows.push({ kind: 'sep', sectionKey: 'organize', sectionLabel: 'toolbar.organize' });
        rows.push({
            kind: 'entry',
            sectionKey: 'organize',
            sectionLabel: 'toolbar.organize',
            entry: {
                kind: 'button',
                key: 'group',
                icon: 'group_work',
                labelKey: 'toolbar.group',
                onClick: handleGroup,
                disabled: selectedIds.size < 2,
            },
        });
        rows.push({
            kind: 'entry',
            sectionKey: 'organize',
            sectionLabel: 'toolbar.organize',
            entry: {
                kind: 'button',
                key: 'ungroup',
                icon: 'group_off',
                labelKey: 'toolbar.ungroup',
                onClick: handleUngroup,
            },
        });

        return rows;
    }, [handleGroup, handleUngroup, selectedIds.size]);

    /** 右列：右侧面板的导航 */
    const panelRows = useMemo<ToolbarRow[]>(() => {
        const entries: ToolbarEntry[] = [
            {
                kind: 'button',
                key: 'panel-review',
                icon: 'rule',
                labelKey: 'panel.review',
                onClick: () => openSidePanel(SidePanelMode.REVIEW),
                active: appState.sidePanelOpen && appState.sideMode === SidePanelMode.REVIEW,
            },
            {
                kind: 'button',
                key: 'panel-conventions',
                icon: 'design_services',
                labelKey: 'panel.conventions',
                onClick: () => openSidePanel(SidePanelMode.CONVENTIONS),
                active: appState.sidePanelOpen && appState.sideMode === SidePanelMode.CONVENTIONS,
            },
            {
                kind: 'button',
                key: 'panel-files',
                icon: 'folder_open',
                labelKey: 'panel.files',
                onClick: onOpenFiles,
            },
            {
                kind: 'button',
                key: 'panel-settings',
                icon: 'settings',
                labelKey: 'panel.settings',
                onClick: () => openSidePanel(SidePanelMode.SETTINGS),
                active: appState.sidePanelOpen && appState.sideMode === SidePanelMode.SETTINGS,
            },
        ];

        if (currentUser) {
            entries.push({
                kind: 'button',
                key: 'panel-user',
                icon: 'account_circle',
                labelKey: 'panel.clickProfile',
                avatar: currentUser.username?.substring(0, 2).toUpperCase() ?? 'U',
                onClick: () => {
                    openSidePanel(SidePanelMode.USER_INFO);
                    onShowUserProfile?.();
                },
                active: appState.sidePanelOpen && appState.sideMode === SidePanelMode.USER_INFO,
            });
        }

        entries.push({
            kind: 'button',
            key: 'panel-toggle',
            icon: appState.sidePanelOpen
                ? 'keyboard_double_arrow_right'
                : 'keyboard_double_arrow_left',
            labelKey: appState.sidePanelOpen ? 'panel.collapse' : 'panel.expand',
            onClick: () => setSidePanelOpen(!appState.sidePanelOpen),
            active: appState.sidePanelOpen,
        });

        return [
            {
                kind: 'entry',
                sectionKey: 'panel',
                sectionLabel: 'toolbar.panel',
                entry: entries[0],
            },
            ...entries.slice(1).map((entry) => ({
                kind: 'entry' as const,
                sectionKey: 'panel',
                sectionLabel: 'toolbar.panel' as TranslationKey,
                entry,
            })),
        ];
    }, [
        appState.sideMode,
        appState.sidePanelOpen,
        currentUser,
        onOpenFiles,
        onShowUserProfile,
        openSidePanel,
        setSidePanelOpen,
    ]);

    /**
     * 按可用高度切分：放不下的条目进入「更多」菜单。
     * 顺序即优先级，底部面板导航最先被收起。
     */
    const splitByHeight = useCallback(
        (rows: ToolbarRow[], reserve: number) => {
            if (availableHeight === null) return { visible: rows, overflow: [] as ToolbarRow[] };

            const budget = availableHeight - ASIDE_PADDING - reserve;
            const visible: ToolbarRow[] = [];
            const overflow: ToolbarRow[] = [];
            let used = 0;

            for (const row of rows) {
                const height = row.kind === 'sep' ? SEPARATOR_HEIGHT : ITEM_HEIGHT;
                if (used + height + ROW_GAP <= budget) {
                    visible.push(row);
                    used += height + ROW_GAP;
                } else {
                    overflow.push(row);
                }
            }

            while (overflow.length > 0 && overflow[0].kind === 'sep') overflow.shift();
            return { visible, overflow };
        },
        [availableHeight],
    );

    const toolSplit = useMemo(
        () => splitByHeight(toolRows, MORE_BUTTON_HEIGHT + ROW_GAP),
        [splitByHeight, toolRows],
    );
    const panelSplit = useMemo(
        () => splitByHeight(panelRows, ROW_GAP),
        [panelRows, splitByHeight],
    );

    /**
     * 「更多」菜单按分组汇总：放不下的主条条目与固定低频工具合并到同一分组，
     * 保证每个分组标题只出现一次。
     */
    const overflowSections = useMemo<OverflowSection[]>(() => {
        const sections = new Map<string, OverflowSection>();

        const push = (key: string, label: TranslationKey, entry: ToolbarEntry) => {
            const section = sections.get(key);
            if (section) section.entries.push(entry);
            else sections.set(key, { key, label, entries: [entry] });
        };

        [...toolSplit.overflow, ...panelSplit.overflow].forEach((row) => {
            if (row.kind === 'entry' && row.entry) push(row.sectionKey, row.sectionLabel, row.entry);
        });
        OVERFLOW_GROUPS.forEach((group) => {
            group.tools.forEach((tool) =>
                push(group.key, group.labelKey, {
                    kind: 'tool',
                    key: tool.tool,
                    tool: tool.tool,
                    icon: tool.icon,
                    labelKey: tool.labelKey,
                }),
            );
        });

        return [...sections.values()].sort(
            (a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key),
        );
    }, [panelSplit.overflow, toolSplit.overflow]);

    const handleToolSelect = (tool: ToolType) => {
        setActiveTool(tool);
        setShowOverflow(false);
    };

    /** 渲染一个工具栏条目（主条与更多菜单共用） */
    const renderEntry = (entry: ToolbarEntry, inMenu: boolean) => {
        if (entry.kind === 'tool') {
            if (inMenu) {
                return (
                    <button
                        key={entry.key}
                        onClick={() => handleToolSelect(entry.tool)}
                        data-tool={entry.tool}
                        className={`flex items-center gap-3 px-2 py-1.5 rounded text-xs transition-colors
                                        ${activeTool === entry.tool ? 'bg-cad-primary/10 text-cad-primary' : 'text-cad-text hover:bg-cad-text/5'}`}
                    >
                        <span className="material-symbols-outlined text-[18px]">{entry.icon}</span>{' '}
                        {t(entry.labelKey)}
                    </button>
                );
            }
            return (
                <ToolButton
                    key={entry.key}
                    tool={entry.tool}
                    icon={entry.icon}
                    label={t(entry.labelKey)}
                    active={activeTool === entry.tool}
                    onClick={() => setActiveTool(entry.tool)}
                />
            );
        }

        if (inMenu) {
            return (
                <button
                    key={entry.key}
                    onClick={() => {
                        entry.onClick();
                        setShowOverflow(false);
                    }}
                    disabled={entry.disabled}
                    data-action={entry.key}
                    className={`flex items-center gap-3 px-2 py-1.5 rounded text-xs transition-colors text-left
                                    ${entry.disabled ? 'text-cad-muted/50 cursor-not-allowed' : entry.active ? 'bg-cad-primary/10 text-cad-primary' : 'text-cad-text hover:bg-cad-text/5'}`}
                >
                    <span className="material-symbols-outlined text-[18px]">{entry.icon}</span>{' '}
                    {t(entry.labelKey)}
                </button>
            );
        }

        return (
            <ToolButton
                key={entry.key}
                action={entry.key}
                icon={entry.icon}
                label={t(entry.labelKey)}
                active={entry.active ?? false}
                disabled={entry.disabled}
                avatar={entry.avatar}
                onClick={entry.onClick}
            />
        );
    };

    /** 主条中的一行 */
    const renderRow = (row: ToolbarRow) =>
        row.kind === 'sep' ? (
            <div
                key={`sep-${row.sectionKey}`}
                className="w-6 h-px bg-cad-border my-1 shrink-0"
                data-group={row.sectionKey}
                title={t(row.sectionLabel)}
            ></div>
        ) : (
            <React.Fragment key={row.entry!.key}>{renderEntry(row.entry!, false)}</React.Fragment>
        );

    return (
        <aside
            ref={asideRef}
            className="flex shrink-0 z-10 bg-cad-panel border-r border-cad-border overflow-hidden"
        >
            {/* 左列：画布工具 */}
            <div className="w-12 flex flex-col items-center py-3 gap-1">
                <div className="flex flex-col items-center gap-1 w-full shrink-0">
                    {toolSplit.visible.map(renderRow)}
                </div>

                <div className="flex-1"></div>

                {/* Overflow Menu */}
                <div className="relative shrink-0" ref={overflowRef}>
                    <button
                        onClick={() => setShowOverflow(!showOverflow)}
                        className={`group relative flex size-9 items-center justify-center rounded transition-all shrink-0
                    ${showOverflow ? 'bg-cad-text/10 text-cad-text' : 'text-gray-400 hover:bg-cad-text/10 hover:text-cad-text'}`}
                        title={t('toolbar.more')}
                    >
                        <span className="material-symbols-outlined text-[20px]">more_horiz</span>
                    </button>

                    {showOverflow && (
                        <div
                            className="absolute left-10 bottom-0 mb-0 ml-2 bg-cad-panel border border-cad-border rounded shadow-xl p-2 flex flex-col gap-1 z-50 w-44 max-h-[70vh] overflow-y-auto animate-in fade-in zoom-in duration-100"
                            data-action="tool-overflow"
                        >
                            {overflowSections.map((section, index) => (
                                <React.Fragment key={section.key}>
                                    {index > 0 && <div className="h-px bg-cad-border my-1"></div>}
                                    <div
                                        className="text-[10px] font-bold text-cad-muted uppercase px-2 py-1"
                                        data-group={section.key}
                                    >
                                        {t(section.label)}
                                    </div>
                                    {section.entries.map((entry) => renderEntry(entry, true))}
                                </React.Fragment>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* 右列：右侧面板导航 */}
            <div className="w-12 flex flex-col items-center py-3 gap-1 border-l border-cad-border">
                {panelSplit.visible.map(renderRow)}
            </div>
        </aside>
    );
};
