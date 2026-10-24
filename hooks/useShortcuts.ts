/**
 * useShortcuts.ts — 单键键位的响应式订阅
 *
 * 设置页改键后，工具栏提示与速查表需要重渲染；按键解析本身走
 * lib/shortcuts 的模块缓存，不依赖本 hook。
 */

import { useSyncExternalStore } from "react";
import {
    getShortcutOverrides,
    subscribeShortcutOverrides,
    type ShortcutOverrides,
} from "../lib/shortcuts";

export function useShortcutOverrides(): ShortcutOverrides {
    return useSyncExternalStore(subscribeShortcutOverrides, getShortcutOverrides, getShortcutOverrides);
}
