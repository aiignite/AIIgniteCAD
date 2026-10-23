/**
 * useAIFloatingWindow — AI 浮窗的指针交互与几何状态
 *
 * 拖动/缩放期间直接写 DOM 样式，松手后一次性提交 state，
 * 避免每一帧都触发 React 重渲染。
 */

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
} from "react";
import {
    clampDrawerWidth,
    clampRect,
    compactRect,
    drawerRect,
    isCompactViewport,
    loadDrawerWidth,
    loadRect,
    loadWindowMode,
    moveRect,
    rectsEqual,
    resizeDrawerWidth,
    resizeRect,
    saveDrawerWidth,
    saveRect,
    saveWindowMode,
    type DragMode,
    type Rect,
    type ResizeDir,
    type Viewport,
    type WindowMode,
} from "../lib/aiWindowGeometry";

const INTERACTIVE_SELECTOR =
    'button, a, input, select, textarea, label, [role="button"], [role="menu"], [role="listbox"], [contenteditable="true"], [data-no-window-drag]';

const RESIZE_DIRS: readonly ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const CURSOR: Record<DragMode, string> = {
    move: "move",
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    nw: "nwse-resize",
    se: "nwse-resize",
};

interface DragState {
    mode: DragMode;
    pointerId: number;
    startX: number;
    startY: number;
    startRect: Rect;
    latest: Rect;
    drawer: boolean;
}

const readViewport = (): Viewport => ({ w: window.innerWidth, h: window.innerHeight });

function resolveDragMode(target: HTMLElement): DragMode | null {
    const handle = target.closest<HTMLElement>("[data-ai-resize]");
    if (handle) {
        const dir = handle.dataset.aiResize as ResizeDir | undefined;
        return dir && RESIZE_DIRS.includes(dir) ? dir : null;
    }
    const bar = target.closest<HTMLElement>("[data-ai-window-drag]");
    if (!bar) return null;
    const interactive = target.closest(INTERACTIVE_SELECTOR);
    return interactive && bar.contains(interactive) ? null : "move";
}

export interface UseAIFloatingWindowResult {
    windowRef: React.RefObject<HTMLDivElement | null>;
    compact: boolean;
    mode: WindowMode;
    /** 抽屉模式下的面板宽度；贴右分栏时由布局直接使用 */
    drawerWidth: number;
    style: { left: number; top: number; width: number; height: number };
    handlers: {
        onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
        onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
        onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
        onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
    };
    toggleMode: () => void;
}

export function useAIFloatingWindow(): UseAIFloatingWindowResult {
    const windowRef = useRef<HTMLDivElement | null>(null);
    const [viewport, setViewport] = useState<Viewport>(readViewport);
    const [rect, setRect] = useState<Rect>(() => loadRect(readViewport()));
    const [mode, setMode] = useState<WindowMode>(() => loadWindowMode());
    const [drawerWidth, setDrawerWidth] = useState(() => loadDrawerWidth(readViewport()));

    const rectRef = useRef(rect);
    const modeRef = useRef(mode);
    const drawerWidthRef = useRef(drawerWidth);
    const viewportRef = useRef(viewport);
    const dragRef = useRef<DragState | null>(null);

    const compact = isCompactViewport(viewport);
    const displayRect = compact
        ? compactRect(viewport)
        : mode === "drawer"
          ? drawerRect(viewport, drawerWidth)
          : rect;

    const commitRect = useCallback((next: Rect, persist: boolean) => {
        rectRef.current = next;
        setRect(next);
        if (persist) saveRect(next);
    }, []);

    const commitDrawer = useCallback((width: number, persist: boolean) => {
        const next = clampDrawerWidth(width, viewportRef.current);
        drawerWidthRef.current = next;
        setDrawerWidth(next);
        if (persist) saveDrawerWidth(next);
    }, []);

    useEffect(() => {
        const onResize = () => {
            const nextViewport = readViewport();
            viewportRef.current = nextViewport;
            setViewport(nextViewport);
            const clamped = clampRect(rectRef.current, nextViewport);
            if (!rectsEqual(clamped, rectRef.current)) commitRect(clamped, false);
            const nextWidth = clampDrawerWidth(drawerWidthRef.current, nextViewport);
            if (nextWidth !== drawerWidthRef.current) commitDrawer(nextWidth, false);
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [commitRect, commitDrawer]);

    const onPointerDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            if (compact || event.button !== 0 || dragRef.current) return;
            const dragMode = resolveDragMode(event.target as HTMLElement);
            if (!dragMode) return;
            const drawer = modeRef.current === "drawer";
            if (drawer && dragMode !== "w") return;
            event.preventDefault();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            const startRect = drawer
                ? drawerRect(viewportRef.current, drawerWidthRef.current)
                : rectRef.current;
            dragRef.current = {
                mode: dragMode,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startRect,
                latest: startRect,
                drawer,
            };
            document.body.style.cursor = CURSOR[dragMode];
            document.body.style.userSelect = "none";
        },
        [compact],
    );

    const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        const currentViewport = viewportRef.current;
        const node = windowRef.current;

        // 抽屉模式只调宽度：贴右分栏时位置由布局决定
        if (drag.drawer) {
            const next = drawerRect(
                currentViewport,
                resizeDrawerWidth(drag.startRect.w, dx, currentViewport),
            );
            drag.latest = next;
            if (node) node.style.width = `${next.w}px`;
            return;
        }

        const next =
            drag.mode === "move"
                ? moveRect(drag.startRect, dx, dy, currentViewport)
                : resizeRect(drag.startRect, drag.mode, dx, dy, currentViewport);
        drag.latest = next;
        if (node) {
            node.style.left = `${next.x}px`;
            node.style.top = `${next.y}px`;
            node.style.width = `${next.w}px`;
            node.style.height = `${next.h}px`;
        }
    }, []);

    const endDrag = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            dragRef.current = null;
            try {
                event.currentTarget.releasePointerCapture?.(event.pointerId);
            } catch {
                /* 未持有 capture 时会抛错，忽略 */
            }
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            if (drag.drawer) {
                if (drag.latest.w !== drawerWidthRef.current) {
                    commitDrawer(drag.latest.w, true);
                }
                return;
            }
            if (!rectsEqual(drag.latest, rectRef.current)) commitRect(drag.latest, true);
        },
        [commitDrawer, commitRect],
    );

    const toggleMode = useCallback(() => {
        if (isCompactViewport(viewportRef.current)) return;
        if (modeRef.current === "drawer") {
            modeRef.current = "float";
            setMode("float");
            saveWindowMode("float");
            return;
        }
        saveRect(rectRef.current);
        modeRef.current = "drawer";
        setMode("drawer");
        saveWindowMode("drawer");
    }, []);

    return {
        windowRef,
        compact,
        mode,
        drawerWidth,
        style: {
            left: displayRect.x,
            top: displayRect.y,
            width: displayRect.w,
            height: displayRect.h,
        },
        handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
        },
        toggleMode,
    };
}
