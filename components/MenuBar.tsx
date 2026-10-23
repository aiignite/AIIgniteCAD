/**
 * MenuBar.tsx — AutoCAD 风格菜单栏
 *
 * 经典菜单栏形态：横向排列的菜单标题，点开下拉；已展开时悬停其它标题直接切换，
 * 键盘可用方向键在菜单间与菜单项间移动，Esc 关闭。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { MENUS, type MenuActionId, type MenuItem, type MenuToggleId } from "../lib/menus";
import { modifierKeyLabel } from "../lib/shortcuts";
import { useI18n } from "../lib/i18n";

interface MenuBarProps {
    /** 执行菜单命令 */
    onAction: (action: MenuActionId, item: MenuItem) => void;
    /** 勾选型命令（网格 / 捕捉 / 正交 / 极轴）的当前状态 */
    toggles: Record<MenuToggleId, boolean>;
}

/** "Mod+Z" 里的 Mod 换成平台对应的修饰键 */
function formatShortcut(shortcut: string): string {
    return shortcut.replace(/Mod/g, modifierKeyLabel());
}

export const MenuBar: React.FC<MenuBarProps> = ({ onAction, toggles }) => {
    const { t } = useI18n();
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    const close = useCallback(() => setOpenMenuId(null), []);

    // 点击菜单栏以外的位置关闭
    useEffect(() => {
        if (!openMenuId) return undefined;
        const handlePointerDown = (event: MouseEvent) => {
            if (!barRef.current?.contains(event.target as Node)) close();
        };
        document.addEventListener("mousedown", handlePointerDown);
        return () => document.removeEventListener("mousedown", handlePointerDown);
    }, [close, openMenuId]);

    /** 在当前菜单内按方向键移动焦点 */
    const moveFocus = useCallback((menuId: string, delta: number) => {
        const menu = MENUS.find((item) => item.id === menuId);
        if (!menu) return;
        const commands = menu.items.filter((item) => item.kind === "command");
        if (commands.length === 0) return;

        const current = document.activeElement as HTMLElement | null;
        const index = commands.findIndex((item) => item.id === current?.dataset.menuItem);
        const next = index === -1 ? 0 : (index + delta + commands.length) % commands.length;
        itemRefs.current[commands[next].id]?.focus();
    }, []);

    /** 在菜单之间左右切换 */
    const switchMenu = useCallback((delta: number) => {
        setOpenMenuId((current) => {
            const index = MENUS.findIndex((menu) => menu.id === current);
            const next = (index + delta + MENUS.length) % MENUS.length;
            return MENUS[next].id;
        });
    }, []);

    const handleBarKeyDown = (event: React.KeyboardEvent) => {
        if (!openMenuId) return;
        if (event.key === "Escape") {
            event.preventDefault();
            close();
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            moveFocus(openMenuId, 1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveFocus(openMenuId, -1);
        } else if (event.key === "ArrowRight") {
            event.preventDefault();
            switchMenu(1);
        } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            switchMenu(-1);
        }
    };

    const activate = (item: MenuItem) => {
        if (item.kind !== "command") return;
        close();
        onAction(item.action, item);
    };

    return (
        <div
            ref={barRef}
            role="menubar"
            aria-label={t("menu.title")}
            onKeyDown={handleBarKeyDown}
            className="flex items-center h-8 shrink-0 z-30 border-b border-cad-border bg-cad-panel px-1 select-none"
        >
            {MENUS.map((menu) => {
                const open = openMenuId === menu.id;
                return (
                    <div key={menu.id} className="relative">
                        <button
                            role="menuitem"
                            aria-haspopup="menu"
                            aria-expanded={open}
                            data-menu={menu.id}
                            onClick={() => setOpenMenuId(open ? null : menu.id)}
                            // 已展开时悬停其它标题直接切换，符合 Windows 菜单习惯
                            onMouseEnter={() => {
                                if (openMenuId && !open) setOpenMenuId(menu.id);
                            }}
                            className={`h-7 px-2.5 text-xs font-medium rounded transition-colors ${
                                open
                                    ? "bg-cad-primary/15 text-cad-primary"
                                    : "text-cad-text hover:bg-cad-text/10"
                            }`}
                        >
                            {t(menu.labelKey)}
                        </button>

                        {open && (
                            <div
                                role="menu"
                                aria-label={t(menu.labelKey)}
                                className="absolute left-0 top-full mt-0.5 w-60 rounded-lg border border-cad-border bg-cad-panel shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
                                onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        close();
                                    } else if (event.key === "ArrowDown") {
                                        event.preventDefault();
                                        moveFocus(menu.id, 1);
                                    } else if (event.key === "ArrowUp") {
                                        event.preventDefault();
                                        moveFocus(menu.id, -1);
                                    }
                                }}
                            >
                                {menu.items.map((item, index) => {
                                    if (item.kind === "separator") {
                                        return (
                                            <div
                                                key={item.id ?? `sep-${menu.id}-${index}`}
                                                className="h-px bg-cad-border my-1"
                                            />
                                        );
                                    }
                                    if (item.kind === "heading") {
                                        return (
                                            <div
                                                key={item.id}
                                                className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-cad-muted"
                                            >
                                                {t(item.labelKey)}
                                            </div>
                                        );
                                    }

                                    const checked = item.toggle ? toggles[item.toggle] : false;
                                    return (
                                        <button
                                            key={item.id}
                                            role="menuitem"
                                            data-menu-item={item.id}
                                            ref={(node) => {
                                                itemRefs.current[item.id] = node;
                                            }}
                                            onClick={() => activate(item)}
                                            className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-xs text-cad-text hover:bg-cad-text/10 transition-colors text-left"
                                        >
                                            <span className="material-symbols-outlined text-[18px] text-cad-muted shrink-0 w-4">
                                                {item.icon}
                                            </span>
                                            <span className="flex-1 truncate">
                                                {t(item.labelKey)}
                                            </span>
                                            {item.toggle && (
                                                <span
                                                    className={`material-symbols-outlined text-[16px] shrink-0 ${
                                                        checked
                                                            ? "text-cad-primary"
                                                            : "text-transparent"
                                                    }`}
                                                >
                                                    check
                                                </span>
                                            )}
                                            {item.shortcut && (
                                                <span className="text-[10px] font-mono text-cad-muted shrink-0">
                                                    {formatShortcut(item.shortcut)}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default MenuBar;
