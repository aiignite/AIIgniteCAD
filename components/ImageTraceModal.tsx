import React, { useRef, useState } from "react";
import type { CADElement } from "../types";
import { traceImage, type TraceImageData, type TraceResult } from "../lib/imageTrace";
import { loadTraceImage } from "../services/imageTraceService";
import ElementPreview from "./ElementPreview";

interface ImageTraceModalProps {
    onClose: () => void;
    onInsert: (elements: CADElement[]) => void;
}

const ImageTraceModal: React.FC<ImageTraceModalProps> = ({ onClose, onInsert }) => {
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
            setError(traceError instanceof Error ? traceError.message : "图像识别失败");
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
            setError(loadError instanceof Error ? loadError.message : "图片读取失败");
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
                aria-label="参考图转 CAD"
                className="w-[900px] max-w-[94vw] max-h-[90vh] bg-cad-panel border border-cad-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-cad-border">
                    <div>
                        <h3 className="text-sm font-bold text-cad-text flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[18px] text-cad-primary">
                                image
                            </span>
                            参考图转 CAD
                        </h3>
                        <p className="text-[10px] text-cad-muted mt-0.5">
                            图片只在本地解析为轮廓多段线；插入后仍可正常编辑、撤销与导出 DXF。
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        title="关闭"
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
                            {fileName ? "重新选择图片" : "选择参考图片"}
                        </button>
                        <input
                            ref={inputRef}
                            type="file"
                            accept="image/*"
                            aria-label="参考图片文件"
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
                            识别阈值 {threshold}
                            <input
                                aria-label="识别阈值"
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
                                aria-label="反色识别"
                                checked={invert}
                                onChange={(event) => {
                                    setInvert(event.target.checked);
                                    markDirty();
                                }}
                            />
                            深色背景 / 浅色线条
                        </label>

                        <label className="block text-[10px] text-cad-muted">
                            简化容差 {simplifyTolerance.toFixed(1)} px
                            <input
                                aria-label="简化容差"
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
                            目标宽度（图纸单位）
                            <input
                                aria-label="目标宽度"
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
                            {loading ? "识别中…" : dirty ? "更新预览" : "重新识别"}
                        </button>

                        {error && <p className="text-[10px] text-red-500">{error}</p>}
                        <p className="text-[9px] text-cad-muted leading-relaxed">
                            阈值越低保留的线条越多；简化容差越大，节点越少。透明区域视为背景。
                        </p>
                    </div>

                    <div className="flex-1 min-w-0 p-3 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-[10px] text-cad-muted">
                            <span>
                                {result
                                    ? `识别到 ${result.elements.length} 条轮廓（原始 ${result.contourCount} 条）`
                                    : "选择图片后自动生成预览"}
                            </span>
                            {result && (
                                <span className="font-mono">
                                    1px ≈ {result.scale.toFixed(3)} 单位
                                </span>
                            )}
                        </div>
                        <ElementPreview
                            elements={result?.elements ?? []}
                            ariaLabel="参考图矢量化预览"
                            className="flex-1 w-full min-h-[260px] rounded-lg border border-cad-border bg-[#0b1220]"
                        />
                        <div className="flex items-center justify-end gap-2">
                            <button
                                onClick={onClose}
                                className="px-3 py-1.5 rounded text-[11px] border border-cad-border text-cad-muted hover:text-cad-text"
                            >
                                取消
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
                                插入图纸
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ImageTraceModal;
