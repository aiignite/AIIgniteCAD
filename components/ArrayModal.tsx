import React, { useState } from 'react';
import { ToolType } from '../types';

interface ArrayModalProps {
  visible: boolean;
  onConfirm: (params: any) => void;
  onCancel: () => void;
}

export const ArrayModal: React.FC<ArrayModalProps> = ({ visible, onConfirm, onCancel }) => {
  const [arrayType, setArrayType] = useState<'RECTANGULAR' | 'POLAR'>('RECTANGULAR');
  const [columns, setColumns] = useState(2);
  const [rows, setRows] = useState(2);
  const [columnSpacing, setColumnSpacing] = useState(100);
  const [rowSpacing, setRowSpacing] = useState(100);
  const [center, setCenter] = useState({ x: 400, y: 300 });
  const [polarCount, setPolarCount] = useState(6);
  const [polarAngle, setPolarAngle] = useState(60);
  const [polarRadius, setPolarRadius] = useState(150);

  if (!visible) return null;

  const handleConfirm = () => {
    const params: any = arrayType === 'RECTANGULAR' ? {
      type: 'RECTANGULAR',
      columns,
      rows,
      columnSpacing,
      rowSpacing,
      center
    } : {
      type: 'POLAR',
      count: polarCount,
      angle: polarAngle,
      radius: polarRadius,
      center
    };
    onConfirm(params);
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
      <div className="bg-cad-panel border border-cad-border p-4 rounded-lg shadow-xl w-96 animate-in zoom-in-95 duration-200">
        <h3 className="text-sm font-bold mb-4">Array Settings (阵列设置)</h3>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-cad-muted mb-2 block">Array Type (阵列类型)</label>
            <div className="flex gap-2">
              <button
                onClick={() => setArrayType('RECTANGULAR')}
                className={`flex-1 px-3 py-2 text-xs rounded transition-colors ${
                  arrayType === 'RECTANGULAR' ? 'bg-cad-primary text-white' : 'bg-cad-border hover:bg-cad-text/5'
                }`}
              >
                Rectangular (矩形)
              </button>
              <button
                onClick={() => setArrayType('POLAR')}
                className={`flex-1 px-3 py-2 text-xs rounded transition-colors ${
                  arrayType === 'POLAR' ? 'bg-cad-primary text-white' : 'bg-cad-border hover:bg-cad-text/5'
                }`}
              >
                Polar (环形)
              </button>
            </div>
          </div>

          {arrayType === 'RECTANGULAR' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-cad-muted mb-1 block">Columns (列数)</label>
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
                  <label className="text-xs text-cad-muted mb-1 block">Rows (行数)</label>
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-cad-muted mb-1 block">Column Spacing (列间距)</label>
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
                  <label className="text-xs text-cad-muted mb-1 block">Row Spacing (行间距)</label>
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
            </>
          )}

          {arrayType === 'POLAR' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-cad-muted mb-1 block">Count (数量)</label>
                  <input
                    type="number"
                    min="2"
                    max="50"
                    value={polarCount}
                    onChange={(e) => setPolarCount(Number(e.target.value))}
                    className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-1.5 text-sm outline-none focus:border-cad-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-cad-muted mb-1 block">Angle (角度)</label>
                  <input
                    type="number"
                    min="0"
                    max="360"
                    value={polarAngle}
                    onChange={(e) => setPolarAngle(Number(e.target.value))}
                    className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-1.5 text-sm outline-none focus:border-cad-primary"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-cad-muted mb-1 block">Radius (半径)</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={polarRadius}
                  onChange={(e) => setPolarRadius(Number(e.target.value))}
                  className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-1.5 text-sm outline-none focus:border-cad-primary"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-cad-muted hover:bg-cad-border/50 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-3 py-1.5 text-xs bg-cad-primary text-white rounded hover:bg-cad-primaryHover"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};
