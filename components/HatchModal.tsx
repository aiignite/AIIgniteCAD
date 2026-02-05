import React, { useState } from 'react';
import { HatchPattern, HatchPatternType } from '../types';

interface HatchModalProps {
  visible: boolean;
  onConfirm: (pattern: HatchPattern, color: string) => void;
  onCancel: () => void;
}

const patternOptions: { value: HatchPatternType; label: string; icon: string }[] = [
  { value: 'SOLID', label: 'Solid (实体)', icon: 'square' },
  { value: 'HORIZONTAL', label: 'Horizontal (水平线)', icon: 'horizontal_rule' },
  { value: 'VERTICAL', label: 'Vertical (垂直线)', icon: 'vertical_align_center' },
  { value: 'DIAGONAL_RIGHT', label: 'Diagonal Right (右斜)', icon: 'remove' },
  { value: 'DIAGONAL_LEFT', label: 'Diagonal Left (左斜)', icon: 'add' },
  { value: 'CROSS', label: 'Cross (交叉)', icon: 'close' },
  { value: 'GRID', label: 'Grid (网格)', icon: 'grid_on' },
  { value: 'DOT', label: 'Dot (点阵)', icon: 'radio_button_unchecked' },
  { value: 'ANSI31', label: 'ANSI 31 (标准斜线)', icon: 'format_overline' },
  { value: 'ANSI32', label: 'ANSI 32 (标准垂直)', icon: 'vertical_align_top' },
  { value: 'ISO02W100', label: 'ISO 02W100 (ISO标准)', icon: 'architecture' },
];

const colorOptions = [
  '#4a5568', '#e53e3e', '#dd6b20', '#d69e2e', '#38a169',
  '#3182ce', '#805ad5', '#d53f8c', '#718096', '#171923'
];

export const HatchModal: React.FC<HatchModalProps> = ({ visible, onConfirm, onCancel }) => {
  const [selectedPattern, setSelectedPattern] = useState<HatchPatternType>('ANSI31');
  const [spacing, setSpacing] = useState(10);
  const [angle, setAngle] = useState(0);
  const [selectedColor, setSelectedColor] = useState('#4a5568');

  if (!visible) return null;

  const handleConfirm = () => {
    onConfirm({
      type: selectedPattern,
      spacing,
      angle
    }, selectedColor);
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
      <div className="bg-cad-panel border border-cad-border p-4 rounded-lg shadow-xl w-80 animate-in zoom-in-95 duration-200">
        <h3 className="text-sm font-bold mb-4">Hatch Settings (填充设置)</h3>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-cad-muted mb-2 block">Pattern Type (图案类型)</label>
            <div className="grid grid-cols-4 gap-2 max-h-32 overflow-y-auto">
              {patternOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSelectedPattern(opt.value)}
                  className={`p-2 border rounded text-xs transition-colors ${
                    selectedPattern === opt.value
                      ? 'bg-cad-primary border-cad-primary text-white'
                      : 'border-cad-border hover:border-cad-primary/50'
                  }`}
                  title={opt.label}
                >
                  <span className="material-symbols-outlined text-lg">{opt.icon}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-cad-muted mb-1 block">Spacing (间距)</label>
              <input
                type="number"
                min="1"
                max="100"
                value={spacing}
                onChange={(e) => setSpacing(Number(e.target.value))}
                className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-1.5 text-sm outline-none focus:border-cad-primary"
              />
            </div>
            <div>
              <label className="text-xs text-cad-muted mb-1 block">Angle (角度)°</label>
              <input
                type="number"
                min="0"
                max="360"
                value={angle}
                onChange={(e) => setAngle(Number(e.target.value))}
                className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-1.5 text-sm outline-none focus:border-cad-primary"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-cad-muted mb-2 block">Color (颜色)</label>
            <div className="flex flex-wrap gap-2">
              {colorOptions.map(color => (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  className={`w-6 h-6 rounded border-2 transition-colors ${
                    selectedColor === color
                      ? 'border-cad-primary scale-110'
                      : 'border-cad-border hover:scale-105'
                  }`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>
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
