import React, { useRef, useState } from "react";
import type { CADElement } from "../types";
import { traceImage, type TraceImageData, type TraceResult } from "../lib/imageTrace";
import { loadTraceImage } from "../services/imageTraceService";
import ElementPreview from "./ElementPreview";
import { useI18n } from "../lib/i18n";

interface ImageTraceModalProps {
    onClose: () => void;
    onInsert: (elements: CADElement[]) => void;
}

const ImageTraceModal: React.FC<ImageTraceModalProps> = ({ onClose, onInsert }) => {
    const { t } = useI18n();
    const inputRef = useRef<HTMLInputElement>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [source, setSource] = useState<TraceImageData | null>(null);
    const [threshold, setThreshold] = useState(128);
    const [invert, setInvert] = useState(false);
    const [simplifyTolerance, setSimplifyTolerance] = useState(1.2);
    const [targetWidth, setTargetWidth] = useState(400);
    const [result, setResult] = useState<TraceResult | null>(null);
    const [dirty, setDirty] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const runTrace = (image: TraceImageData = source!, next?: Partial<{ threshold: number }>) => {
        if (!image) return;
        setLoading(true);
        setError(null);
        try {
            const traced = traceImage(image, {
                threshold: next?.threshold ?? threshold,
                invert,
                simplifyTolerance,
                targetWidth,
                offset: { x: 0, y: 0 },
                layer: "TRACE",
                color: "#38bdf8",
            });
            setResult(traced);
            setDirty(false);
        } catch (traceError) {
            setError(traceError instanceof Error ? traceError.message : t("trace.traceFailed"));
            setResult(null);
        } finally {
            setLoading(false);
        }
    };

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        setLoading(true);
        setError(null);
        try {
            const image = await loadTraceImage(file);
            setSource(image);
            setFileName(file.name);
            runTrace(image);
        } catch (loadError) {
            setSource(null);
            setResult(null);
            setError(loadError instanceof Error ? loadError.message : t("trace.loadFailed"));
        } finally {
            setLoading(false);
        }
    };

    const markDirty = () => setDirty(true);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div
                role="dialog"
                aria-modal="true"
                aria-label={t("trace.title")}
                className="w-[900px] max-w-[94vw] max-h-[90vh] bg-cad-panel border border-cad-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-cad-border">
                    <div>
                        <h3 className="text-sm font-bold text-cad-text flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[18px] text-cad-primary">
                                image
                            </span>
                            {t("trace.title")}
                        </h3>
                        <p className="text-[10px] text-cad-muted mt-0.5">
                            {t("trace.subtitle")}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        title={t("common.close")}
                        className="p-1 text-cad-muted hover:text-cad-text"
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>

                <div className="flex flex-1 min-h-0">
                    <div className="w-72 shrink-0 border-r border-cad-border p-3 space-y-3 overflow-y-auto">
                        <button
                            onClick={() => inputRef.current?.click()}
                            className="w-full px-2 py-2 rounded border border-dashed border-cad-primary/50 text-[11px] text-cad-primary hover:bg-cad-primary/10"
                        >
                            {fileName ? t("trace.chooseAgain") : t("trace.choose")}
                        </button>
                        <input
                            ref={inputRef}
                            type="file"
                            accept="image/*"
                            aria-label={t("trace.fileAria")}
                            className="hidden"
                            onChange={(event) => void handleFile(event.target.files?.[0])}
                        />
                        {fileName && (
                            <p className="text-[10px] text-cad-muted truncate" title={fileName}>
                                {fileName}
                                {source ? ` · ${source.width}×${source.height}px` : ""}
                            </p>
                        )}

                        <label className="block text-[10px] text-cad-muted">
                             {t("trace.threshold", { value: threshold })}
                            <input
                                aria-label={t("trace.thresholdAria")}
                                type="range"
                                min={20}
                                max={240}
                                step={2}
                                value={threshold}
                                onChange={(event) => {
                                    setThreshold(Number(event.target.value));
                                    markDirty();
                                }}
                                className="mt-1 w-full accent-cad-primary"
                            />
                        </label>

                        <label className="flex items-center gap-1.5 text-[10px] text-cad-muted">
                            <input
                                type="checkbox"
                                aria-label={t("trace.invertAria")}
                                checked={invert}
                                onChange={(event) => {
                                    setInvert(event.target.checked);
                                    markDirty();
                                }}
                            />
                            {t("trace.invert")}
                        </label>

                        <label className="block text-[10px] text-cad-muted">
                             {t("trace.simplify", { value: simplifyTolerance.toFixed(1) })}
                            <input
                                aria-label={t("trace.simplifyAria")}
                                type="range"
                                min={0}
                                max={4}
                                step={0.2}
                                value={simplifyTolerance}
                                onChange={(event) => {
                                    setSimplifyTolerance(Number(event.target.value));
                                    markDirty();
                                }}
                                className="mt-1 w-full accent-cad-primary"
                            />
                        </label>

                        <label className="block text-[10px] text-cad-muted">
                            {t("trace.targetWidth")}
                            <input
                                aria-label={t("trace.targetWidthAria")}
                                type="number"
                                min={1}
                                max={100000}
                                value={targetWidth}
                                onChange={(event) => {
                                    setTargetWidth(Number(event.target.value));
                                    markDirty();
                                }}
                                className="mt-0.5 w-full px-2 py-1 rounded border border-cad-border bg-transparent text-xs text-cad-text"
                            />
                        </label>

                        <button
                            onClick={() => runTrace()}
                            disabled={!source || loading}
                            className="w-full px-2 py-1.5 rounded bg-cad-primary text-white text-[11px] font-semibold disabled:opacity-40"
                        >
                            {loading
                                ? t("trace.tracing")
                                : dirty
                                  ? t("trace.updating")
                                  : t("trace.trace")}
                        </button>

                        {error && <p className="text-[10px] text-red-500">{error}</p>}
                        <p className="text-[9px] text-cad-muted leading-relaxed">
                            {t("trace.tip")}
                        </p>
                    </div>

                    <div className="flex-1 min-w-0 p-3 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-[10px] text-cad-muted">
                            <span>
                                {result
                                    ? t("trace.result", {
                                          count: result.elements.length,
                                          raw: result.contourCount,
                                      })
                                    : t("trace.awaiting")}
                            </span>
                            {result && (
                                <span className="font-mono">
                                    {t("trace.scale", { value: result.scale.toFixed(3) })}
                                </span>
                            )}
                        </div>
                        <ElementPreview
                            elements={result?.elements ?? []}
                            ariaLabel={t("trace.previewAria")}
                            className="flex-1 w-full min-h-[260px] rounded-lg border border-cad-border bg-[#0b1220]"
                        />
                        <div className="flex items-center justify-end gap-2">
                            <button
                                onClick={onClose}
                                className="px-3 py-1.5 rounded text-[11px] border border-cad-border text-cad-muted hover:text-cad-text"
                            >
                                {t("common.cancel")}
                            </button>
                            <button
                                onClick={() => {
                                    if (result && result.elements.length > 0) {
                                        onInsert(result.elements);
                                        onClose();
                                    }
                                }}
                                disabled={!result || result.elements.length === 0}
                                className="px-3 py-1.5 rounded text-[11px] bg-cad-primary text-white font-semibold disabled:opacity-40"
                            >
                                {t("trace.insert")}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ImageTraceModal;
