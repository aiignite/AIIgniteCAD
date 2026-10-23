/**
 * useCommandInput.ts — 命令行输入控制器
 *
 * 封装命令历史（localStorage）、Tab 补全、上下键浏览与必填参数的分步提示。
 * 命令执行本身交给 registry.executeCommand（由 App 注入 onCommand）。
 */

import { useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
    completeCommand,
    findCommand,
    formatArgPrompt,
    getMissingArgs,
    getUsage,
    resolveCommandInput,
} from "../lib/commands/registry";
import type { CommandDefinition } from "../lib/commands/types";

const HISTORY_KEY = "aiignite.cad.command-history";
const MAX_HISTORY = 50;

interface PendingCommand {
    definition: CommandDefinition;
    provided: string[];
}

export interface CommandInputController {
    value: string;
    onChange: (value: string) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
    /** 输入框下方的上下文提示（用法、补全候选或分步参数） */
    hint: string | null;
    /** 分步输入中的当前参数提示，同时用作 placeholder */
    prompt: string | null;
    pending: boolean;
}

function loadHistory(): string[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === "string").slice(-MAX_HISTORY)
            : [];
    } catch {
        return [];
    }
}

function saveHistory(history: string[]): void {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
        // 隐私模式或存储已满时静默降级为会话内历史
    }
}

/** 多个补全候选的最长公共前缀 */
function commonPrefix(values: string[]): string {
    if (values.length === 0) return "";
    return values.reduce((prefix, value) => {
        let index = 0;
        while (index < prefix.length && index < value.length && prefix[index] === value[index]) {
            index += 1;
        }
        return prefix.slice(0, index);
    });
}

export function useCommandInput(onCommand: (command: string) => void): CommandInputController {
    const [value, setValue] = useState("");
    const [pending, setPending] = useState<PendingCommand | null>(null);
    const [history, setHistory] = useState<string[]>(loadHistory);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [completionHint, setCompletionHint] = useState<string | null>(null);
    const draftRef = useRef("");

    const commit = (command: string) => {
        onCommand(command);
        const next = [...history.filter((item) => item !== command), command].slice(-MAX_HISTORY);
        setHistory(next);
        saveHistory(next);
        setPending(null);
        setValue("");
        setHistoryIndex(-1);
        setCompletionHint(null);
    };

    const submit = () => {
        const text = value.trim();
        if (!text) {
            // 空回车重复上一条命令，与 CAD 命令行习惯一致
            if (!pending && history.length > 0) commit(history[history.length - 1]);
            return;
        }

        // 分步输入：当前值作为下一个参数，拼回完整命令后判断是否仍需继续
        if (pending) {
            const provided = [...pending.provided, text];
            const resolved = resolveCommandInput(`${pending.definition.name} ${provided.join(" ")}`);
            if (resolved && resolved.missing.length > 0) {
                setPending({ definition: pending.definition, provided });
                setValue("");
                return;
            }
            commit(`${pending.definition.name} ${provided.join(" ")}`);
            return;
        }

        const resolved = resolveCommandInput(text);
        if (!resolved) return;

        if (resolved.definition && resolved.missing.length > 0) {
            setPending({ definition: resolved.definition, provided: resolved.provided });
            setValue("");
            return;
        }

        commit(text);
    };

    const complete = () => {
        const token = value.trim();
        if (pending || token.includes(" ")) return;

        // 精确命中名称或别名时优先展开为规范命令，避免 L 被 LINE/LAYER 的公共前缀卡住
        const exact = findCommand(token);
        if (exact) {
            setValue(`${exact.name} `);
            setCompletionHint(`${getUsage(exact)} — ${exact.description}`);
            return;
        }

        const candidates = completeCommand(token);
        if (candidates.length === 0) return;

        if (candidates.length === 1) {
            setValue(`${candidates[0].name} `);
            setCompletionHint(`${getUsage(candidates[0])} — ${candidates[0].description}`);
            return;
        }

        const prefix = commonPrefix(candidates.map((definition) => definition.name));
        if (prefix.length > token.length) setValue(prefix);
        setCompletionHint(candidates.map((definition) => definition.name).join(" · "));
    };

    const navigateHistory = (direction: -1 | 1) => {
        if (history.length === 0) return;

        if (direction === -1) {
            if (historyIndex === -1) {
                draftRef.current = value;
                const nextIndex = history.length - 1;
                setHistoryIndex(nextIndex);
                setValue(history[nextIndex]);
            } else if (historyIndex > 0) {
                setHistoryIndex(historyIndex - 1);
                setValue(history[historyIndex - 1]);
            }
            setCompletionHint(null);
            return;
        }

        if (historyIndex === -1) return;
        const nextIndex = historyIndex + 1;
        if (nextIndex >= history.length) {
            setHistoryIndex(-1);
            setValue(draftRef.current);
        } else {
            setHistoryIndex(nextIndex);
            setValue(history[nextIndex]);
        }
        setCompletionHint(null);
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            submit();
            return;
        }

        if (event.key === "Escape") {
            if (pending || value) {
                event.preventDefault();
                setPending(null);
                setValue("");
                setHistoryIndex(-1);
                setCompletionHint(null);
            }
            return;
        }

        if (event.key === "Tab") {
            event.preventDefault();
            complete();
            return;
        }

        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            if (pending) return;
            event.preventDefault();
            navigateHistory(event.key === "ArrowUp" ? -1 : 1);
        }
    };

    const handleChange = (next: string) => {
        setValue(next);
        setHistoryIndex(-1);
        setCompletionHint(null);
    };

    const pendingArg = pending ? getMissingArgs(pending.definition, pending.provided)[0] : undefined;
    const prompt = pendingArg ? formatArgPrompt(pendingArg) : null;

    let hint: string | null = null;
    if (pending && pendingArg) {
        hint = `${pending.definition.name} — ${formatArgPrompt(pendingArg)}`;
    } else if (completionHint) {
        hint = completionHint;
    } else {
        const token = value.trim().split(/\s+/)[0];
        if (token) {
            const definition = findCommand(token);
            hint = definition
                ? `${getUsage(definition)} — ${definition.description}`
                : "Tab 补全命令 · ↑↓ 浏览历史";
        }
    }

    return {
        value,
        onChange: handleChange,
        onKeyDown: handleKeyDown,
        hint,
        prompt,
        pending: pending !== null,
    };
}
