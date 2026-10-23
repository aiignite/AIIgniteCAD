/**
 * ArrayModal.tsx — 矩形阵列参数弹窗
 * 由 ARRAY 工具激活时挂载，参数确认后由画布对当前选中对象执行阵列。
 */

import React, { useState } from 'react';
import { useI18n } from '../lib/i18n';

/** 矩形阵列参数 */
export interface ArrayParams {
    /** 行数 */
    rows: number;
    /** 列数 */
    columns: number;
    /** 列间距（图纸单位） */
    columnSpacing: number;
    /** 行间距（图纸单位） */
    rowSpacing: number;
}

/** 弹窗属性 */
interface ArrayModalProps {
    /** 是否显示 */
    visible: boolean;
    /** 确认回调 */
    onConfirm: (params: ArrayParams) => void;
    /** 取消回调 */
    onCancel: () => void;
}

export const ArrayModal: React.FC<ArrayModalProps> = ({ visible, onConfirm, onCancel }) => {
    const { t } = useI18n();
    const [columns, setColumns] = useState(2);
    const [rows, setRows] = useState(2);
    const [columnSpacing, setColumnSpacing] = useState(100);
    const [rowSpacing, setRowSpacing] = useState(100);

    if (!visible) return null;

    /** 校验并提交阵列参数 */
    const handleConfirm = () => {
        onConfirm({
            rows: Math.max(1, Math.floor(rows) || 1),
            columns: Math.max(1, Math.floor(columns) || 1),
            columnSpacing: Math.max(1, columnSpacing || 1),
            rowSpacing: Math.max(1, rowSpacing || 1),
        });
    };

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
            <div className="bg-cad-panel border border-cad-border p-4 rounded-lg shadow-xl w-80 animate-in zoom-in-95 duration-200">
                <h3 className="text-sm font-bold mb-1">{t('array.title')}</h3>
                <p className="text-[11px] text-cad-muted mb-4">{t('array.hint')}</p>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs text-cad-muted mb-1 block">{t('array.columns')}</label>
                        <input
                            type="number"
                            min="1"
                            max="20"
                            value={columns}
                            onChange={(e) => setColumns(Number(e.target.value))}
                            className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-1.5 text-sm outline-none focus:border-cad-primary"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-cad-muted mb-1 block">{t('array.rows')}</label>
                        <input
                            type="number"
                            min="1"
                            max="20"
                            value={rows}
                            onChange={(e) => setRows(Number(e.target.value))}
                            className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-1.5 text-sm outline-none focus:border-cad-primary"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                        <label className="text-xs text-cad-muted mb-1 block">{t('array.columnSpacing')}</label>
                        <input
                            type="number"
                            min="1"
                            max="500"
                            value={columnSpacing}
                            onChange={(e) => setColumnSpacing(Number(e.target.value))}
                            className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-1.5 text-sm outline-none focus:border-cad-primary"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-cad-muted mb-1 block">{t('array.rowSpacing')}</label>
                        <input
                            type="number"
                            min="1"
                            max="500"
                            value={rowSpacing}
                            onChange={(e) => setRowSpacing(Number(e.target.value))}
                            className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-1.5 text-sm outline-none focus:border-cad-primary"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 text-xs text-cad-muted hover:bg-cad-border/50 rounded"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="px-3 py-1.5 text-xs bg-cad-primary text-white rounded hover:bg-cad-primaryHover"
                    >
                        {t('common.apply')}
                    </button>
                </div>
            </div>
        </div>
    );
};
