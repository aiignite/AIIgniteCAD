/**
 * PromptDialog.tsx — 通用单行输入弹窗
 *
 * 替代原生 prompt()：与 ConfirmDialog 同一视觉语言，Enter 确认 / Esc 取消。
 * 确认回调拿到 trim 后的值，空值是否放行由调用方决定。
 */

import React, { useEffect, useRef, useState } from "react";

interface PromptDialogProps {
    title: string;
    message?: string;
    placeholder?: string;
    initialValue?: string;
    confirmLabel: string;
    cancelLabel?: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
}

export const PromptDialog: React.FC<PromptDialogProps> = ({
    title,
    message,
    placeholder,
    initialValue = "",
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
}) => {
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const submit = () => onConfirm(value.trim());

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onCancel();
            }}
        >
            <div className="bg-cad-panel border border-cad-border rounded-xl shadow-2xl w-[min(440px,92vw)] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                <div className="px-5 py-4 border-b border-cad-border">
                    <h2 className="text-sm font-bold text-cad-text">{title}</h2>
                </div>
                <div className="px-5 py-4 space-y-3">
                    {message && <p className="text-xs text-cad-muted leading-relaxed">{message}</p>}
                    <input
                        ref={inputRef}
                        value={value}
                        placeholder={placeholder}
                        onChange={(event) => setValue(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") submit();
                            if (event.key === "Escape") onCancel();
                        }}
                        className="w-full rounded border border-cad-border bg-cad-bg px-3 py-2 text-sm text-cad-text outline-none focus:border-cad-primary"
                    />
                </div>
                <div className="px-5 py-3 border-t border-cad-border bg-cad-bg/40 flex justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 rounded border border-cad-border text-xs text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={submit}
                        className="px-3 py-1.5 rounded bg-cad-primary hover:bg-cad-primaryHover text-white text-xs font-bold"
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PromptDialog;
