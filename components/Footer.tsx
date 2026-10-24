/**
 * Footer.tsx — 底部状态栏组件
 * 提供命令行输入和状态切换（GRID/SNAP/ORTHO）
 */

import React, { useSyncExternalStore } from 'react';
import { useCanvas } from '../store/canvasStore';
import { getCanvasStatus, subscribeCanvasStatus } from '../store/canvasStatus';
import { useCommandInput } from '../hooks/useCommandInput';
import { snapTypeLabel } from '../lib/snapping';
import { useI18n } from '../lib/i18n';
import { CollaborationToggle } from './CollaborationToggle';

interface FooterProps {
    onCommand: (cmd: string) => void;
    /** 被隔离 / 隐藏命令藏起来的图元数量，0 时不显示入口 */
    hiddenCount: number;
    /** 清除临时隐藏集 */
    onShowAllObjects: () => void;
    /** 当前图纸名：显示在状态栏，无图纸时回退到模型空间占位 */
    drawingName?: string;
}

/**
 * 状态栏开关按钮
 * 提取为模块级组件，避免每次渲染都创建新的组件类型
 */
const ToggleButton: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
    <button
        onClick={onClick}
        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors font-mono
        ${active ? 'bg-cad-primary/20 text-cad-primary shadow-sm border border-cad-primary/30' : 'hover:bg-cad-text/10 text-cad-muted hover:text-cad-text border border-transparent'}`}
    >
        {label}
    </button>
);

export const Footer: React.FC<FooterProps> = ({ onCommand, hiddenCount, onShowAllObjects, drawingName }) => {
    const { t } = useI18n();
    const { state, dispatch } = useCanvas();
    const { orthoMode, polarMode, snapMode, gridMode, drawingSettings } = state;
    const commandInput = useCommandInput(onCommand);
    const canvasStatus = useSyncExternalStore(
        subscribeCanvasStatus,
        getCanvasStatus,
        getCanvasStatus,
    );

    const precision = Math.min(Math.max(drawingSettings.dimPrecision, 0), 4);
    const coordinate = (value: number) =>
        canvasStatus.active ? value.toFixed(precision) : "—";

    return (
        <footer className="flex flex-col shrink-0 z-20 border-t border-cad-border bg-cad-panel transition-colors duration-300">
            {/* Command Line Input */}
            <div className="flex items-center px-4 py-2 border-b border-cad-border/50 bg-cad-bg transition-colors duration-300">
                <span className="text-cad-primary font-mono text-sm mr-2 font-bold">&gt;</span>
                <input
                    id="command-input"
                    className="bg-transparent border-none text-cad-text text-sm w-full focus:ring-0 placeholder-gray-500 font-mono focus:outline-none transition-colors duration-300" 
                    placeholder={commandInput.prompt ?? t("footer.commandPlaceholder")} 
                    type="text"
                    value={commandInput.value}
                    onChange={(e) => commandInput.onChange(e.target.value)}
                    onKeyDown={commandInput.onKeyDown}
                />
                <div className="flex items-center gap-2 min-w-0 max-w-[55%] shrink-0">
                    {commandInput.hint ? (
                        <span className={`text-[10px] font-mono truncate ${commandInput.pending ? 'text-cad-primary' : 'text-cad-muted'}`}>
                            {commandInput.hint}
                        </span>
                    ) : (
                        <div className="hidden md:flex items-center gap-2">
                            <span className="text-[10px] text-cad-muted font-mono border border-cad-border rounded px-1.5 py-0.5 cursor-pointer hover:bg-cad-text/10 hover:text-cad-text transition-colors">{t("footer.esc")}</span>
                            <span className="text-[10px] text-cad-muted font-mono border border-cad-border rounded px-1.5 py-0.5 cursor-pointer hover:bg-cad-text/10 hover:text-cad-text transition-colors">{t("footer.tab")}</span>
                            <span className="text-[10px] text-cad-muted font-mono border border-cad-border rounded px-1.5 py-0.5 cursor-pointer hover:bg-cad-text/10 hover:text-cad-text transition-colors">{t("footer.history")}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Status Bar */}
            <div className="flex items-center justify-between gap-4 px-4 h-8 bg-cad-panel text-[11px] text-cad-muted font-medium select-none transition-colors duration-300">
                <div className="flex items-center gap-4 font-mono min-w-0">
                    <span
                        className="text-cad-text truncate max-w-[380px]"
                        title={canvasStatus.hint}
                    >
                        {canvasStatus.hint || t("footer.ready")}
                    </span>
                    <span className="hidden md:inline">X <span className="text-cad-text">{coordinate(canvasStatus.x)}</span></span>
                    <span className="hidden md:inline">Y <span className="text-cad-text">{coordinate(canvasStatus.y)}</span></span>
                    <span>{t("footer.zoom")} <span className="text-cad-text">{canvasStatus.zoomPercent}%</span></span>
                    <span className="min-w-[92px] text-cad-primary font-bold">
                        {canvasStatus.snapType
                            ? t("footer.snap", { type: snapTypeLabel(canvasStatus.snapType) })
                            : ""}
                    </span>
                </div>
                
                <div className="flex items-center gap-1 shrink-0">
                    {/* 当前图纸名：只读展示，无图纸时回退模型空间占位 */}
                    <span className="max-w-[160px] truncate px-2 py-0.5 rounded text-cad-muted font-bold transition-colors" title={drawingName}>
                        {drawingName ?? t("footer.modelSpace")}
                    </span>
                    <div className="w-px h-3 bg-cad-border mx-1"></div>
                    {hiddenCount > 0 && (
                        <button
                            data-action="show-all-objects"
                            onClick={onShowAllObjects}
                            title={t("footer.showAll")}
                            className="px-2 py-0.5 rounded text-[10px] font-bold border transition-colors
                            bg-amber-500/15 text-amber-600 border-amber-500/30 hover:bg-amber-500/25 dark:text-amber-400"
                        >
                            {t("footer.hidden", { count: hiddenCount })}
                        </button>
                    )}
                    <ToggleButton label={t("footer.grid")} active={gridMode} onClick={() => dispatch({ type: "SET_GRID_MODE", value: !gridMode })} />
                    <ToggleButton label={t("footer.snapToggle")} active={snapMode} onClick={() => dispatch({ type: "SET_SNAP_MODE", value: !snapMode })} />
                    <ToggleButton label={t("footer.ortho")} active={orthoMode} onClick={() => dispatch({ type: "SET_ORTHO_MODE", value: !orthoMode })} />
                    <ToggleButton label={t("footer.polar")} active={polarMode} onClick={() => dispatch({ type: "SET_POLAR_MODE", value: !polarMode })} />
                    <div className="w-px h-3 bg-cad-border mx-1"></div>
                    <CollaborationToggle />
                </div>
            </div>
        </footer>
    );
};
