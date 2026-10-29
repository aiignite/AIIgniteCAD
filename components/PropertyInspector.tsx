import React, { useMemo, useRef, useState } from "react";
import { CADElement, HatchPattern, HatchPatternType, LineType, Point } from "../types";
import { useI18n, type TranslationKey } from "../lib/i18n";
import {
  LINE_TYPES,
  LINE_WEIGHT_PRESETS,
  dashArrayForLineType,
  lineWeightToScreenPx,
  normalizeLineType,
} from "../lib/lineStyle";
import { HATCH_PATTERN_OPTIONS } from "../lib/hatchPatterns";
import { hatchSpacingOf } from "../services/hatchService";
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
    new Set(["general", "lineStyle", "geometry", "hatch"])
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
        <Section title={t("property.lineStyleSection")} section="lineStyle" expanded={expandedSections} setExpanded={setExpandedSections}>
          <MultiLineStyleControls elements={selectedElements} onUpdateElement={onUpdateElement} />
        </Section>
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

        {/* Line style: 文本没有描边，不提供线型设置 */}
        {element.type !== "TEXT" && (
          <Section title={t("property.lineStyleSection")} section="lineStyle" expanded={expandedSections} setExpanded={setExpandedSections}>
            <LineStyleControls
              lineType={normalizeLineType(element.lineType)}
              lineWeight={element.lineWeight}
              onChange={(patch) => onUpdateElement({ ...element, ...patch })}
            />
          </Section>
        )}

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

        {(element.type === "HATCH") && (
          <Section title={t("property.hatchSection")} section="hatch" expanded={expandedSections} setExpanded={setExpandedSections}>
            <HatchProperties element={element} onUpdateElement={onUpdateElement} />
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

// ===== HATCH PROPERTIES =====
const HatchProperties: React.FC<{
  element: CADElement;
  onUpdateElement: (e: CADElement) => void;
}> = ({ element, onUpdateElement }) => {
  const { t } = useI18n();
  const patternType = element.hatchPattern?.type ?? "SOLID";
  const spacing = hatchSpacingOf(element);
  const angle = element.hatchAngle ?? element.hatchPattern?.angle ?? 0;

  const update = (patch: Partial<Pick<HatchPattern, "type" | "spacing" | "angle">>) => {
    onUpdateElement({
      ...element,
      hatchPattern: {
        type: patch.type ?? patternType,
        spacing: patch.spacing ?? spacing,
        angle: patch.angle ?? angle,
      },
      ...(patch.angle !== undefined ? { hatchAngle: patch.angle } : {}),
    });
  };

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <label
          className="text-cad-text-secondary whitespace-nowrap"
          htmlFor="property-hatch-pattern"
        >
          {t("hatch.pattern")}:
        </label>
        <select
          id="property-hatch-pattern"
          value={patternType}
          onChange={(e) => update({ type: e.target.value as HatchPatternType })}
          className="bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs flex-1 max-w-[128px]"
        >
          {HATCH_PATTERN_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="text-cad-text-secondary" htmlFor="property-hatch-spacing">
          {t("hatch.spacing")}:
        </label>
        <input
          id="property-hatch-spacing"
          type="number"
          min={0.1}
          step={1}
          value={spacing}
          onChange={(e) => update({ spacing: Math.max(0.1, parseFloat(e.target.value) || 0.1) })}
          className="bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs flex-1 max-w-[140px]"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="text-cad-text-secondary" htmlFor="property-hatch-angle">
          {t("hatch.angle")}:
        </label>
        <input
          id="property-hatch-angle"
          type="number"
          min={0}
          max={360}
          step={1}
          value={angle}
          onChange={(e) => update({ angle: parseFloat(e.target.value) || 0 })}
          className="bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs flex-1 max-w-[140px]"
        />
      </div>
      <p className="text-[11px] text-cad-muted leading-relaxed">{t("hatch.spacingHint")}</p>
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
        label={t("property.startRadius")}
        value={element.startRadius || 10}
        onChange={(startRadius) => onUpdateElement({ ...element, startRadius })}
        min={0.5}
        step={0.5}
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

// ===== LINE STYLE =====
const LINE_TYPE_LABEL_KEYS: Record<LineType, TranslationKey> = {
  CONTINUOUS: "property.lineTypeContinuous",
  DASHED: "property.lineTypeDashed",
  DOTTED: "property.lineTypeDotted",
  DASHDOT: "property.lineTypeDashDot",
};

interface LineStyleControlsProps {
  /** null 表示多选且线型不一致 */
  lineType: LineType | null;
  /** null 表示多选且线宽不一致；undefined 表示未设置（默认线宽） */
  lineWeight: number | null | undefined;
  onChange: (patch: { lineType?: LineType; lineWeight?: number }) => void;
}

const LineStyleControls: React.FC<LineStyleControlsProps> = ({
  lineType,
  lineWeight,
  onChange,
}) => {
  const { t } = useI18n();
  // 从 DXF 导入的线宽可能不在预设档位内，补一个只读当前值的选项，避免下拉框显示空白
  const weightOptions = useMemo(() => {
    const presets = [...LINE_WEIGHT_PRESETS];
    if (typeof lineWeight === "number" && !presets.includes(lineWeight)) {
      presets.push(lineWeight);
      presets.sort((a, b) => a - b);
    }
    return presets;
  }, [lineWeight]);

  const weightValue =
    lineWeight === null ? "mixed" : lineWeight === undefined ? "default" : String(lineWeight);
  const previewDash = dashArrayForLineType(lineType ?? "CONTINUOUS");
  const previewWidth = lineWeightToScreenPx(lineWeight ?? undefined) ?? 2;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <label className="text-cad-text-secondary" htmlFor="property-line-type">
          {t("property.lineType")}:
        </label>
        <select
          id="property-line-type"
          value={lineType ?? "mixed"}
          onChange={(e) => {
            if (e.target.value === "mixed") return;
            onChange({ lineType: normalizeLineType(e.target.value) });
          }}
          className="bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs flex-1 max-w-[140px]"
        >
          {lineType === null && (
            <option value="mixed" disabled>
              {t("property.lineTypeMixed")}
            </option>
          )}
          {LINE_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(LINE_TYPE_LABEL_KEYS[type])}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="text-cad-text-secondary" htmlFor="property-line-weight">
          {t("property.lineWeight")}:
        </label>
        <select
          id="property-line-weight"
          value={weightValue}
          onChange={(e) => {
            const next = e.target.value;
            if (next === "mixed") return;
            onChange({ lineWeight: next === "default" ? undefined : Number(next) });
          }}
          className="bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs flex-1 max-w-[140px]"
        >
          {lineWeight === null && (
            <option value="mixed" disabled>
              {t("property.lineWeightMixed")}
            </option>
          )}
          <option value="default">{t("property.lineWeightDefault")}</option>
          {weightOptions.map((weight) => (
            <option key={weight} value={String(weight)}>
              {weight.toFixed(2)} mm
            </option>
          ))}
        </select>
      </div>

      <div className="rounded border border-cad-border bg-cad-bg px-2 py-1.5">
        <svg
          className="h-4 w-full text-cad-text"
          viewBox="0 0 120 8"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line
            x1="0"
            y1="4"
            x2="120"
            y2="4"
            stroke="currentColor"
            strokeWidth={previewWidth}
            strokeDasharray={previewDash}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <p className="text-[11px] text-cad-muted leading-relaxed">
        {t("property.lineStyleHint")}
      </p>
    </div>
  );
};

const MultiLineStyleControls: React.FC<{
  elements: CADElement[];
  onUpdateElement: (e: CADElement) => void;
}> = ({ elements, onUpdateElement }) => {
  const first = elements[0];
  const firstType = normalizeLineType(first.lineType);
  const commonLineType = elements.every(
    (el) => normalizeLineType(el.lineType) === firstType,
  )
    ? firstType
    : null;
  const commonLineWeight = elements.every((el) => el.lineWeight === first.lineWeight)
    ? first.lineWeight
    : null;

  return (
    <LineStyleControls
      lineType={commonLineType}
      lineWeight={commonLineWeight}
      onChange={(patch) => {
        elements.forEach((el) => onUpdateElement({ ...el, ...patch }));
      }}
    />
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

  const onlyColor = elements.every((el) => el.color === elements[0].color)
    ? elements[0].color
    : "";

  return (
    <div className="space-y-2 text-sm">
      <PropertySelect label={t("property.layer")} value="0" onChange={handleLayerChange} />
      <PropertyColorPicker label={t("property.color")} value={onlyColor} onChange={handleColorChange} />
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
  /** 空字符串表示多选且颜色不一致 */
  value: string;
  onChange: (value: string) => void;
}

/** 常用色板：主题色、黑白与制图常用高对比色，最后一档通过调色板细选 */
const COMMON_COLORS: Array<{ value: string; labelKey?: TranslationKey }> = [
  { value: "#e6edf3", labelKey: "property.colorAuto" },
  { value: "#ffffff" },
  { value: "#000000" },
  { value: "#ef4444" },
  { value: "#f97316" },
  { value: "#fbbf24" },
  { value: "#4ade80" },
  { value: "#00c8c8" },
  { value: "#137fec" },
  { value: "#6366f1" },
  { value: "#a855f7" },
  { value: "#94a3b8" },
];

const PropertyColorPicker: React.FC<PropertyColorPickerProps> = ({
  label,
  value,
  onChange,
}) => {
  const { t } = useI18n();
  const pickerRef = useRef<HTMLInputElement>(null);
  const normalized = value.trim().toLowerCase();
  const hasColor = /^#[0-9a-f]{6}$/.test(normalized);
  const pickerValue = hasColor ? normalized : "#000000";

  const openPicker = () => {
    const input = pickerRef.current;
    if (!input) return;
    const showPicker = (input as HTMLInputElement & { showPicker?: () => void }).showPicker;
    if (typeof showPicker === "function") {
      try {
        showPicker.call(input);
        return;
      } catch {
        // 部分浏览器在非用户手势下会拒绝，退回原生 click
      }
    }
    input.click();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-cad-text-secondary">{label}:</label>
        <button
          type="button"
          onClick={openPicker}
          title={t("property.colorCustom")}
          className="flex items-center gap-1.5 rounded border border-cad-border px-1.5 py-0.5 hover:bg-cad-hover transition-colors"
        >
          <span
            className="h-3.5 w-3.5 rounded-sm border border-cad-border"
            style={{ backgroundColor: hasColor ? normalized : "transparent" }}
          />
          <span className="font-mono text-[11px] text-cad-text">
            {hasColor ? normalized.toUpperCase() : t("property.colorMixed")}
          </span>
          <span className="material-symbols-outlined text-[14px] text-cad-muted">palette</span>
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {COMMON_COLORS.map((color) => {
          const active = hasColor && normalized === color.value;
          const name = color.labelKey ? t(color.labelKey) : color.value;
          return (
            <button
              key={color.value}
              type="button"
              title={name}
              aria-label={name}
              onClick={() => onChange(color.value)}
              className={`h-5 w-5 rounded-sm border transition-transform hover:scale-110 ${
                active ? "border-cad-text ring-1 ring-cad-primary" : "border-cad-border"
              }`}
              style={{ backgroundColor: color.value }}
            />
          );
        })}
      </div>

      <input
        ref={pickerRef}
        type="color"
        value={pickerValue}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
};

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
