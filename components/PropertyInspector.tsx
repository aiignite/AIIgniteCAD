import React, { useState, useCallback } from "react";
import { CADElement, Point } from "../types";
import { useI18n } from "../lib/i18n";
import { useAlignDistribute, ALIGN_MENU_ITEMS } from "../hooks/useAlignDistribute";

/** 属性面板可触发的批量变换操作 */
export type TransformOperation = "SCALE" | "OFFSET" | "ARRAY";

/** 批量变换参数（按操作类型取用对应字段） */
export interface TransformParams {
    /** 缩放倍率 */
    factor?: number;
    /** 偏移距离 */
    distance?: number;
    /** 阵列行数 */
    rows?: number;
    /** 阵列列数 */
    columns?: number;
    /** 阵列行间距 */
    rowSpacing?: number;
    /** 阵列列间距 */
    columnSpacing?: number;
}

interface PropertyInspectorProps {
  selectedElements: CADElement[];
  onUpdateElement: (element: CADElement) => void;
  /** 触发批量变换（SCALE / OFFSET / ARRAY），由 App 统一提交历史 */
  onApplyTransform?: (operation: TransformOperation, params: TransformParams) => void;
}

/**
 * Dynamic Properties Inspector Component
 * Displays object-specific properties based on element type
 * Supports real-time editing and preview
 */
export const PropertyInspector: React.FC<PropertyInspectorProps> = ({
  selectedElements,
  onUpdateElement,
  onApplyTransform,
}) => {
  const { t } = useI18n();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["general", "geometry"])
  );

  if (selectedElements.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-cad-text-secondary text-sm">
        <div className="text-center">
          <span className="material-symbols-outlined text-3xl mb-2 block">
            info
          </span>
          {t("property.noSelection")}
        </div>
      </div>
    );
  }

  // Handle multiple selections
  if (selectedElements.length > 1) {
    return (
      <div className="p-4 space-y-3">
        <div className="bg-cad-secondary rounded px-3 py-2 text-sm">
          <strong>{t("property.multiSelected", { count: selectedElements.length })}</strong>
        </div>
        <CommonPropertiesPanel
          elements={selectedElements}
          onUpdateElement={onUpdateElement}
        />
        {onApplyTransform && (
          <Section title={t("property.transform")} section="transform" expanded={expandedSections} setExpanded={setExpandedSections}>
            <TransformOperations onApplyTransform={onApplyTransform} />
          </Section>
        )}
      </div>
    );
  }

  const element = selectedElements[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-3">
        {/* General Properties */}
        <Section title={t("property.basic")} section="general" expanded={expandedSections} setExpanded={setExpandedSections}>
          <GeneralProperties element={element} onUpdateElement={onUpdateElement} />
        </Section>

        {/* Geometry Properties */}
        <Section title={t("property.geometry")} section="geometry" expanded={expandedSections} setExpanded={setExpandedSections}>
          <GeometryProperties element={element} onUpdateElement={onUpdateElement} />
        </Section>

        {/* Type-Specific Properties */}
        {(element.type === "TEXT") && (
          <Section title={t("property.textSection")} section="text" expanded={expandedSections} setExpanded={setExpandedSections}>
            <TextProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "CIRCLE" || element.type === "ARC") && (
          <Section title={t("property.arcSection")} section="arc" expanded={expandedSections} setExpanded={setExpandedSections}>
            <CircleArcProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "ELLIPSE") && (
          <Section title={t("property.ellipseSection")} section="ellipse" expanded={expandedSections} setExpanded={setExpandedSections}>
            <EllipseProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "GEAR") && (
          <Section title={t("property.gearSection")} section="gear" expanded={expandedSections} setExpanded={setExpandedSections}>
            <GearProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "SPIRAL") && (
          <Section title={t("property.spiralSection")} section="spiral" expanded={expandedSections} setExpanded={setExpandedSections}>
            <SpiralProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "SPRING") && (
          <Section title={t("property.springSection")} section="spring" expanded={expandedSections} setExpanded={setExpandedSections}>
            <SpringProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "LWPOLYLINE") && (
          <Section title={t("property.polylineSection")} section="polyline" expanded={expandedSections} setExpanded={setExpandedSections}>
            <PolylineProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "RECTANGLE") && (
          <Section title={t("property.rectangleSection")} section="rectangle" expanded={expandedSections} setExpanded={setExpandedSections}>
            <RectangleProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "DIMENSION") && (
          <Section title={t("property.dimensionSection")} section="dimension" expanded={expandedSections} setExpanded={setExpandedSections}>
            <DimensionProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {onApplyTransform && (
          <Section title={t("property.transform")} section="transform" expanded={expandedSections} setExpanded={setExpandedSections}>
            <TransformOperations onApplyTransform={onApplyTransform} />
          </Section>
        )}
      </div>
    </div>
  );
};

// ===== SECTION COMPONENT =====
interface SectionProps {
  title: string;
  section: string;
  expanded: Set<string>;
  setExpanded: (s: Set<string>) => void;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({
  title,
  section,
  expanded,
  setExpanded,
  children,
}) => {
  const isOpen = expanded.has(section);

  const toggle = () => {
    const newSet = new Set(expanded);
    if (isOpen) {
      newSet.delete(section);
    } else {
      newSet.add(section);
    }
    setExpanded(newSet);
  };

  return (
    <div className="border border-cad-border rounded bg-cad-secondary">
      <button
        onClick={toggle}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-cad-hover transition-colors"
      >
        <span className="text-sm font-medium text-cad-text">{title}</span>
        <span
          className={`material-symbols-outlined text-sm transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          expand_more
        </span>
      </button>
      {isOpen && <div className="border-t border-cad-border px-3 py-2 space-y-2">{children}</div>}
    </div>
  );
};

// ===== GENERAL PROPERTIES =====
const GeneralProperties: React.FC<{
  element: CADElement;
  onUpdateElement: (e: CADElement) => void;
}> = ({ element, onUpdateElement }) => {
  const { t } = useI18n();
  const handleLayerChange = (layer: string) => {
    onUpdateElement({ ...element, layer });
  };

  const handleColorChange = (color: string) => {
    onUpdateElement({ ...element, color });
  };

  return (
    <div className="space-y-2 text-sm">
      <PropertyField label="ID" value={element.id} readOnly />
      <PropertyField label={t("property.type")} value={element.type} readOnly />
      <PropertySelect
        label={t("property.layer")}
        value={element.layer || "0"}
        onChange={handleLayerChange}
      />
      <PropertyColorPicker
        label={t("property.color")}
        value={element.color || "#000000"}
        onChange={handleColorChange}
      />
    </div>
  );
};

// ===== GEOMETRY PROPERTIES =====
const GeometryProperties: React.FC<{
  element: CADElement;
  onUpdateElement: (e: CADElement) => void;
}> = ({ element, onUpdateElement }) => {
  const { t } = useI18n();
  return (
    <div className="space-y-2 text-sm">
      {element.start && (
        <PropertyPoint
          label={t("property.start")}
          value={element.start}
          onChange={(start) => onUpdateElement({ ...element, start })}
        />
      )}
      {element.end && (
        <PropertyPoint
          label={t("property.end")}
          value={element.end}
          onChange={(end) => onUpdateElement({ ...element, end })}
        />
      )}
      {element.center && (
        <PropertyPoint
          label={t("property.center")}
          value={element.center}
          onChange={(center) => onUpdateElement({ ...element, center })}
        />
      )}
      {element.radius && (
        <PropertyNumber
          label={t("property.radius")}
          value={element.radius}
          onChange={(radius) => onUpdateElement({ ...element, radius })}
          min={0}
        />
      )}
    </div>
  );
};

// ===== TEXT PROPERTIES =====
const TextProperties: React.FC<{
  element: CADElement;
  onUpdateElement: (e: CADElement) => void;
}> = ({ element, onUpdateElement }) => {
  const { t } = useI18n();
  return (
    <div className="space-y-2 text-sm">
      <PropertyField
        label={t("property.text")}
        value={element.text || ""}
        onChange={(text) => onUpdateElement({ ...element, text })}
      />
      <PropertyNumber
        label={t("property.fontSize")}
        value={element.fontSize || 12}
        onChange={(fontSize) => onUpdateElement({ ...element, fontSize })}
        min={6}
        max={100}
      />
      {element.start && (
        <PropertyPoint
          label={t("property.position")}
          value={element.start}
          onChange={(start) => onUpdateElement({ ...element, start })}
        />
      )}
    </div>
  );
};

// ===== CIRCLE & ARC PROPERTIES =====
const CircleArcProperties: React.FC<{
  element: CADElement;
  onUpdateElement: (e: CADElement) => void;
}> = ({ element, onUpdateElement }) => {
  const { t } = useI18n();
  return (
    <div className="space-y-2 text-sm">
      {element.type === "ARC" && (
        <>
          <PropertyNumber
            label={t("property.startAngle")}
            value={element.startAngle || 0}
            onChange={(startAngle) => onUpdateElement({ ...element, startAngle })}
          />
          <PropertyNumber
            label={t("property.endAngle")}
            value={element.endAngle || 360}
            onChange={(endAngle) => onUpdateElement({ ...element, endAngle })}
          />
          <PropertyToggle
            label={t("property.clockwise")}
            value={element.clockwise || false}
            onChange={(clockwise) => onUpdateElement({ ...element, clockwise })}
          />
        </>
      )}
    </div>
  );
};

// ===== ELLIPSE PROPERTIES =====
const EllipseProperties: React.FC<{
  element: CADElement;
  onUpdateElement: (e: CADElement) => void;
}> = ({ element, onUpdateElement }) => {
  const { t } = useI18n();
  return (
    <div className="space-y-2 text-sm">
      <PropertyNumber
        label={t("property.radiusX")}
        value={element.radiusX || 0}
        onChange={(radiusX) => onUpdateElement({ ...element, radiusX })}
        min={0}
      />
      <PropertyNumber
        label={t("property.radiusY")}
        value={element.radiusY || 0}
        onChange={(radiusY) => onUpdateElement({ ...element, radiusY })}
        min={0}
      />
      <PropertyNumber
        label={t("property.rotation")}
        value={element.rotation || 0}
        onChange={(rotation) => onUpdateElement({ ...element, rotation })}
      />
    </div>
  );
};

// ===== RECTANGLE PROPERTIES =====
const RectangleProperties: React.FC<{
  element: CADElement;
  onUpdateElement: (e: CADElement) => void;
}> = ({ element, onUpdateElement }) => {
  const { t } = useI18n();
  return (
    <div className="space-y-2 text-sm">
      <PropertyNumber
        label={t("property.width")}
        value={element.width || 0}
        onChange={(width) => onUpdateElement({ ...element, width })}
        min={0}
      />
      <PropertyNumber
        label={t("property.height")}
        value={element.height || 0}
        onChange={(height) => onUpdateElement({ ...element, height })}
        min={0}
      />
      {element.start && (
        <PropertyPoint
          label={t("property.topLeft")}
          value={element.start}
          onChange={(start) => onUpdateElement({ ...element, start })}
        />
      )}
    </div>
  );
};

// ===== GEAR PROPERTIES =====
const GearProperties: React.FC<{
  element: CADElement;
  onUpdateElement: (e: CADElement) => void;
}> = ({ element, onUpdateElement }) => {
  const { t } = useI18n();
  return (
    <div className="space-y-2 text-sm">
      <PropertyNumber
        label={t("property.teeth")}
        value={element.numTeeth || 20}
        onChange={(numTeeth) => onUpdateElement({ ...element, numTeeth })}
        min={3}
      />
      <PropertyNumber
        label={t("property.module")}
        value={element.module || 1}
        onChange={(module) => onUpdateElement({ ...element, module })}
        min={0.1}
        step={0.1}
      />
      <PropertyNumber
        label={t("property.pressureAngle")}
        value={element.pressureAngle || 20}
        onChange={(pressureAngle) => onUpdateElement({ ...element, pressureAngle })}
        min={14}
        max={25}
      />
      <PropertyNumber
        label={t("property.addendum")}
        value={element.addendum || 1}
        onChange={(addendum) => onUpdateElement({ ...element, addendum })}
        min={0.1}
        step={0.1}
      />
      <PropertyNumber
        label={t("property.dedendum")}
        value={element.dedendum || 1.25}
        onChange={(dedendum) => onUpdateElement({ ...element, dedendum })}
        min={0.1}
        step={0.1}
      />
    </div>
  );
};

// ===== SPIRAL PROPERTIES =====
const SpiralProperties: React.FC<{
  element: CADElement;
  onUpdateElement: (e: CADElement) => void;
}> = ({ element, onUpdateElement }) => {
  const { t } = useI18n();
  return (
    <div className="space-y-2 text-sm">
      <PropertyNumber
        label={t("property.turns")}
        value={element.turns || 5}
        onChange={(turns) => onUpdateElement({ ...element, turns })}
        min={1}
      />
      <PropertyNumber
        label={t("property.radiusIncrement")}
        value={element.radiusIncrement || 10}
        onChange={(radiusIncrement) => onUpdateElement({ ...element, radiusIncrement })}
        min={0}
        step={0.5}
      />
      {element.center && (
        <PropertyPoint
          label={t("property.center")}
          value={element.center}
          onChange={(center) => onUpdateElement({ ...element, center })}
        />
      )}
    </div>
  );
};

// ===== SPRING PROPERTIES =====
const SpringProperties: React.FC<{
  element: CADElement;
  onUpdateElement: (e: CADElement) => void;
}> = ({ element, onUpdateElement }) => {
  const { t } = useI18n();
  return (
    <div className="space-y-2 text-sm">
      <PropertyNumber
        label={t("property.turns")}
        value={element.coils || 10}
        onChange={(coils) => onUpdateElement({ ...element, coils })}
        min={1}
      />
      <PropertyNumber
        label={t("property.springRadius")}
        value={element.springRadius || 20}
        onChange={(springRadius) => onUpdateElement({ ...element, springRadius })}
        min={1}
      />
      <PropertyNumber
        label={t("property.wireDiameter")}
        value={element.wireRadius || 2}
        onChange={(wireRadius) => onUpdateElement({ ...element, wireRadius })}
        min={0.5}
        step={0.5}
      />
      {element.center && (
        <PropertyPoint
          label={t("property.center")}
          value={element.center}
          onChange={(center) => onUpdateElement({ ...element, center })}
        />
      )}
    </div>
  );
};

// ===== POLYLINE PROPERTIES =====
const PolylineProperties: React.FC<{
  element: CADElement;
  onUpdateElement: (e: CADElement) => void;
}> = ({ element, onUpdateElement }) => {
  const { t } = useI18n();
  const pointCount = element.points?.length || 0;
  
  return (
    <div className="space-y-2 text-sm">
      <PropertyField label={t("property.vertices")} value={pointCount.toString()} readOnly />
      {element.points && element.points.length > 0 && (
        <div className="mt-2 p-2 bg-cad-bg rounded text-xs space-y-1 max-h-32 overflow-y-auto">
          {element.points.map((pt, idx) => (
            <div key={idx} className="text-cad-text-secondary">
              P{idx}: ({pt.x.toFixed(2)}, {pt.y.toFixed(2)})
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ===== DIMENSION PROPERTIES =====
const DimensionProperties: React.FC<{
  element: CADElement;
  onUpdateElement: (e: CADElement) => void;
}> = ({ element, onUpdateElement }) => {
  const { t } = useI18n();
  return (
    <div className="space-y-2 text-sm">
      {element.start && (
        <PropertyPoint
          label={t("property.start")}
          value={element.start}
          onChange={(start) => onUpdateElement({ ...element, start })}
        />
      )}
      {element.end && (
        <PropertyPoint
          label={t("property.end")}
          value={element.end}
          onChange={(end) => onUpdateElement({ ...element, end })}
        />
      )}
      {element.offsetPoint && (
        <PropertyPoint
          label={t("property.offsetPoint")}
          value={element.offsetPoint}
          onChange={(offsetPoint) => onUpdateElement({ ...element, offsetPoint })}
        />
      )}
      {element.text && (
        <PropertyField
          label={t("property.text")}
          value={element.text}
          onChange={(text) => onUpdateElement({ ...element, text })}
        />
      )}
    </div>
  );
};

// ===== TRANSFORM OPERATIONS =====
/**
 * 批量变换入口。
 * 将 SCALE / OFFSET / ARRAY 从工具栏与命令行延伸到属性面板：
 * 选中对象后填写参数即可执行，历史由 App 的 commitAction 统一提交。
 */
const TransformOperations: React.FC<{
  onApplyTransform: (operation: TransformOperation, params: TransformParams) => void;
}> = ({ onApplyTransform }) => {
  const { t } = useI18n();
  const { applyAlign, applyDistribute, canAlign, canDistribute } = useAlignDistribute();
  const [factor, setFactor] = useState(2);
  const [distance, setDistance] = useState(20);
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(2);
  const [rowSpacing, setRowSpacing] = useState(100);
  const [columnSpacing, setColumnSpacing] = useState(100);

  return (
    <div className="space-y-3 text-sm">
      {/* 对齐 / 分布 */}
      <div className="space-y-1.5">
        <label className="text-cad-text-secondary">{t("property.alignTitle")}:</label>
        <div className="grid grid-cols-4 gap-1">
          {ALIGN_MENU_ITEMS.map((item) => {
            const disabled = item.distribute ? !canDistribute : !canAlign;
            return (
              <button
                key={item.labelKey}
                disabled={disabled}
                title={t(item.labelKey)}
                onClick={() => {
                  if (item.align) applyAlign(item.align);
                  if (item.distribute) applyDistribute(item.distribute);
                }}
                className={`flex items-center justify-center py-1.5 rounded border border-cad-border transition-colors ${
                  disabled
                    ? "cursor-not-allowed text-cad-muted/40"
                    : "text-cad-text hover:bg-cad-text/10"
                }`}
              >
                <span
                  className={`material-symbols-outlined text-[18px] ${item.rotate ? "rotate-90" : ""}`}
                >
                  {item.icon}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 缩放 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-cad-text-secondary">{t("property.scaleFactor")}:</label>
          <input
            type="number"
            min={0.01}
            step={0.1}
            value={factor}
            onChange={(e) => setFactor(parseFloat(e.target.value) || 0)}
            className="bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs w-20"
          />
        </div>
        <button
          onClick={() => factor > 0 && onApplyTransform("SCALE", { factor })}
          disabled={factor <= 0}
          className="w-full py-1.5 rounded bg-cad-primary text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {t("property.scaleAbout")}
        </button>
      </div>

      {/* 偏移 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-cad-text-secondary">{t("property.offsetDistance")}:</label>
          <input
            type="number"
            step={1}
            value={distance}
            onChange={(e) => setDistance(parseFloat(e.target.value) || 0)}
            className="bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs w-20"
          />
        </div>
        <button
          onClick={() => distance !== 0 && onApplyTransform("OFFSET", { distance })}
          disabled={distance === 0}
          className="w-full py-1.5 rounded border border-cad-border text-cad-text text-xs font-medium hover:bg-cad-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {t("property.offsetKeep")}
        </button>
      </div>

      {/* 矩形阵列 */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between gap-1">
            <label className="text-cad-text-secondary text-xs">{t("property.rows")}:</label>
            <input
              type="number"
              min={1}
              value={rows}
              onChange={(e) => setRows(Math.max(1, parseInt(e.target.value) || 1))}
              className="bg-cad-bg border border-cad-border rounded px-1.5 py-1 text-xs w-14"
            />
          </div>
          <div className="flex items-center justify-between gap-1">
            <label className="text-cad-text-secondary text-xs">{t("property.columns")}:</label>
            <input
              type="number"
              min={1}
              value={columns}
              onChange={(e) => setColumns(Math.max(1, parseInt(e.target.value) || 1))}
              className="bg-cad-bg border border-cad-border rounded px-1.5 py-1 text-xs w-14"
            />
          </div>
          <div className="flex items-center justify-between gap-1">
            <label className="text-cad-text-secondary text-xs">{t("property.rowGap")}:</label>
            <input
              type="number"
              value={rowSpacing}
              onChange={(e) => setRowSpacing(parseFloat(e.target.value) || 0)}
              className="bg-cad-bg border border-cad-border rounded px-1.5 py-1 text-xs w-14"
            />
          </div>
          <div className="flex items-center justify-between gap-1">
            <label className="text-cad-text-secondary text-xs">{t("property.columnGap")}:</label>
            <input
              type="number"
              value={columnSpacing}
              onChange={(e) => setColumnSpacing(parseFloat(e.target.value) || 0)}
              className="bg-cad-bg border border-cad-border rounded px-1.5 py-1 text-xs w-14"
            />
          </div>
        </div>
        <button
          onClick={() =>
            onApplyTransform("ARRAY", { rows, columns, rowSpacing, columnSpacing })
          }
          className="w-full py-1.5 rounded border border-cad-border text-cad-text text-xs font-medium hover:bg-cad-hover transition-colors"
        >
          {t("property.makeArray")}
        </button>
      </div>

      <p className="text-[11px] text-cad-muted leading-relaxed">
        {t("property.transformHint")}
      </p>
    </div>
  );
};

// ===== COMMON PROPERTIES (Multi-selection) =====
const CommonPropertiesPanel: React.FC<{
  elements: CADElement[];
  onUpdateElement: (e: CADElement) => void;
}> = ({ elements, onUpdateElement }) => {
  const { t } = useI18n();
  const handleLayerChange = (layer: string) => {
    elements.forEach((el) => {
      onUpdateElement({ ...el, layer });
    });
  };

  const handleColorChange = (color: string) => {
    elements.forEach((el) => {
      onUpdateElement({ ...el, color });
    });
  };

  return (
    <div className="space-y-2 text-sm">
      <PropertySelect label={t("property.layer")} value="0" onChange={handleLayerChange} />
      <PropertyColorPicker label={t("property.color")} value="#000000" onChange={handleColorChange} />
    </div>
  );
};

// ===== INPUT COMPONENTS =====
interface PropertyFieldProps {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}

const PropertyField: React.FC<PropertyFieldProps> = ({
  label,
  value,
  onChange,
  readOnly,
}) => (
  <div className="flex items-center justify-between">
    <label className="text-cad-text-secondary">{label}:</label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      readOnly={readOnly}
      className="bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs flex-1 ml-2"
    />
  </div>
);

interface PropertyNumberProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

const PropertyNumber: React.FC<PropertyNumberProps> = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}) => (
  <div className="flex items-center justify-between">
    <label className="text-cad-text-secondary">{label}:</label>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      min={min}
      max={max}
      step={step}
      className="bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs flex-1 ml-2 w-20"
    />
  </div>
);

interface PropertyPointProps {
  label: string;
  value: Point;
  onChange: (value: Point) => void;
}

const PropertyPoint: React.FC<PropertyPointProps> = ({
  label,
  value,
  onChange,
}) => (
  <div className="space-y-1">
    <label className="text-cad-text-secondary text-xs">{label}:</label>
    <div className="flex gap-1">
      <div className="flex-1">
        <label className="text-xs text-cad-text-secondary block mb-0.5">X</label>
        <input
          type="number"
          value={value.x}
          onChange={(e) => onChange({ ...value, x: parseFloat(e.target.value) || 0 })}
          className="w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs"
        />
      </div>
      <div className="flex-1">
        <label className="text-xs text-cad-text-secondary block mb-0.5">Y</label>
        <input
          type="number"
          value={value.y}
          onChange={(e) => onChange({ ...value, y: parseFloat(e.target.value) || 0 })}
          className="w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs"
        />
      </div>
    </div>
  </div>
);

interface PropertySelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

const PropertySelect: React.FC<PropertySelectProps> = ({
  label,
  value,
  onChange,
}) => {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between">
      <label className="text-cad-text-secondary">{label}:</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs flex-1 ml-2"
      >
        <option value="0">{t("property.defaultLayer")}</option>
        <option value="AI_GENERATED">{t("property.aiGenerated")}</option>
      </select>
    </div>
  );
};

interface PropertyColorPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

const PropertyColorPicker: React.FC<PropertyColorPickerProps> = ({
  label,
  value,
  onChange,
}) => (
  <div className="flex items-center justify-between">
    <label className="text-cad-text-secondary">{label}:</label>
    <div className="flex gap-2 items-center ml-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded cursor-pointer"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs w-20"
      />
    </div>
  </div>
);

interface PropertyToggleProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

const PropertyToggle: React.FC<PropertyToggleProps> = ({
  label,
  value,
  onChange,
}) => (
  <div className="flex items-center justify-between">
    <label className="text-cad-text-secondary">{label}:</label>
    <button
      onClick={() => onChange(!value)}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
        value
          ? "bg-cad-primary text-white"
          : "bg-cad-secondary border border-cad-border text-cad-text"
      }`}
    >
      {value ? "是" : "否"}
    </button>
  </div>
);

export default PropertyInspector;
