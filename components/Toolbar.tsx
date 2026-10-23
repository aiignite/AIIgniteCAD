/**
 * Toolbar.tsx — CAD 工具栏组件
 *
 * 工具按 绘图 / 修改 / 标注 / 参数化 分组：主条常驻高频工具，
 * 低频工具收进溢出菜单，仍按同一套分组展示。
 */

import React, { useState, useEffect, useRef } from 'react';
import { ToolType } from '../types';
import { useCanvas } from '../store/canvasStore';
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

/**
 * 工具栏图标按钮
 * 提取为模块级组件，避免在 Toolbar 渲染过程中重复创建组件类型
 */
const ToolButton: React.FC<{
    active: boolean;
    tool: string;
    icon: string;
    label: string;
    onClick: () => void;
}> = ({ active, tool, icon, label, onClick }) => (
    <button
        onClick={onClick}
        data-tool={tool}
        className={`group relative flex size-9 items-center justify-center rounded transition-all shrink-0
        ${active ? 'bg-cad-primary text-white shadow-md' : 'text-gray-400 hover:bg-cad-text/10 hover:text-cad-text'}`}
        title={label}
    >
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
        <span className="absolute left-10 bg-black text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-lg select-none">
            {label}
        </span>
    </button>
);

export const Toolbar: React.FC = () => {
    const { t } = useI18n();
    const { state, setActiveTool } = useCanvas();
    const { activeTool } = state;
    const [showOverflow, setShowOverflow] = useState(false);
    const overflowRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) {
                setShowOverflow(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    /** 渲染指定工具按钮 */
    const renderTool = (tool: ToolType, icon: string, labelKey: TranslationKey) => (
        <ToolButton
            tool={tool}
            icon={icon}
            label={t(labelKey)}
            active={activeTool === tool}
            onClick={() => setActiveTool(tool)}
        />
    );

    const handleToolSelect = (tool: ToolType) => {
        setActiveTool(tool);
        setShowOverflow(false);
    };

    return (
        <aside className="w-12 bg-cad-panel border-r border-cad-border flex flex-col items-center py-3 gap-1 shrink-0 z-10 relative">
            {PRIMARY_GROUPS.map((group, index) => (
                <React.Fragment key={group.key}>
                    {index > 0 && (
                        <div
                            className="w-6 h-px bg-cad-border my-1 shrink-0"
                            data-group={group.key}
                            title={t(group.labelKey)}
                        ></div>
                    )}
                    {group.tools.map(entry => (
                        <React.Fragment key={entry.tool}>
                            {renderTool(entry.tool, entry.icon, entry.labelKey)}
                        </React.Fragment>
                    ))}
                </React.Fragment>
            ))}

            <div className="flex-1"></div>

            {/* Overflow Menu */}
            <div className="relative" ref={overflowRef}>
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
                        className="absolute left-10 bottom-0 mb-0 ml-2 bg-cad-panel border border-cad-border rounded shadow-xl p-2 flex flex-col gap-1 z-50 w-40 animate-in fade-in zoom-in duration-100"
                        data-action="tool-overflow"
                    >
                        {OVERFLOW_GROUPS.map((group, index) => (
                            <React.Fragment key={group.key}>
                                {index > 0 && <div className="h-px bg-cad-border my-1"></div>}
                                <div
                                    className="text-[10px] font-bold text-cad-muted uppercase px-2 py-1"
                                    data-group={group.key}
                                >
                                    {t(group.labelKey)}
                                </div>
                                {group.tools.map(entry => (
                                    <button
                                        key={entry.tool}
                                        onClick={() => handleToolSelect(entry.tool)}
                                        data-tool={entry.tool}
                                        className={`flex items-center gap-3 px-2 py-1.5 rounded text-xs transition-colors
                                        ${activeTool === entry.tool ? 'bg-cad-primary/10 text-cad-primary' : 'text-cad-text hover:bg-cad-text/5'}`}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">{entry.icon}</span> {t(entry.labelKey)}
                                    </button>
                                ))}
                            </React.Fragment>
                        ))}
                    </div>
                )}
            </div>
        </aside>
    );
};
