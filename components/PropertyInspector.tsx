import React, { useState, useCallback } from "react";
import { CADElement, Point } from "../types";

interface PropertyInspectorProps {
  selectedElements: CADElement[];
  onUpdateElement: (element: CADElement) => void;
}

/**
 * Dynamic Properties Inspector Component
 * Displays object-specific properties based on element type
 * Supports real-time editing and preview
 */
export const PropertyInspector: React.FC<PropertyInspectorProps> = ({
  selectedElements,
  onUpdateElement,
}) => {
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
          未选中对象
        </div>
      </div>
    );
  }

  // Handle multiple selections
  if (selectedElements.length > 1) {
    return (
      <div className="p-4 space-y-3">
        <div className="bg-cad-secondary rounded px-3 py-2 text-sm">
          <strong>已选中 {selectedElements.length} 个对象</strong>
        </div>
        <CommonPropertiesPanel
          elements={selectedElements}
          onUpdateElement={onUpdateElement}
        />
      </div>
    );
  }

  const element = selectedElements[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-3">
        {/* General Properties */}
        <Section title="基本属性" section="general" expanded={expandedSections} setExpanded={setExpandedSections}>
          <GeneralProperties element={element} onUpdateElement={onUpdateElement} />
        </Section>

        {/* Geometry Properties */}
        <Section title="几何属性" section="geometry" expanded={expandedSections} setExpanded={setExpandedSections}>
          <GeometryProperties element={element} onUpdateElement={onUpdateElement} />
        </Section>

        {/* Type-Specific Properties */}
        {(element.type === "TEXT") && (
          <Section title="文本属性" section="text" expanded={expandedSections} setExpanded={setExpandedSections}>
            <TextProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "CIRCLE" || element.type === "ARC") && (
          <Section title="圆弧属性" section="arc" expanded={expandedSections} setExpanded={setExpandedSections}>
            <CircleArcProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "ELLIPSE") && (
          <Section title="椭圆属性" section="ellipse" expanded={expandedSections} setExpanded={setExpandedSections}>
            <EllipseProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "GEAR") && (
          <Section title="齿轮属性" section="gear" expanded={expandedSections} setExpanded={setExpandedSections}>
            <GearProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "SPIRAL") && (
          <Section title="螺旋线属性" section="spiral" expanded={expandedSections} setExpanded={setExpandedSections}>
            <SpiralProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "SPRING") && (
          <Section title="弹簧属性" section="spring" expanded={expandedSections} setExpanded={setExpandedSections}>
            <SpringProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "LWPOLYLINE") && (
          <Section title="多段线属性" section="polyline" expanded={expandedSections} setExpanded={setExpandedSections}>
            <PolylineProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "RECTANGLE") && (
          <Section title="矩形属性" section="rectangle" expanded={expandedSections} setExpanded={setExpandedSections}>
            <RectangleProperties element={element} onUpdateElement={onUpdateElement} />
          </Section>
        )}

        {(element.type === "DIMENSION") && (
          <Section title="标注属性" section="dimension" expanded={expandedSections} setExpanded={setExpandedSections}>
            <DimensionProperties element={element} onUpdateElement={onUpdateElement} />
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
  const handleLayerChange = (layer: string) => {
    onUpdateElement({ ...element, layer });
  };

  const handleColorChange = (color: string) => {
    onUpdateElement({ ...element, color });
  };

  return (
    <div className="space-y-2 text-sm">
      <PropertyField label="ID" value={element.id} readOnly />
      <PropertyField label="类型" value={element.type} readOnly />
      <PropertySelect
        label="图层"
        value={element.layer || "0"}
        onChange={handleLayerChange}
      />
      <PropertyColorPicker
        label="颜色"
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
  return (
    <div className="space-y-2 text-sm">
      {element.start && (
        <PropertyPoint
          label="起点"
          value={element.start}
          onChange={(start) => onUpdateElement({ ...element, start })}
        />
      )}
      {element.end && (
        <PropertyPoint
          label="终点"
          value={element.end}
          onChange={(end) => onUpdateElement({ ...element, end })}
        />
      )}
      {element.center && (
        <PropertyPoint
          label="中心"
          value={element.center}
          onChange={(center) => onUpdateElement({ ...element, center })}
        />
      )}
      {element.radius && (
        <PropertyNumber
          label="半径"
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
  return (
    <div className="space-y-2 text-sm">
      <PropertyField
        label="文本内容"
        value={element.text || ""}
        onChange={(text) => onUpdateElement({ ...element, text })}
      />
      <PropertyNumber
        label="字号"
        value={element.fontSize || 12}
        onChange={(fontSize) => onUpdateElement({ ...element, fontSize })}
        min={6}
        max={100}
      />
      {element.start && (
        <PropertyPoint
          label="位置"
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
  return (
    <div className="space-y-2 text-sm">
      {element.type === "ARC" && (
        <>
          <PropertyNumber
            label="起始角"
            value={element.startAngle || 0}
            onChange={(startAngle) => onUpdateElement({ ...element, startAngle })}
          />
          <PropertyNumber
            label="结束角"
            value={element.endAngle || 360}
            onChange={(endAngle) => onUpdateElement({ ...element, endAngle })}
          />
          <PropertyToggle
            label="顺时针"
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
  return (
    <div className="space-y-2 text-sm">
      <PropertyNumber
        label="X轴半径"
        value={element.radiusX || 0}
        onChange={(radiusX) => onUpdateElement({ ...element, radiusX })}
        min={0}
      />
      <PropertyNumber
        label="Y轴半径"
        value={element.radiusY || 0}
        onChange={(radiusY) => onUpdateElement({ ...element, radiusY })}
        min={0}
      />
      <PropertyNumber
        label="旋转角度"
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
  return (
    <div className="space-y-2 text-sm">
      <PropertyNumber
        label="宽度"
        value={element.width || 0}
        onChange={(width) => onUpdateElement({ ...element, width })}
        min={0}
      />
      <PropertyNumber
        label="高度"
        value={element.height || 0}
        onChange={(height) => onUpdateElement({ ...element, height })}
        min={0}
      />
      {element.start && (
        <PropertyPoint
          label="左上角"
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
  return (
    <div className="space-y-2 text-sm">
      <PropertyNumber
        label="齿数"
        value={element.numTeeth || 20}
        onChange={(numTeeth) => onUpdateElement({ ...element, numTeeth })}
        min={3}
      />
      <PropertyNumber
        label="模数"
        value={element.module || 1}
        onChange={(module) => onUpdateElement({ ...element, module })}
        min={0.1}
        step={0.1}
      />
      <PropertyNumber
        label="压力角(°)"
        value={element.pressureAngle || 20}
        onChange={(pressureAngle) => onUpdateElement({ ...element, pressureAngle })}
        min={14}
        max={25}
      />
      <PropertyNumber
        label="齿顶高"
        value={element.addendum || 1}
        onChange={(addendum) => onUpdateElement({ ...element, addendum })}
        min={0.1}
        step={0.1}
      />
      <PropertyNumber
        label="齿根深"
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
  return (
    <div className="space-y-2 text-sm">
      <PropertyNumber
        label="圈数"
        value={element.turns || 5}
        onChange={(turns) => onUpdateElement({ ...element, turns })}
        min={1}
      />
      <PropertyNumber
        label="半径增量"
        value={element.radiusIncrement || 10}
        onChange={(radiusIncrement) => onUpdateElement({ ...element, radiusIncrement })}
        min={0}
        step={0.5}
      />
      {element.center && (
        <PropertyPoint
          label="中心"
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
  return (
    <div className="space-y-2 text-sm">
      <PropertyNumber
        label="圈数"
        value={element.coils || 10}
        onChange={(coils) => onUpdateElement({ ...element, coils })}
        min={1}
      />
      <PropertyNumber
        label="弹簧半径"
        value={element.springRadius || 20}
        onChange={(springRadius) => onUpdateElement({ ...element, springRadius })}
        min={1}
      />
      <PropertyNumber
        label="线径"
        value={element.wireRadius || 2}
        onChange={(wireRadius) => onUpdateElement({ ...element, wireRadius })}
        min={0.5}
        step={0.5}
      />
      {element.center && (
        <PropertyPoint
          label="中心"
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
  const pointCount = element.points?.length || 0;
  
  return (
    <div className="space-y-2 text-sm">
      <PropertyField label="顶点数" value={pointCount.toString()} readOnly />
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
  return (
    <div className="space-y-2 text-sm">
      {element.start && (
        <PropertyPoint
          label="起点"
          value={element.start}
          onChange={(start) => onUpdateElement({ ...element, start })}
        />
      )}
      {element.end && (
        <PropertyPoint
          label="终点"
          value={element.end}
          onChange={(end) => onUpdateElement({ ...element, end })}
        />
      )}
      {element.offsetPoint && (
        <PropertyPoint
          label="偏移点"
          value={element.offsetPoint}
          onChange={(offsetPoint) => onUpdateElement({ ...element, offsetPoint })}
        />
      )}
      {element.text && (
        <PropertyField
          label="文本"
          value={element.text}
          onChange={(text) => onUpdateElement({ ...element, text })}
        />
      )}
    </div>
  );
};

// ===== COMMON PROPERTIES (Multi-selection) =====
const CommonPropertiesPanel: React.FC<{
  elements: CADElement[];
  onUpdateElement: (e: CADElement) => void;
}> = ({ elements, onUpdateElement }) => {
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
      <PropertySelect label="图层" value="0" onChange={handleLayerChange} />
      <PropertyColorPicker label="颜色" value="#000000" onChange={handleColorChange} />
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
}) => (
  <div className="flex items-center justify-between">
    <label className="text-cad-text-secondary">{label}:</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs flex-1 ml-2"
    >
      <option value="0">默认</option>
      <option value="AI_GENERATED">AI生成</option>
    </select>
  </div>
);

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
