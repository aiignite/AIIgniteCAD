/**
 * DrawingSettingsSection.tsx — 设置页「绘图设置」分区
 *
 * 从右侧面板的整体设置页拆出来，单位 / 捕捉 / 标注样式直接读写画布 Store，
 * 云端同步状态订阅 syncService，避免再经过一层 props 透传。
 */

import React, { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_SNAP_TYPES, SnapType } from "../../types";
import { useCanvas } from "../../store/canvasStore";
import { syncService } from "../../services/syncService";
import { useI18n, type TranslationKey } from "../../lib/i18n";

/** 捕捉类型与界面文案键，顺序即展示顺序 */
const SNAP_TYPE_OPTIONS: Array<{ type: SnapType; labelKey: TranslationKey }> = (
    [
        SnapType.ENDPOINT,
        SnapType.MIDPOINT,
        SnapType.CENTER,
        SnapType.QUADRANT,
        SnapType.INTERSECTION,
        SnapType.PERPENDICULAR,
        SnapType.TANGENT,
        SnapType.NEAREST,
    ] as SnapType[]
).map((type) => ({
    type,
    labelKey: `snap.${type.toLowerCase()}` as TranslationKey,
}));

const UNITS = ["mm", "cm", "m", "in", "ft"] as const;

const titleClass = "text-xs font-bold text-cad-muted uppercase tracking-wider";
const labelClass = "text-[10px] text-cad-muted font-medium";
const fieldClass =
    "w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs font-mono text-cad-text outline-none focus:border-cad-primary";
const buttonClass =
    "flex-1 h-7 rounded border border-cad-border text-[11px] text-cad-text hover:bg-cad-border/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

export const DrawingSettingsSection: React.FC = () => {
    const { t } = useI18n();
    const { state, setDrawingSettings } = useCanvas();
    const drawingSettings = state.drawingSettings;
    const syncStatus = useSyncExternalStore(
        syncService.subscribe,
        syncService.getSnapshot,
        syncService.getSnapshot,
    );

    // 打开分区时先拉一次真实待同步数量，快照本身只由队列事件推进
    useEffect(() => {
        void syncService.refreshStatus();
    }, []);

    const update = (patch: Partial<typeof drawingSettings>) => setDrawingSettings(patch);
    const enabledSnapTypes = drawingSettings.enabledSnapTypes ?? DEFAULT_SNAP_TYPES;

    const syncDot =
        syncStatus.failedCount > 0
            ? "bg-red-500"
            : syncStatus.syncing
              ? "bg-cad-primary animate-pulse"
              : syncStatus.pendingCount > 0
                ? "bg-yellow-500"
                : "bg-green-500";
    const syncLabel = !syncStatus.online
        ? t("settings.offline")
        : syncStatus.syncing
          ? t("settings.syncing")
          : syncStatus.pendingCount > 0 || syncStatus.failedCount > 0
            ? t("settings.pendingChanges")
            : t("settings.upToDate");

    return (
        <div className="space-y-6">
            <section className="space-y-3">
                <h4 className={titleClass}>{t("settings.coordinateSystem")}</h4>
                <div className="space-y-1">
                    <label className="text-xs text-cad-text font-medium">
                        {t("settings.units")}
                    </label>
                    <div className="flex rounded border border-cad-border bg-cad-panel overflow-hidden">
                        {UNITS.map((unit) => (
                            <button
                                key={unit}
                                onClick={() => update({ units: unit })}
                                className={`flex-1 py-1.5 text-xs font-mono transition-colors ${
                                    drawingSettings.units === unit
                                        ? "bg-cad-primary text-white"
                                        : "text-cad-muted hover:bg-cad-border/50"
                                }`}
                            >
                                {unit}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <label className={labelClass}>{t("settings.gridSpacing")}</label>
                        <input
                            type="number"
                            value={drawingSettings.gridSpacing}
                            onChange={(e) =>
                                update({ gridSpacing: parseFloat(e.target.value) || 10 })
                            }
                            className={fieldClass}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className={labelClass}>{t("settings.snapAperture")}</label>
                        <input
                            type="number"
                            value={drawingSettings.snapDistance}
                            onChange={(e) =>
                                update({ snapDistance: parseFloat(e.target.value) || 1 })
                            }
                            className={fieldClass}
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <label className={labelClass}>{t("settings.objectSnap")}</label>
                    <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                        {SNAP_TYPE_OPTIONS.map(({ type, labelKey }) => {
                            const label = t(labelKey);
                            const isEnabled = enabledSnapTypes.includes(type);
                            return (
                                <button
                                    key={type}
                                    onClick={() =>
                                        update({
                                            enabledSnapTypes: isEnabled
                                                ? enabledSnapTypes.filter((item) => item !== type)
                                                : [...enabledSnapTypes, type],
                                        })
                                    }
                                    aria-pressed={isEnabled}
                                    className={`py-1 px-2 rounded text-[10px] font-medium border transition-colors ${
                                        isEnabled
                                            ? "bg-cad-primary/15 border-cad-primary text-cad-primary"
                                            : "bg-cad-panel border-cad-border text-cad-muted hover:bg-cad-border/40"
                                    }`}
                                    title={`${label} (${type})`}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                    <p className="text-[10px] text-cad-muted">{t("settings.nearestHint")}</p>
                </div>
            </section>

            <div className="h-px bg-cad-border" />

            <section className="space-y-3">
                <h4 className={titleClass}>{t("settings.dimensionStyle")}</h4>
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <label className={labelClass}>{t("settings.scaleFactor")}</label>
                        <input
                            type="number"
                            step="0.1"
                            value={drawingSettings.dimScale}
                            onChange={(e) => update({ dimScale: parseFloat(e.target.value) || 1 })}
                            className={fieldClass}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className={labelClass}>{t("settings.precision")}</label>
                        <input
                            type="number"
                            min="0"
                            max="8"
                            value={drawingSettings.dimPrecision}
                            onChange={(e) =>
                                update({ dimPrecision: parseInt(e.target.value, 10) || 0 })
                            }
                            className={fieldClass}
                        />
                    </div>
                </div>
                <div className="relative flex h-20 items-center justify-center overflow-hidden rounded border border-cad-border bg-cad-panel p-3">
                    <span className="absolute left-2 top-1 text-[10px] text-cad-muted">
                        {t("settings.preview")}
                    </span>
                    {/* 标注预览按当前比例与小数位实时重绘，改完不用回画布确认 */}
                    <svg width="150" height="40" className="overflow-visible">
                        <line x1="10" y1="30" x2="140" y2="30" stroke="#4ade80" strokeWidth="1" />
                        <line x1="10" y1="25" x2="10" y2="35" stroke="#4ade80" strokeWidth="1" />
                        <line x1="140" y1="25" x2="140" y2="35" stroke="#4ade80" strokeWidth="1" />
                        <text
                            x="75"
                            y="20"
                            textAnchor="middle"
                            fill="#4ade80"
                            fontSize={10 * drawingSettings.dimScale}
                            fontFamily="monospace"
                        >
                            {(100.23456).toFixed(drawingSettings.dimPrecision)}
                        </text>
                    </svg>
                </div>
            </section>

            <div className="h-px bg-cad-border" />

            <section className="space-y-3">
                <h4 className={titleClass}>{t("settings.cloudSync")}</h4>
                <div className="space-y-2 rounded border border-cad-border bg-cad-panel p-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-2 text-cad-text">
                            <span className={`size-2 rounded-full ${syncDot}`} />
                            {syncLabel}
                        </span>
                        <span className="font-mono text-[10px] text-cad-muted">
                            {t("settings.pendingFailed", {
                                pending: syncStatus.pendingCount,
                                failed: syncStatus.failedCount,
                            })}
                        </span>
                    </div>

                    {syncStatus.lastSyncedAt && (
                        <p className="text-[10px] text-cad-muted">
                            {t("settings.lastSynced", {
                                time: new Date(syncStatus.lastSyncedAt).toLocaleTimeString(),
                            })}
                        </p>
                    )}

                    {syncStatus.lastError && (
                        <p
                            className="max-h-12 overflow-hidden break-words text-[10px] text-red-500"
                            title={syncStatus.lastError}
                        >
                            {syncStatus.lastError}
                        </p>
                    )}

                    <div className="flex gap-2 pt-1">
                        <button
                            onClick={() => void syncService.flush()}
                            disabled={syncStatus.syncing || !syncStatus.online}
                            className={buttonClass}
                        >
                            {t("settings.syncNow")}
                        </button>
                        <button
                            onClick={() => void syncService.retryFailed()}
                            disabled={syncStatus.syncing || syncStatus.failedCount === 0}
                            className={buttonClass}
                        >
                            {t("settings.retryFailed")}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default DrawingSettingsSection;
