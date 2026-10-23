/**
 * Toolbar.tsx — CAD 工具栏组件
 *
 * 工具按 绘图 / 修改 / 标注 / 参数化 分组：主条常驻高频工具，
 * 低频工具收进溢出菜单，仍按同一套分组展示。
 */

import React, { useState, useEffect, useRef } from 'react';
import { ToolType } from '../types';
import { useCanvas } from '../store/canvasStore';

interface ToolEntry {
    tool: ToolType;
    icon: string;
    label: string;
}

interface ToolGroup {
    key: string;
    label: string;
    tools: ToolEntry[];
}

/** 主工具条：常驻高频工具，按组分隔 */
const PRIMARY_GROUPS: ToolGroup[] = [
    {
        key: 'navigate',
        label: '导航',
        tools: [
            { tool: ToolType.SELECT, icon: 'arrow_selector_tool', label: '选择' },
            { tool: ToolType.PAN, icon: 'drag_pan', label: '平移' },
        ],
    },
    {
        key: 'draw',
        label: '绘图',
        tools: [
            { tool: ToolType.LINE, icon: 'remove', label: '直线' },
            { tool: ToolType.POLYLINE, icon: 'polyline', label: '多段线' },
            { tool: ToolType.CIRCLE, icon: 'circle', label: '圆' },
            { tool: ToolType.RECTANGLE, icon: 'rectangle', label: '矩形' },
            { tool: ToolType.ARC, icon: 'architecture', label: '圆弧' },
            { tool: ToolType.TEXT, icon: 'title', label: '文字' },
        ],
    },
    {
        key: 'modify',
        label: '修改',
        tools: [
            { tool: ToolType.COPY, icon: 'content_copy', label: '复制' },
            { tool: ToolType.TRIM, icon: 'content_cut', label: '修剪' },
        ],
    },
];

/** 溢出菜单：低频工具，分组与主条保持一致 */
const OVERFLOW_GROUPS: ToolGroup[] = [
    {
        key: 'draw',
        label: '绘图',
        tools: [
            { tool: ToolType.HATCH, icon: 'texture', label: '填充' },
        ],
    },
    {
        key: 'modify',
        label: '修改',
        tools: [
            { tool: ToolType.MIRROR, icon: 'flip', label: '镜像' },
            { tool: ToolType.ROTATE, icon: 'rotate_right', label: '旋转' },
            { tool: ToolType.SCALE, icon: 'aspect_ratio', label: '缩放选中' },
            { tool: ToolType.OFFSET, icon: 'format_indent_increase', label: '偏移选中' },
            { tool: ToolType.ARRAY, icon: 'grid_view', label: '阵列选中' },
        ],
    },
    {
        key: 'annotate',
        label: '标注',
        tools: [
            { tool: ToolType.DIMENSION, icon: 'straighten', label: '标注' },
            { tool: ToolType.MEASURE, icon: 'square_foot', label: '测量' },
        ],
    },
    {
        key: 'parametric',
        label: '参数化',
        tools: [
            { tool: ToolType.GEAR, icon: 'settings', label: '齿轮' },
            { tool: ToolType.POLYGON, icon: 'hexagon', label: '多边形' },
            { tool: ToolType.ELLIPSE, icon: 'circle', label: '椭圆' },
            { tool: ToolType.SPIRAL, icon: 'water_voc', label: '螺旋' },
            { tool: ToolType.SPRING, icon: 'toys', label: '弹簧' },
            { tool: ToolType.INVOLUTE, icon: 'show_chart', label: '渐开线' },
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
    const renderTool = (tool: ToolType, icon: string, label: string) => (
        <ToolButton
            tool={tool}
            icon={icon}
            label={label}
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
                            title={`${group.label}工具`}
                        ></div>
                    )}
                    {group.tools.map(entry => (
                        <React.Fragment key={entry.tool}>
                            {renderTool(entry.tool, entry.icon, entry.label)}
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
                    title="更多工具"
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
                                    {group.label}
                                </div>
                                {group.tools.map(entry => (
                                    <button
                                        key={entry.tool}
                                        onClick={() => handleToolSelect(entry.tool)}
                                        data-tool={entry.tool}
                                        className={`flex items-center gap-3 px-2 py-1.5 rounded text-xs transition-colors
                                        ${activeTool === entry.tool ? 'bg-cad-primary/10 text-cad-primary' : 'text-cad-text hover:bg-cad-text/5'}`}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">{entry.icon}</span> {entry.label}
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
