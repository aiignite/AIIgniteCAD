/**
 * ConfirmDialog.tsx — 通用二次确认弹窗
 */

import React, { useEffect } from "react";

interface ConfirmDialogProps {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    title,
    message,
    confirmLabel,
    cancelLabel = "Cancel",
    danger = false,
    onConfirm,
    onCancel,
}) => {
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key === "Escape") onCancel();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onCancel]);

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onCancel();
            }}
        >
            <div className="bg-cad-panel border border-cad-border rounded-xl shadow-2xl w-[min(440px,92vw)] overflow-hidden">
                <div className="px-5 py-4 border-b border-cad-border">
                    <h2 className="text-sm font-bold text-cad-text">{title}</h2>
                </div>
                <div className="px-5 py-4">
                    <p className="text-xs text-cad-muted leading-relaxed">{message}</p>
                </div>
                <div className="px-5 py-3 border-t border-cad-border bg-cad-bg/40 flex justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 rounded border border-cad-border text-xs text-cad-muted hover:bg-cad-text/10 hover:text-cad-text"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-3 py-1.5 rounded text-xs font-bold ${
                            danger
                                ? "bg-red-500 hover:bg-red-400 text-white"
                                : "bg-cad-primary hover:bg-cad-primaryHover text-white"
                        }`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmDialog;
