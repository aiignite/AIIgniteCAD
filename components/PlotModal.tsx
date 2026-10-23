/**
 * PlotModal.tsx — 图框 / 打印设置与预览
 *
 * 提供纸张、方向、比例、边距、标题栏与单色选项；
 * 打印通过浏览器对话框输出，选择“另存为 PDF”即可得到矢量 PDF。
 */

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CADElement, DrawingSettings } from "../types";
import {
    computePlotLayout,
    createDefaultPlotSettings,
    defaultPlotTitle,
    formatPlotScale,
    MAX_PLOT_MARGIN_MM,
    MIN_PLOT_MARGIN_MM,
    PAPER_SIZE_OPTIONS,
    PAPER_SIZES,
    PlotOrientation,
    PlotScaleMode,
    PlotSettings,
    SCALE_DENOMINATORS,
} from "../lib/plot";
import PlotSheet from "./PlotSheet";

interface PlotModalProps {
    elements: CADElement[];
    drawingSettings: DrawingSettings;
    projectName?: string;
    author?: string;
    onClose: () => void;
}

const FIELD_CLASS =
    "w-full h-9 rounded border border-cad-border bg-cad-bg px-2 text-sm text-cad-text focus:outline-none focus:border-cad-primary";
const LABEL_CLASS =
    "block text-[10px] font-bold text-cad-muted uppercase tracking-wide mb-1";

export const PlotModal: React.FC<PlotModalProps> = ({
    elements,
    drawingSettings,
    projectName,
    author,
    onClose,
}) => {
    const [settings, setSettings] = useState<PlotSettings>(() =>
        createDefaultPlotSettings({
            title: defaultPlotTitle(projectName),
            author: author ?? "",
        }),
    );

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    const layout = useMemo(
        () => computePlotLayout(elements, settings),
        [elements, settings],
    );
    const scaleLabel = formatPlotScale(layout.scale);

    const update = <K extends keyof PlotSettings>(
        key: K,
        value: PlotSettings[K],
    ) => setSettings((previous) => ({ ...previous, [key]: value }));

    const printRoot = createPortal(
        <div
            className="plot-print-root"
            style={{
                width: `${layout.paper.widthMm}mm`,
                height: `${layout.paper.heightMm}mm`,
            }}
        >
            <style>{`@media print { @page { size: ${layout.paper.widthMm}mm ${layout.paper.heightMm}mm; margin: 0; } }`}</style>
            <PlotSheet
                elements={elements}
                settings={settings}
                drawingSettings={drawingSettings}
                projectName={projectName}
                style={{ width: "100%", height: "100%" }}
            />
        </div>,
        document.body,
    );

    return (
        <>
            {printRoot}
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-6"
                role="dialog"
                aria-modal="true"
                aria-label="Plot and print"
                onMouseDown={(event) => {
                    if (event.target === event.currentTarget) onClose();
                }}
            >
                <div className="bg-cad-panel border border-cad-border rounded-xl shadow-2xl w-[min(1180px,96vw)] max-h-[92vh] flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-cad-border shrink-0">
                        <div>
                            <h2 className="text-base font-bold text-cad-text">
                                Plot / Print
                            </h2>
                            <p className="text-[11px] text-cad-muted mt-0.5">
                                Vector output. Choose “Save as PDF” in the browser
                                print dialog.
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded text-cad-muted hover:text-cad-text hover:bg-cad-text/10 transition-colors"
                            title="Close"
                            aria-label="Close plot dialog"
                        >
                            <span className="material-symbols-outlined text-[20px]">
                                close
                            </span>
                        </button>
                    </div>

                    <div className="flex flex-col lg:flex-row flex-1 min-h-0">
                        <div className="flex-1 min-h-[280px] overflow-auto bg-cad-bg/60 p-4 sm:p-6 flex items-center justify-center">
                            <PlotSheet
                                id="plot-sheet"
                                elements={elements}
                                settings={settings}
                                drawingSettings={drawingSettings}
                                projectName={projectName}
                                className="max-h-[50vh] lg:max-h-[62vh] max-w-full h-auto w-auto shadow-2xl ring-1 ring-black/20"
                            />
                        </div>

                        <div className="w-full lg:w-[340px] shrink-0 border-t lg:border-t-0 lg:border-l border-cad-border overflow-y-auto p-4 space-y-4">
                            <div>
                                <label className={LABEL_CLASS} htmlFor="plot-paper">
                                    Paper size
                                </label>
                                <select
                                    id="plot-paper"
                                    className={FIELD_CLASS}
                                    value={settings.paper}
                                    onChange={(event) =>
                                        update(
                                            "paper",
                                            event.target
                                                .value as PlotSettings["paper"],
                                        )
                                    }
                                >
                                    {PAPER_SIZE_OPTIONS.map((paper) => (
                                        <option key={paper} value={paper}>
                                            {PAPER_SIZES[paper].label} ·{" "}
                                            {PAPER_SIZES[paper].widthMm}×
                                            {PAPER_SIZES[paper].heightMm} mm
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label
                                    className={LABEL_CLASS}
                                    htmlFor="plot-orientation"
                                >
                                    Orientation
                                </label>
                                <select
                                    id="plot-orientation"
                                    className={FIELD_CLASS}
                                    value={settings.orientation}
                                    onChange={(event) =>
                                        update(
                                            "orientation",
                                            event.target.value as PlotOrientation,
                                        )
                                    }
                                >
                                    <option value="landscape">Landscape</option>
                                    <option value="portrait">Portrait</option>
                                </select>
                            </div>

                            <div>
                                <label className={LABEL_CLASS} htmlFor="plot-scale-mode">
                                    Scale
                                </label>
                                <select
                                    id="plot-scale-mode"
                                    className={FIELD_CLASS}
                                    value={settings.scaleMode}
                                    onChange={(event) =>
                                        update(
                                            "scaleMode",
                                            event.target.value as PlotScaleMode,
                                        )
                                    }
                                >
                                    <option value="fit">Fit to sheet</option>
                                    <option value="fixed">Fixed scale</option>
                                </select>
                                {settings.scaleMode === "fixed" ? (
                                    <select
                                        aria-label="Scale ratio"
                                        className={`${FIELD_CLASS} mt-2`}
                                        value={settings.scaleDenominator}
                                        onChange={(event) =>
                                            update(
                                                "scaleDenominator",
                                                Number(event.target.value),
                                            )
                                        }
                                    >
                                        {SCALE_DENOMINATORS.map((denominator) => (
                                            <option
                                                key={denominator}
                                                value={denominator}
                                            >
                                                1:{denominator}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <p className="mt-1.5 text-[11px] text-cad-muted">
                                        Effective scale:{" "}
                                        <span className="font-mono text-cad-text">
                                            {scaleLabel}
                                        </span>
                                    </p>
                                )}
                            </div>

                            <div>
                                <label className={LABEL_CLASS} htmlFor="plot-margin">
                                    Margin (mm)
                                </label>
                                <input
                                    id="plot-margin"
                                    type="number"
                                    min={MIN_PLOT_MARGIN_MM}
                                    max={MAX_PLOT_MARGIN_MM}
                                    step={1}
                                    className={FIELD_CLASS}
                                    value={settings.marginMm}
                                    onChange={(event) =>
                                        update(
                                            "marginMm",
                                            Number(event.target.value) || 0,
                                        )
                                    }
                                    onBlur={() =>
                                        update(
                                            "marginMm",
                                            Math.min(
                                                MAX_PLOT_MARGIN_MM,
                                                Math.max(
                                                    MIN_PLOT_MARGIN_MM,
                                                    settings.marginMm,
                                                ),
                                            ),
                                        )
                                    }
                                />
                            </div>

                            <div className="space-y-2 pt-1 border-t border-cad-border">
                                <label className="flex items-center gap-2 text-xs text-cad-text cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="accent-cad-primary"
                                        checked={settings.titleBlock}
                                        onChange={(event) =>
                                            update(
                                                "titleBlock",
                                                event.target.checked,
                                            )
                                        }
                                    />
                                    Title block and border
                                </label>
                                <label className="flex items-center gap-2 text-xs text-cad-text cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="accent-cad-primary"
                                        checked={settings.monochrome}
                                        onChange={(event) =>
                                            update(
                                                "monochrome",
                                                event.target.checked,
                                            )
                                        }
                                    />
                                    Monochrome (black on white)
                                </label>
                            </div>

                            <div className="pt-1 border-t border-cad-border space-y-3">
                                <div>
                                    <label className={LABEL_CLASS} htmlFor="plot-title">
                                        Drawing title
                                    </label>
                                    <input
                                        id="plot-title"
                                        className={FIELD_CLASS}
                                        value={settings.title}
                                        onChange={(event) =>
                                            update("title", event.target.value)
                                        }
                                    />
                                </div>
                                <div>
                                    <label
                                        className={LABEL_CLASS}
                                        htmlFor="plot-number"
                                    >
                                        Drawing no.
                                    </label>
                                    <input
                                        id="plot-number"
                                        className={FIELD_CLASS}
                                        placeholder="e.g. AI-2026-001"
                                        value={settings.drawingNumber}
                                        onChange={(event) =>
                                            update(
                                                "drawingNumber",
                                                event.target.value,
                                            )
                                        }
                                    />
                                </div>
                                <div>
                                    <label className={LABEL_CLASS} htmlFor="plot-author">
                                        Author
                                    </label>
                                    <input
                                        id="plot-author"
                                        className={FIELD_CLASS}
                                        value={settings.author}
                                        onChange={(event) =>
                                            update("author", event.target.value)
                                        }
                                    />
                                </div>
                                <div>
                                    <label className={LABEL_CLASS} htmlFor="plot-date">
                                        Date
                                    </label>
                                    <input
                                        id="plot-date"
                                        type="date"
                                        className={FIELD_CLASS}
                                        value={settings.date}
                                        onChange={(event) =>
                                            update("date", event.target.value)
                                        }
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-cad-border shrink-0">
                        <div className="text-[11px] text-cad-muted">
                            {layout.overflow ? (
                                <span className="text-amber-500 font-medium">
                                    Drawing exceeds the selected scale and will be
                                    clipped. Choose “Fit to sheet” or a smaller
                                    ratio.
                                </span>
                            ) : (
                                <span>
                                    Sheet{" "}
                                    {PAPER_SIZES[settings.paper]?.label ?? settings.paper} ·{" "}
                                    {settings.orientation} · {scaleLabel}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={onClose}
                                className="h-8 px-3 rounded border border-cad-border text-xs font-bold text-cad-muted hover:bg-cad-text/10 hover:text-cad-text transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => window.print()}
                                className="h-8 px-4 rounded bg-cad-primary hover:bg-cad-primaryHover text-white text-xs font-bold transition-colors shadow-lg shadow-blue-500/20 flex items-center gap-1.5"
                            >
                                <span className="material-symbols-outlined text-[16px]">
                                    print
                                </span>
                                Print / Save PDF
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default PlotModal;
