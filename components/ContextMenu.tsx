/**
 * ContextMenu.tsx — 画布右键菜单
 *
 * 菜单项由调用方按当前选择集组装，本组件只负责定位、渲染与关闭：
 * 点击菜单外部、Esc、窗口尺寸变化时都关闭。
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuItem {
    id: string;
    label: string;
    icon?: string;
    /** 右侧快捷键提示，如 Ctrl+C */
    shortcut?: string;
    disabled?: boolean;
    /** 危险操作（删除）用红色标注 */
    danger?: boolean;
    /** 与上一项之间插入分隔线 */
    separator?: boolean;
    onSelect: () => void;
}

interface ContextMenuProps {
    /** 触发位置（视口坐标） */
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

/** 菜单与视口边缘的最小间距 */
const VIEWPORT_MARGIN = 8;

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ x, y });

    // 首次拿到实际尺寸后再夹回视口内，避免菜单贴边时超出屏幕
    useLayoutEffect(() => {
        const node = menuRef.current;
        if (!node) return;
        const rect = node.getBoundingClientRect();
        setPosition({
            x: Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - rect.width - VIEWPORT_MARGIN)),
            y: Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - rect.height - VIEWPORT_MARGIN)),
        });
    }, [x, y, items]);

    useEffect(() => {
        const handleMouseDown = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) onClose();
        };
        document.addEventListener("mousedown", handleMouseDown);
        window.addEventListener("resize", onClose);
        // 只监听文档自身的滚动：面板等内部容器滚动与菜单无关
        window.addEventListener("scroll", onClose);
        return () => {
            document.removeEventListener("mousedown", handleMouseDown);
            window.removeEventListener("resize", onClose);
            window.removeEventListener("scroll", onClose);
        };
    }, [onClose]);

    return (
        <div
            ref={menuRef}
            role="menu"
            data-testid="context-menu"
            className="fixed z-50 min-w-[210px] rounded-lg border border-cad-border bg-cad-panel/95 backdrop-blur py-1 shadow-xl"
            style={{ left: position.x, top: position.y }}
        >
            {items.map((item) => (
                <React.Fragment key={item.id}>
                    {item.separator && <div className="my-1 h-px bg-cad-border" />}
                    <button
                        type="button"
                        role="menuitem"
                        data-menu-item={item.id}
                        disabled={item.disabled}
                        onClick={() => {
                            if (item.disabled) return;
                            item.onSelect();
                            onClose();
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors
                            ${item.disabled
                                ? "cursor-not-allowed text-cad-muted/50"
                                : item.danger
                                  ? "text-red-400 hover:bg-red-500/15"
                                  : "text-cad-text hover:bg-cad-primary/15"}`}
                    >
                        {item.icon && (
                            <span className="material-symbols-outlined text-[16px] leading-none">
                                {item.icon}
                            </span>
                        )}
                        <span className="flex-1 whitespace-nowrap">{item.label}</span>
                        {item.shortcut && (
                            <span className="font-mono text-[10px] text-cad-muted">{item.shortcut}</span>
                        )}
                    </button>
                </React.Fragment>
            ))}
        </div>
    );
};
