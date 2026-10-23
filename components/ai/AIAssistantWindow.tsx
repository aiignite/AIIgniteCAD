import React, { useEffect, useMemo, useState } from "react";
import type { AIActionResponse, Assistant, CADElement, DesignConventions } from "../../types";
import type { DesignContextMeta } from "../../lib/aiContext";
import type { TurnMeta } from "../../hooks/useAIChat";
import { useAIRegistry } from "../../hooks/useAIRegistry";
import { useAIFloatingWindow } from "../../hooks/useAIFloatingWindow";
import { useCanvas } from "../../store/canvasStore";
import ChatPanel from "../chat/ChatPanel";
import { useI18n } from "../../lib/i18n";

const ASSISTANT_STORAGE_KEY = "cad_ai_selected_assistant_v1";

interface AIAssistantWindowProps {
    open: boolean;
    onClose: () => void;
    projectId: string | null;
    projectKey?: string | null;
    currentElements: CADElement[];
    selectedIds: ReadonlySet<string>;
    units?: string;
    conventions?: DesignConventions | null;
    projectName?: string;
    blockCount?: number;
    hiddenObjectCount?: number;
    onPreviewActions: (actions: AIActionResponse[], meta: TurnMeta) => void;
    draft?: { text: string; nonce: number } | null;
}

const HANDLES = [
    { dir: "n" as const, className: "left-3.5 right-3.5 top-0 h-1.5 cursor-ns-resize" },
    { dir: "s" as const, className: "left-3.5 right-3.5 bottom-0 h-1.5 cursor-ns-resize" },
    { dir: "w" as const, className: "top-3.5 bottom-3.5 left-0 w-1.5 cursor-ew-resize" },
    { dir: "e" as const, className: "top-3.5 bottom-3.5 right-0 w-1.5 cursor-ew-resize" },
    { dir: "nw" as const, className: "left-0 top-0 h-3.5 w-3.5 cursor-nwse-resize" },
    { dir: "ne" as const, className: "right-0 top-0 h-3.5 w-3.5 cursor-nesw-resize" },
    { dir: "sw" as const, className: "left-0 bottom-0 h-3.5 w-3.5 cursor-nesw-resize" },
    { dir: "se" as const, className: "right-0 bottom-0 h-3.5 w-3.5 cursor-nwse-resize" },
];

const DRAWER_HANDLE = {
    dir: "w" as const,
    className: "top-0 bottom-0 left-0 w-2 cursor-ew-resize hover:bg-cad-primary/30",
};

const readAssistantId = (): string | null => {
    try {
        return localStorage.getItem(ASSISTANT_STORAGE_KEY);
    } catch {
        return null;
    }
};

const AIAssistantWindow: React.FC<AIAssistantWindowProps> = ({
    open,
    onClose,
    projectId,
    projectKey,
    currentElements,
    selectedIds,
    units,
    conventions,
    projectName,
    blockCount = 0,
    hiddenObjectCount = 0,
    onPreviewActions,
    draft,
}) => {
    const { t } = useI18n();
    const { windowRef, compact, mode, drawerWidth, style, handlers, toggleMode } = useAIFloatingWindow();
    const registry = useAIRegistry();
    const { state: canvasState } = useCanvas();
    const [assistantId, setAssistantId] = useState<string | null>(readAssistantId);

    const assistant = useMemo(
        () => registry.assistants.find((item) => item.id === assistantId) ?? null,
        [registry.assistants, assistantId],
    );

    const contextMeta = useMemo<DesignContextMeta>(() => {
        const names = new Set<string>([
            "0",
            ...canvasState.layerOrder,
            ...currentElements.map((element) => element.layer || "0"),
        ]);
        const hiddenLayerElements = currentElements.filter((element) =>
            canvasState.hiddenLayers.includes(element.layer || "0"),
        ).length;
        return {
            projectName,
            units,
            layers: [...names].map((name) => ({
                name,
                visible: !canvasState.hiddenLayers.includes(name),
                locked: canvasState.lockedLayers.includes(name),
            })),
            blockCount,
            revision: canvasState.revision,
            hiddenCount: hiddenLayerElements + hiddenObjectCount,
        };
    }, [
        blockCount,
        canvasState.hiddenLayers,
        canvasState.layerOrder,
        canvasState.lockedLayers,
        canvasState.revision,
        currentElements,
        hiddenObjectCount,
        projectName,
        units,
    ]);

    const handleAssistantChange = (next: Assistant | null) => {
        setAssistantId(next?.id ?? null);
        try {
            if (next?.id) localStorage.setItem(ASSISTANT_STORAGE_KEY, next.id);
            else localStorage.removeItem(ASSISTANT_STORAGE_KEY);
        } catch {
            /* 存储不可用不影响选择本身 */
        }
    };

    useEffect(() => {
        if (!open) return undefined;
        const id = requestAnimationFrame(() => {
            windowRef.current
                ?.querySelector<HTMLTextAreaElement>("textarea")
                ?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(id);
    }, [open, windowRef]);

    // 关闭时把焦点移出隐藏面板，避免键盘事件继续落进不可见的输入框
    useEffect(() => {
        if (open) return;
        const node = windowRef.current;
        if (node && node.contains(document.activeElement)) {
            (document.activeElement as HTMLElement | null)?.blur();
        }
    }, [open, windowRef]);

    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            const target = event.target as HTMLElement | null;
            if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
            onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    const docked = !compact && mode === "drawer";
    const handles = compact ? [] : docked ? [DRAWER_HANDLE] : HANDLES;

    // 贴右时面板作为工作区的右列参与布局，与画布左右分开而不是浮在上层
    const placement = docked
        ? `relative z-20 h-full shrink-0 flex flex-col overflow-hidden bg-cad-bg border-l border-cad-border transition-[width] duration-150 ${open ? "" : "hidden"}`
        : `fixed z-40 flex flex-col overflow-hidden bg-cad-bg border border-cad-border shadow-2xl transition-[opacity,transform,visibility] duration-150 ${compact ? "" : "rounded-2xl"} ${open ? "scale-100 opacity-100" : "pointer-events-none invisible scale-[0.98] opacity-0"}`;

    return (
        <div
            ref={windowRef}
            role="dialog"
            aria-label={t("ai.title")}
            aria-modal="false"
            aria-hidden={!open}
            inert={!open}
            data-testid="ai-assistant-window"
            data-ai-window-mode={compact ? "compact" : mode}
            style={docked ? { width: `${drawerWidth}px` } : style}
            {...handlers}
            className={placement}
        >
            {handles.map(({ dir, className }) => (
                <div
                    key={dir}
                    data-ai-resize={dir}
                    aria-hidden="true"
                    className={`absolute z-10 touch-none ${className}`}
                />
            ))}

            <div
                data-ai-window-drag
                className={`flex shrink-0 items-center gap-2 border-b border-cad-border bg-cad-panel px-3 py-1.5 ${
                    docked ? "" : "cursor-move"
                }`}
            >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#137fec] to-[#0b63c1] text-white">
                    <span className="material-symbols-outlined text-[16px]">smart_toy</span>
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-bold text-cad-text">
                    {t("ai.title")}
                    <span className="ml-1.5 font-normal text-cad-muted">
                        {assistant?.name || "AI CAD Designer"}
                    </span>
                </span>
                <button
                    onClick={toggleMode}
                    disabled={compact}
                    className="rounded-md p-1.5 text-cad-muted transition-colors hover:bg-cad-text/10 hover:text-cad-text disabled:opacity-40"
                    title={docked ? t("ai.toFloating") : t("ai.toDrawer")}
                    aria-label={docked ? t("ai.toFloating") : t("ai.toDrawer")}
                >
                    <span className="material-symbols-outlined text-[18px]">
                        {docked ? "open_in_full" : "dock_to_right"}
                    </span>
                </button>
                <button
                    onClick={onClose}
                    className="rounded-md p-1.5 text-cad-muted transition-colors hover:bg-cad-text/10 hover:text-cad-text"
                    title={t("ai.close")}
                    aria-label={t("ai.closeAria")}
                >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>

            <div className="min-h-0 flex-1">
                <ChatPanel
                    projectId={projectId}
                    projectKey={projectKey}
                    currentElements={currentElements}
                    selectedIds={selectedIds}
                    units={units}
                    contextMeta={contextMeta}
                    conventions={conventions}
                    registry={registry}
                    assistant={assistant}
                    onAssistantChange={handleAssistantChange}
                    onPreviewActions={onPreviewActions}
                    active={open}
                    draft={draft}
                />
            </div>
        </div>
    );
};

export default AIAssistantWindow;
