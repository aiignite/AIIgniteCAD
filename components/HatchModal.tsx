import React, { useState } from 'react';
import { HatchPattern, HatchPatternType } from '../types';
import { useI18n } from '../lib/i18n';
import { HATCH_PATTERN_OPTIONS } from '../lib/hatchPatterns';

interface HatchModalProps {
  visible: boolean;
  onConfirm: (pattern: HatchPattern, color: string) => void;
  onCancel: () => void;
}

const colorOptions = [
  '#4a5568', '#e53e3e', '#dd6b20', '#d69e2e', '#38a169',
  '#3182ce', '#805ad5', '#d53f8c', '#718096', '#171923'
];

export const HatchModal: React.FC<HatchModalProps> = ({ visible, onConfirm, onCancel }) => {
  const { t } = useI18n();
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
        <h3 className="text-sm font-bold mb-4">{t('hatch.title')}</h3>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-cad-muted mb-2 block">{t('hatch.pattern')}</label>
            <div className="grid grid-cols-4 gap-2 max-h-32 overflow-y-auto">
              {HATCH_PATTERN_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSelectedPattern(opt.value)}
                  className={`p-2 border rounded text-xs transition-colors ${
                    selectedPattern === opt.value
                      ? 'bg-cad-primary border-cad-primary text-white'
                      : 'border-cad-border hover:border-cad-primary/50'
                  }`}
                  title={t(opt.labelKey)}
                  aria-label={t(opt.labelKey)}
                >
                  <span className="material-symbols-outlined text-lg">{opt.icon}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-cad-muted mb-1 block">{t('hatch.spacing')}</label>
              <input
                type="number"
                data-field="hatch-spacing"
                min="0.1"
                max="10000"
                step="1"
                value={spacing}
                onChange={(e) => setSpacing(Number(e.target.value))}
                className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-1.5 text-sm outline-none focus:border-cad-primary"
              />
              <p className="mt-1 text-[10px] text-cad-muted">{t('hatch.spacingHint')}</p>
            </div>
            <div>
              <label className="text-xs text-cad-muted mb-1 block">{t('hatch.angle')}</label>
              <input
                type="number"
                data-field="hatch-angle"
                min="0"
                max="360"
                value={angle}
                onChange={(e) => setAngle(Number(e.target.value))}
                className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-1.5 text-sm outline-none focus:border-cad-primary"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-cad-muted mb-2 block">{t('hatch.color')}</label>
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
