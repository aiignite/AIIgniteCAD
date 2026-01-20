import React, { useRef, useState, useEffect } from 'react';
import { ToolType, CADElement, Point, DrawingSettings } from '../types';
import * as Transform from '../lib/transform';

interface CanvasProps {
    elements: CADElement[];
    activeTool: ToolType;
    onAddElement: (el: CADElement) => void;
    onUpdateElement: (el: CADElement) => void;
    onBulkUpdate: (elements: CADElement[]) => void;
    setElements: React.Dispatch<React.SetStateAction<CADElement[]>>;
    onCommitAction: (elements: CADElement[]) => void;
    onRequestTextEntry: (pos: Point) => void;
    drawingSettings: DrawingSettings;
    orthoMode: boolean;
    snapMode: boolean;
    gridMode: boolean;
    onNotification: (msg: string) => void;
}

// Helper types
type DragMode = 'DRAW' | 'PAN' | 'SELECT_BOX' | 'MOVE_ITEMS' | 'COPY_ITEMS' | 'MIRROR_LINE' | 'MEASURE' | 'DIMENSION_HEIGHT' | 'POLYLINE_ADD' | 'ARC_POINT' | 'ROTATE_ITEMS';

// Helper functions for geometry
const dist = (p1: Point, p2: Point) => Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

const getSnapPoints = (element: CADElement): Point[] => {
    const points: Point[] = [];
    if (element.type === 'LINE' && element.start && element.end) {
        points.push(element.start, element.end, { x: (element.start.x + element.end.x) / 2, y: (element.start.y + element.end.y) / 2 });
    } else if (element.type === 'RECTANGLE' && element.start && element.width !== undefined && element.height !== undefined) {
        points.push(
            element.start,
            { x: element.start.x + element.width, y: element.start.y },
            { x: element.start.x + element.width, y: element.start.y + element.height },
            { x: element.start.x, y: element.start.y + element.height }
        );
    } else if ((element.type === 'CIRCLE' || element.type === 'ARC') && element.center) {
        points.push(element.center);
        if (element.radius) {
            points.push({ x: element.center.x + element.radius, y: element.center.y });
            points.push({ x: element.center.x - element.radius, y: element.center.y });
            points.push({ x: element.center.x, y: element.center.y + element.radius });
            points.push({ x: element.center.x, y: element.center.y - element.radius });
        }
    } else if (element.type === 'TEXT' && element.start) {
        points.push(element.start);
    } else if (element.type === 'LWPOLYLINE' && element.points) {
        points.push(...element.points);
    }
    return points;
};

// Math helpers
const sub = (v1: Point, v2: Point) => ({ x: v1.x - v2.x, y: v1.y - v2.y });
const add = (v1: Point, v2: Point) => ({ x: v1.x + v2.x, y: v1.y + v2.y });
const dot = (v1: Point, v2: Point) => v1.x * v2.x + v1.y * v2.y;
const normalize = (v: Point) => {
    const len = Math.sqrt(v.x * v.x + v.y * v.y);
    return len === 0 ? {x:0, y:0} : { x: v.x / len, y: v.y / len };
};

// SVG Arc Generation Helpers
const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number): Point => {
    const angleInRadians = (angleInDegrees) * Math.PI / 180.0;
    return {
        x: centerX + (radius * Math.cos(angleInRadians)),
        y: centerY + (radius * Math.sin(angleInRadians))
    };
};

const describeArc = (x: number, y: number, radius: number, startAngle: number, endAngle: number, clockwise: boolean): string => {
    const start = polarToCartesian(x, y, radius, startAngle);
    const end = polarToCartesian(x, y, radius, endAngle);
    
    // Determine large-arc-flag
    // The "span" of the arc depends on direction
    let span = 0;
    if (clockwise) {
        span = (endAngle - startAngle + 360) % 360;
    } else {
        span = (startAngle - endAngle + 360) % 360;
    }

    const largeArcFlag = span > 180 ? "1" : "0";
    const sweepFlag = clockwise ? "1" : "0";

    return [
        "M", start.x, start.y,
        "A", radius, radius, 0, largeArcFlag, sweepFlag, end.x, end.y
    ].join(" ");
};

// --- HIT TEST LOGIC ---
const isPointOnElement = (rawPt: Point, el: CADElement): boolean => {
    // Helper for segment distance
    const distToSeg = (p: Point, s1: Point, s2: Point) => {
        const l2 = Math.pow(dist(s1, s2), 2);
        if (l2 === 0) return dist(p, s1);
        const t = ((p.x - s1.x) * (s2.x - s1.x) + (p.y - s1.y) * (s2.y - s1.y)) / l2;
        const tClamped = Math.max(0, Math.min(1, t));
        const proj = { x: s1.x + tClamped * (s2.x - s1.x), y: s1.y + tClamped * (s2.y - s1.y) };
        return dist(p, proj);
    };

    if (el.type === 'LINE' && el.start && el.end) {
        return distToSeg(rawPt, el.start, el.end) < 5;
    }
    if (el.type === 'CIRCLE' && el.center) {
        return Math.abs(dist(rawPt, el.center) - (el.radius || 0)) < 5;
    }
    if (el.type === 'RECTANGLE' && el.start && el.width !== undefined && el.height !== undefined) {
        const x = el.start.x; const y = el.start.y; 
        const w = el.width; const h = el.height;
        // Check 4 edges (Stroke detection instead of Fill)
        if (distToSeg(rawPt, {x,y}, {x:x+w, y}) < 5) return true;
        if (distToSeg(rawPt, {x,y:y+h}, {x:x+w, y:y+h}) < 5) return true;
        if (distToSeg(rawPt, {x,y}, {x, y:y+h}) < 5) return true;
        if (distToSeg(rawPt, {x:x+w,y}, {x:x+w, y:y+h}) < 5) return true;
        return false;
    }
    if (el.type === 'LWPOLYLINE' && el.points) {
        for (let i = 0; i < el.points.length - 1; i++) {
            if (distToSeg(rawPt, el.points[i], el.points[i+1]) < 5) return true;
        }
        return false;
    }
    if (el.type === 'ARC' && el.center && el.radius) {
        return Math.abs(dist(rawPt, el.center) - el.radius) < 5;
    }
    if (el.type === 'TEXT' && el.start) {
        return dist(rawPt, el.start) < 15;
    }
    if (el.type === 'DIMENSION' && el.start && el.end) {
        const mid = { x: (el.start.x + el.end.x)/2, y: (el.start.y + el.end.y)/2 };
        return dist(rawPt, mid) < 20;
    }
    return false;
};

// Helper for Dimension Arrows
const getArrowPath = (tip: Point, angle: number, size: number) => {
    const x1 = tip.x - size * Math.cos(angle - Math.PI / 6);
    const y1 = tip.y - size * Math.sin(angle - Math.PI / 6);
    const x2 = tip.x - size * Math.cos(angle + Math.PI / 6);
    const y2 = tip.y - size * Math.sin(angle + Math.PI / 6);
    return `M ${tip.x} ${tip.y} L ${x1} ${y1} L ${x2} ${y2} Z`;
};

export const Canvas: React.FC<CanvasProps> = ({ 
    elements, activeTool, onAddElement, onUpdateElement, onBulkUpdate, setElements,
    onCommitAction, onRequestTextEntry,
    drawingSettings, orthoMode, snapMode, gridMode, onNotification
}) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 800, h: 600 });
    
    // Interaction State
    const [dragMode, setDragMode] = useState<DragMode | null>(null);
    const [startPoint, setStartPoint] = useState<Point | null>(null); 
    const [currentPoint, setCurrentPoint] = useState<Point | null>(null); 
    const [drawStart, setDrawStart] = useState<Point | null>(null); 
    const [snapIndicator, setSnapIndicator] = useState<Point | null>(null);

    // Multi-step tool states
    const [polyPoints, setPolyPoints] = useState<Point[]>([]);
    const [arcPoints, setArcPoints] = useState<Point[]>([]); // 3 points for Arc
    const [dimPoints, setDimPoints] = useState<Point[]>([]); // Start, End for Dimension

    // Helpers
    const getSVGPoint = (e: React.MouseEvent): Point => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const CTM = svgRef.current.getScreenCTM();
        if (!CTM) return { x: 0, y: 0 };
        return {
            x: (e.clientX - CTM.e) / CTM.a,
            y: (e.clientY - CTM.f) / CTM.d
        };
    };

    const applyConstraints = (pt: Point, anchor?: Point): Point => {
        let constrained = { ...pt };

        if (gridMode) {
            const spacing = drawingSettings.gridSpacing;
            constrained.x = Math.round(constrained.x / spacing) * spacing;
            constrained.y = Math.round(constrained.y / spacing) * spacing;
        }

        if (snapMode) {
            let closestDist = drawingSettings.snapDistance;
            let closestPt: Point | null = null;
            elements.forEach(el => {
                getSnapPoints(el).forEach(sp => {
                    const d = dist(pt, sp);
                    if (d < closestDist) { closestDist = d; closestPt = sp; }
                });
            });
            if (closestPt) { constrained = closestPt; setSnapIndicator(closestPt); } 
            else { setSnapIndicator(null); }
        } else { setSnapIndicator(null); }

        if (orthoMode && anchor) {
            const dx = Math.abs(constrained.x - anchor.x);
            const dy = Math.abs(constrained.y - anchor.y);
            if (dx > dy) constrained.y = anchor.y; else constrained.x = anchor.x;
        }

        return constrained;
    };

    // Keyboard handling for Polylines (Enter to finish)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && activeTool === ToolType.POLYLINE && polyPoints.length > 1) {
                const uid = Math.random().toString(36).substr(2, 9);
                onAddElement({ id: uid, type: 'LWPOLYLINE', layer: '0', color: '#e6edf3', points: polyPoints });
                setPolyPoints([]);
                setDragMode(null);
            }
            if (e.key === 'Escape') {
                setPolyPoints([]);
                setArcPoints([]);
                setDimPoints([]);
                setDragMode(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTool, polyPoints, onAddElement]);

    // Cleanup tool state when switching tools
    useEffect(() => {
        setPolyPoints([]);
        setArcPoints([]);
        setDimPoints([]);
        setDragMode(null);
    }, [activeTool]);

    const handleMouseDown = (e: React.MouseEvent) => {
        const rawPt = getSVGPoint(e);
        
        // Pan logic: 
        // 1. Pan Tool (Left click)
        // 2. Middle Click (Any tool)
        // 3. Right Click (Select Tool)
        if (activeTool === ToolType.PAN || e.button === 1 || (activeTool === ToolType.SELECT && e.button === 2)) {
            setDragMode('PAN');
            setStartPoint({ x: e.clientX, y: e.clientY });
            return;
        }

        let anchor = drawStart || undefined;
        if (activeTool === ToolType.POLYLINE && polyPoints.length > 0) anchor = polyPoints[polyPoints.length - 1];
        if (activeTool === ToolType.DIMENSION && dimPoints.length === 1) anchor = dimPoints[0];

        const pt = applyConstraints(rawPt, anchor);

        // --- Complex Feature Placeholders ---
        if ([ToolType.HATCH].includes(activeTool)) {
            onNotification(`Tool '${activeTool}' is complex and requires backend implementation.`);
            return;
        }

        if (activeTool === ToolType.ROTATE) {
            const selected = elements.filter(el => el.selected);
            if (selected.length === 0) {
                onNotification("Select objects first to rotate.");
                return;
            }
            setDragMode('ROTATE_ITEMS');
            setDrawStart(pt); // Use this as rotation center
            return;
        }

        // --- POLYLINE TOOL ---
        if (activeTool === ToolType.POLYLINE) {
            setPolyPoints(prev => [...prev, pt]);
            setDragMode('POLYLINE_ADD');
            return; // Don't reset state
        }

        // --- ARC TOOL (3-Point) ---
        if (activeTool === ToolType.ARC) {
            const newPoints = [...arcPoints, pt];
            if (newPoints.length === 3) {
                // Calculate center and radius
                const [p1, p2, p3] = newPoints;
                // Simplified circle from 3 points
                const D = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
                if (Math.abs(D) < 0.01) {
                    onNotification("Points are collinear, cannot draw arc.");
                } else {
                    const Ux = ((p1.x**2 + p1.y**2) * (p2.y - p3.y) + (p2.x**2 + p2.y**2) * (p3.y - p1.y) + (p3.x**2 + p3.y**2) * (p1.y - p2.y)) / D;
                    const Uy = ((p1.x**2 + p1.y**2) * (p3.x - p2.x) + (p2.x**2 + p2.y**2) * (p1.x - p3.x) + (p3.x**2 + p3.y**2) * (p2.x - p1.x)) / D;
                    const center = { x: Ux, y: Uy };
                    const radius = dist(center, p1);
                    
                    // Calculate Angles
                    const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x) * 180 / Math.PI;
                    const midAngle = Math.atan2(p2.y - center.y, p2.x - center.x) * 180 / Math.PI;
                    const endAngle = Math.atan2(p3.y - center.y, p3.x - center.x) * 180 / Math.PI;

                    // Determine Direction
                    const norm = (a: number) => (a + 360) % 360;
                    const a1 = norm(startAngle);
                    const a2 = norm(midAngle);
                    const a3 = norm(endAngle);
                    const cwDist12 = (a2 - a1 + 360) % 360;
                    const cwDist13 = (a3 - a1 + 360) % 360;
                    const isClockwise = cwDist12 < cwDist13;

                    onAddElement({
                        id: Math.random().toString(36).substr(2, 9),
                        type: 'ARC', layer: '0', color: '#e6edf3',
                        center, radius, startAngle, endAngle,
                        clockwise: isClockwise
                    });
                }
                setArcPoints([]);
                setDragMode(null);
            } else {
                setArcPoints(newPoints);
                setDragMode('ARC_POINT');
            }
            return;
        }

        // --- DIMENSION TOOL ---
        if (activeTool === ToolType.DIMENSION) {
            if (dimPoints.length === 0) {
                setDimPoints([pt]);
                setDrawStart(pt);
            } else if (dimPoints.length === 1) {
                setDimPoints(prev => [...prev, pt]);
                setDragMode('DIMENSION_HEIGHT');
            } else {
                // Finalize Dimension
                const p1 = dimPoints[0];
                const p2 = dimPoints[1];
                const heightPt = pt;
                
                onAddElement({
                    id: Math.random().toString(36).substr(2, 9),
                    type: 'DIMENSION', 
                    layer: 'DIM', // Default specific layer for dimensions
                    color: '#4ade80', // Default green color for dimensions
                    start: p1, end: p2, offsetPoint: heightPt
                });
                setDimPoints([]);
                setDragMode(null);
            }
            return;
        }

        // --- TEXT TOOL ---
        if (activeTool === ToolType.TEXT) {
            onRequestTextEntry(pt); // Request Modal via App
            return;
        }

        // --- MEASURE TOOL ---
        if (activeTool === ToolType.MEASURE) {
            setDragMode('MEASURE');
            setDrawStart(pt);
            setCurrentPoint(pt);
            return;
        }

        // --- SELECT/MOVE ---
        if (activeTool === ToolType.SELECT) {
            const hitElement = elements.slice().reverse().find(el => isPointOnElement(rawPt, el));

            if (hitElement) {
                if (!hitElement.selected && !e.shiftKey) {
                    setElements(prev => prev.map(el => ({ ...el, selected: el.id === hitElement.id })));
                } else if (!hitElement.selected && e.shiftKey) {
                    setElements(prev => prev.map(el => el.id === hitElement.id ? { ...el, selected: true } : el));
                }
                setDragMode('MOVE_ITEMS');
                setDrawStart(rawPt);
            } else {
                if (!e.shiftKey) setElements(prev => prev.map(el => ({ ...el, selected: false })));
                setDragMode('SELECT_BOX');
                setDrawStart(rawPt);
            }
            return;
        }

        // --- COPY TOOL ---
        if (activeTool === ToolType.COPY) {
            const hitElement = elements.slice().reverse().find(el => isPointOnElement(rawPt, el));
            if (hitElement) {
                if (!hitElement.selected && !e.shiftKey) {
                    setElements(prev => prev.map(el => ({ ...el, selected: el.id === hitElement.id })));
                } else if (!hitElement.selected && e.shiftKey) {
                    setElements(prev => prev.map(el => el.id === hitElement.id ? { ...el, selected: true } : el));
                }
                setDragMode('COPY_ITEMS');
                setDrawStart(rawPt);
            } else {
                if (!e.shiftKey) setElements(prev => prev.map(el => ({ ...el, selected: false })));
                setDragMode('SELECT_BOX');
                setDrawStart(rawPt);
            }
            return;
        }
        
        if (activeTool === ToolType.MIRROR) {
            setDragMode('MIRROR_LINE');
            setDrawStart(pt);
            setCurrentPoint(pt);
            return;
        }
        
        if (activeTool === ToolType.TRIM) {
             const hitElement = elements.slice().reverse().find(el => isPointOnElement(rawPt, el));
             if (hitElement) {
                 const newEls = elements.filter(e => e.id !== hitElement.id);
                 onCommitAction(newEls); // Trim is an immediate action, commit history
             }
             return;
        }

        // --- DRAWING TOOLS (Single Click/Drag) ---
        setDragMode('DRAW');
        setDrawStart(pt);
        setCurrentPoint(pt);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const rawPt = getSVGPoint(e);
        let anchor = drawStart || undefined;
        if (activeTool === ToolType.POLYLINE && polyPoints.length > 0) anchor = polyPoints[polyPoints.length-1];
        if (activeTool === ToolType.DIMENSION && dimPoints.length === 1) anchor = dimPoints[0];

        const pt = applyConstraints(rawPt, anchor);

        if (dragMode === 'PAN' && startPoint) {
            const dx = (e.clientX - startPoint.x) * (viewBox.w / svgRef.current!.clientWidth);
            const dy = (e.clientY - startPoint.y) * (viewBox.h / svgRef.current!.clientHeight);
            setViewBox(prev => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
            setStartPoint({ x: e.clientX, y: e.clientY });
            return;
        }

        setCurrentPoint(pt);

        if ((dragMode === 'MOVE_ITEMS' || dragMode === 'COPY_ITEMS') && drawStart) {
            const dx = rawPt.x - drawStart.x; 
            const dy = rawPt.y - drawStart.y;
            let effDx = dx, effDy = dy;
            if (orthoMode) { if (Math.abs(dx) > Math.abs(dy)) effDy = 0; else effDx = 0; }
        }
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        const rawPt = getSVGPoint(e);
        const pt = applyConstraints(rawPt, drawStart || undefined);

        if (activeTool === ToolType.POLYLINE || activeTool === ToolType.ARC || activeTool === ToolType.DIMENSION) {
            return; // Multi-step handled in click
        }

        if (dragMode === 'MEASURE' && drawStart) {
            onNotification(`Distance: ${dist(drawStart, pt).toFixed(drawingSettings.dimPrecision)} ${drawingSettings.units}`);
        }

        if (dragMode === 'SELECT_BOX' && drawStart) {
            const x = Math.min(drawStart.x, rawPt.x);
            const y = Math.min(drawStart.y, rawPt.y);
            const w = Math.abs(drawStart.x - rawPt.x);
            const h = Math.abs(drawStart.y - rawPt.y);
            
            const selectedIds = new Set<string>();
            elements.forEach(el => {
                let px = 0, py = 0;
                if (el.start) { px = el.start.x; py = el.start.y; }
                else if (el.center) { px = el.center.x; py = el.center.y; }
                if (px >= x && px <= x+w && py >= y && py <= y+h) selectedIds.add(el.id);
            });
            setElements(prev => prev.map(el => ({ ...el, selected: selectedIds.has(el.id) || (e.shiftKey && el.selected) })));
        }

        // Handle Movement Finalization
        if (dragMode === 'MOVE_ITEMS' && drawStart) {
            const dx = rawPt.x - drawStart.x;
            const dy = rawPt.y - drawStart.y;
            let effDx = dx, effDy = dy;
            if (orthoMode) { if (Math.abs(dx) > Math.abs(dy)) effDy = 0; else effDx = 0; }
            
            if (Math.abs(effDx) > 0 || Math.abs(effDy) > 0) {
                // Calculate final positions
                const updatedElements = elements.map(el => {
                    if (!el.selected) return el;
                    const newEl = { ...el };
                    if (newEl.start) newEl.start = { x: newEl.start.x + effDx, y: newEl.start.y + effDy };
                    if (newEl.end) newEl.end = { x: newEl.end.x + effDx, y: newEl.end.y + effDy };
                    if (newEl.center) newEl.center = { x: newEl.center.x + effDx, y: newEl.center.y + effDy };
                    if (newEl.points) newEl.points = newEl.points.map(p => ({ x: p.x + effDx, y: p.y + effDy }));
                    if (newEl.offsetPoint) newEl.offsetPoint = { x: newEl.offsetPoint.x + effDx, y: newEl.offsetPoint.y + effDy };
                    return newEl;
                });
                onCommitAction(updatedElements); // Save to history
            }
        }

        // Handle Copy Finalization
        if (dragMode === 'COPY_ITEMS' && drawStart) {
            const dx = rawPt.x - drawStart.x;
            const dy = rawPt.y - drawStart.y;
            let effDx = dx, effDy = dy;
            if (orthoMode) { if (Math.abs(dx) > Math.abs(dy)) effDy = 0; else effDx = 0; }
            
            if (Math.abs(effDx) > 0 || Math.abs(effDy) > 0) {
                const newItems: CADElement[] = [];
                const selectedElements = elements.filter(e => e.selected);
                
                selectedElements.forEach(el => {
                    const copy: CADElement = { ...el, id: Math.random().toString(36).substr(2, 9), selected: true };
                    if (copy.start) copy.start = { x: copy.start.x + effDx, y: copy.start.y + effDy };
                    if (copy.end) copy.end = { x: copy.end.x + effDx, y: copy.end.y + effDy };
                    if (copy.center) copy.center = { x: copy.center.x + effDx, y: copy.center.y + effDy };
                    if (copy.points) copy.points = copy.points.map(p => ({ x: p.x + effDx, y: p.y + effDy }));
                    if (copy.offsetPoint) copy.offsetPoint = { x: copy.offsetPoint.x + effDx, y: copy.offsetPoint.y + effDy };
                    newItems.push(copy);
                });
                
                if (newItems.length > 0) {
                    const updatedElements = [...elements.map(e => ({...e, selected: false})), ...newItems];
                    onCommitAction(updatedElements);
                }
            }
        }

        if (dragMode === 'MIRROR_LINE' && drawStart) {
             if (dist(drawStart, pt) > 5) {
                 const A = pt.y - drawStart.y;
                 const B = drawStart.x - pt.x;
                 const C = -A * drawStart.x - B * drawStart.y;
                 const div = A*A + B*B;
                 const reflect = (p: Point): Point => { 
                     const d = (A * p.x + B * p.y + C) / div; 
                     return { x: p.x - 2 * A * d, y: p.y - 2 * B * d }; 
                 };
                 
                 const selectedElements = elements.filter(e => e.selected);
                 if (selectedElements.length === 0) {
                     onNotification("No objects selected to mirror.");
                 } else {
                     const newItems: CADElement[] = [];
                     selectedElements.forEach(el => {
                         const copy: CADElement = { ...el, id: Math.random().toString(36).substr(2, 9), selected: true };
                         if (copy.start) copy.start = reflect(copy.start);
                         if (copy.end) copy.end = reflect(copy.end);
                         if (copy.center) copy.center = reflect(copy.center);
                         if (copy.points) copy.points = copy.points.map(p => reflect(p));
                         if (copy.offsetPoint) copy.offsetPoint = reflect(copy.offsetPoint);
                         
                         // Handle Rectangle special case
                         if (copy.type === 'RECTANGLE' && el.start && el.width && el.height) {
                             const p1 = el.start;
                             const p2 = { x: el.start.x + el.width, y: el.start.y };
                             const p3 = { x: el.start.x + el.width, y: el.start.y + el.height };
                             const p4 = { x: el.start.x, y: el.start.y + el.height };
                             
                             const rp1 = reflect(p1);
                             const rp2 = reflect(p2);
                             const rp3 = reflect(p3);
                             const rp4 = reflect(p4);
                             
                             copy.type = 'LWPOLYLINE';
                             copy.points = [rp1, rp2, rp3, rp4, rp1]; 
                             delete copy.width;
                             delete copy.height;
                             copy.start = undefined;
                         }
                         
                         newItems.push(copy);
                     });
                     
                     if (newItems.length > 0) {
                        const updatedElements = [...elements.map(e => ({...e, selected: false})), ...newItems];
                        onCommitAction(updatedElements);
                        onNotification(`Mirrored ${newItems.length} objects.`);
                     }
                 }
             }
        }

        if (dragMode === 'ROTATE_ITEMS' && drawStart) {
            const angle = Math.atan2(pt.y - drawStart.y, pt.x - drawStart.x) * 180 / Math.PI;
            const selectedElements = elements.filter(e => e.selected);
            if (selectedElements.length > 0) {
                const rotated = Transform.rotateElements(selectedElements, drawStart, angle);
                const rotatedIds = new Set(rotated.map(r => r.id));
                const updatedElements = [...elements.filter(el => !rotatedIds.has(el.id)), ...rotated];
                onCommitAction(updatedElements);
                onNotification(`Rotated ${selectedElements.length} objects.`);
            }
        }

        // Handle Drawing Completion
        if (dragMode === 'DRAW' && drawStart && currentPoint && dist(drawStart, pt) > 2) {
            const uid = Math.random().toString(36).substr(2, 9);
            let newElement: CADElement | null = null;
            if (activeTool === ToolType.LINE) {
                newElement = { id: uid, type: 'LINE', layer: '0', color: '#e6edf3', start: drawStart, end: pt };
            } else if (activeTool === ToolType.RECTANGLE) {
                newElement = { id: uid, type: 'RECTANGLE', layer: '0', color: '#e6edf3', start: drawStart, width: pt.x - drawStart.x, height: pt.y - drawStart.y };
            } else if (activeTool === ToolType.CIRCLE) {
                const radius = dist(drawStart, pt);
                newElement = { id: uid, type: 'CIRCLE', layer: '0', color: '#e6edf3', center: drawStart, radius: radius };
            }
            if (newElement) onAddElement(newElement); // This triggers history commit in App
        }

        setDragMode(null);
        setDrawStart(null);
        setCurrentPoint(null);
        setStartPoint(null);
    };

    const handleWheel = (e: React.WheelEvent) => {
        if (!svgRef.current) return;
        
        // Calculate new Scale
        const scaleFactor = e.deltaY > 0 ? 1.1 : 0.9;
        
        const newW = viewBox.w * scaleFactor;
        const newH = viewBox.h * scaleFactor;

        // Get mouse position relative to SVG element (0 to 1)
        const rect = svgRef.current.getBoundingClientRect();
        const mouseXRel = (e.clientX - rect.left) / rect.width;
        const mouseYRel = (e.clientY - rect.top) / rect.height;

        // Calculate new X/Y such that the point under mouse remains stable
        // NewX = OldX + (WidthDiff * MouseRatio)
        const newX = viewBox.x + (viewBox.w - newW) * mouseXRel;
        const newY = viewBox.y + (viewBox.h - newH) * mouseYRel;

        setViewBox({
            x: newX,
            y: newY,
            w: newW,
            h: newH
        });
    };

    // Render helper for Dimension
    const renderDimension = (el: CADElement, isSelected: boolean) => {
        if (!el.start || !el.end || !el.offsetPoint) return null;
        
        // Calculate perpendicular offset
        const v = sub(el.end, el.start);
        const len = dist(el.start, el.end);
        if (len === 0) return null;

        const unitV = { x: v.x / len, y: v.y / len };
        const normal = { x: -unitV.y, y: unitV.x };
        
        // Project offsetPoint onto normal to get height
        const vOffset = sub(el.offsetPoint, el.start);
        const h = dot(vOffset, normal);
        
        const scale = drawingSettings.dimScale || 1;
        const originOffset = 2 * scale; // Gap from object
        const extensionOver = 3 * scale; // Extension past dim line
        const dir = Math.sign(h) || 1; // Direction of dimension

        const p1ExtStart = add(el.start, { x: normal.x * dir * originOffset, y: normal.y * dir * originOffset });
        const p1ExtEnd = add(el.start, { x: normal.x * (h + dir * extensionOver), y: normal.y * (h + dir * extensionOver) });
        
        const p2ExtStart = add(el.end, { x: normal.x * dir * originOffset, y: normal.y * dir * originOffset });
        const p2ExtEnd = add(el.end, { x: normal.x * (h + dir * extensionOver), y: normal.y * (h + dir * extensionOver) });
        
        const dimLineStart = add(el.start, { x: normal.x * h, y: normal.y * h });
        const dimLineEnd = add(el.end, { x: normal.x * h, y: normal.y * h });
        
        // Text Position
        const mid = { x: (dimLineStart.x + dimLineEnd.x) / 2, y: (dimLineStart.y + dimLineEnd.y) / 2 };
        const textOffset = 5 * scale;
        const textPos = add(mid, { x: normal.x * dir * textOffset, y: normal.y * dir * textOffset });
        
        // Use standard green color for dimensions unless selected, or user override
        const color = isSelected ? '#fbbf24' : (el.color === '#e6edf3' ? '#4ade80' : el.color);

        // Arrows
        const angle = Math.atan2(dimLineEnd.y - dimLineStart.y, dimLineEnd.x - dimLineStart.x);
        const arrowSize = 6 * scale;
        const arrow1 = getArrowPath(dimLineStart, angle + Math.PI, arrowSize);
        const arrow2 = getArrowPath(dimLineEnd, angle, arrowSize);

        // Text Rotation
        let textRot = angle * 180 / Math.PI;
        if (textRot > 90 || textRot < -90) textRot += 180;

        return (
            <g key={el.id} opacity={isSelected ? 1 : 0.9}>
                {/* Extension Lines */}
                <line x1={p1ExtStart.x} y1={p1ExtStart.y} x2={p1ExtEnd.x} y2={p1ExtEnd.y} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/>
                <line x1={p2ExtStart.x} y1={p2ExtStart.y} x2={p2ExtEnd.x} y2={p2ExtEnd.y} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/>
                {/* Dimension Line */}
                <line x1={dimLineStart.x} y1={dimLineStart.y} x2={dimLineEnd.x} y2={dimLineEnd.y} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/>
                {/* Arrows */}
                <path d={arrow1} fill={color} />
                <path d={arrow2} fill={color} />
                {/* Text */}
                <text 
                    x={textPos.x} y={textPos.y} 
                    fill={color} 
                    fontSize={10 * scale} 
                    textAnchor="middle" 
                    alignmentBaseline="middle"
                    transform={`rotate(${textRot}, ${textPos.x}, ${textPos.y})`}
                    style={{textShadow: '0 0 4px rgba(0,0,0,0.5)'}}
                >
                    {len.toFixed(drawingSettings.dimPrecision)}
                </text>
            </g>
        );
    };
    
    // Determine Cursor
    const getCursor = () => {
        if (dragMode === 'PAN' || activeTool === ToolType.PAN) return 'grab';
        if (activeTool === ToolType.SELECT || activeTool === ToolType.COPY) return 'move';
        return 'crosshair';
    };

    return (
        <main className={`flex-1 relative bg-cad-bg overflow-hidden group/canvas`}>
            {/* Status Overlay */}
            <div className="absolute top-4 left-4 bg-cad-panel/80 backdrop-blur border border-cad-border rounded px-3 py-1.5 text-xs font-mono text-cad-muted pointer-events-none select-none z-10 flex items-center gap-2">
                <span>Top View [2D Wireframe]</span>
                <span className="w-px h-3 bg-gray-500"></span>
                <span>Zoom: {Math.round(800 / viewBox.w * 100)}%</span>
            </div>
            
            {dragMode === 'MIRROR_LINE' && <div className="absolute top-12 left-4 bg-blue-900/80 border border-blue-500 rounded px-3 py-1 text-xs text-white z-10">Draw mirror line...</div>}
            {dragMode === 'MEASURE' && <div className="absolute top-12 left-4 bg-green-900/80 border border-green-500 rounded px-3 py-1 text-xs text-white z-10">Measuring distance...</div>}
            {dragMode === 'COPY_ITEMS' && <div className="absolute top-12 left-4 bg-cad-primary/80 border border-cad-primary rounded px-3 py-1 text-xs text-white z-10">Drag to copy...</div>}
            {activeTool === ToolType.POLYLINE && <div className="absolute top-12 left-4 bg-cad-primary/80 border border-cad-primary rounded px-3 py-1 text-xs text-white z-10">Click to add points, Enter to finish</div>}
            {activeTool === ToolType.DIMENSION && <div className="absolute top-12 left-4 bg-cad-primary/80 border border-cad-primary rounded px-3 py-1 text-xs text-white z-10">{dimPoints.length === 0 ? "Click Start Point" : dimPoints.length === 1 ? "Click End Point" : "Set Distance"}</div>}

            <div className="w-full h-full" id="drawing-surface">
                <svg 
                    ref={svgRef}
                    className="w-full h-full block"
                    viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onWheel={handleWheel}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{ cursor: getCursor() }}
                >
                    <defs>
                        <marker id="arrow" markerHeight="10" markerUnits="strokeWidth" markerWidth="10" orient="auto" refX="9" refY="3">
                            <path d="M0,0 L0,6 L9,3 z" fill="#137fec"></path>
                        </marker>
                        
                        {/* Dynamic Grid Pattern */}
                        {gridMode && (
                            <pattern id="grid" width={drawingSettings.gridSpacing} height={drawingSettings.gridSpacing} patternUnits="userSpaceOnUse">
                                <path d={`M ${drawingSettings.gridSpacing} 0 L 0 0 0 ${drawingSettings.gridSpacing}`} fill="none" stroke="var(--cad-grid)" strokeWidth="1"/>
                            </pattern>
                        )}
                    </defs>
                    
                    {/* Render Grid */}
                    {gridMode && <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill="url(#grid)" vectorEffect="non-scaling-stroke" />}

                    {/* Origin Axis (UCS Icon) */}
                    <g>
                        <line x1="0" y1="0" x2="50" y2="0" stroke="red" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                        <line x1="0" y1="0" x2="0" y2="50" stroke="green" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                        <rect x="-2" y="-2" width="4" height="4" fill="white" stroke="none" vectorEffect="non-scaling-stroke" />
                    </g>

                    {/* Render Existing Elements */}
                    {elements.map(el => {
                        const isSelected = el.selected;
                        const style = { 
                            stroke: isSelected ? '#fbbf24' : (el.color === '#e6edf3' ? 'var(--cad-text)' : el.color), 
                            strokeWidth: isSelected ? 3 : 2,
                            strokeDasharray: isSelected ? '5,2' : 'none',
                        };
                        
                        let tx = 0, ty = 0;
                        if (isSelected && (dragMode === 'MOVE_ITEMS' || dragMode === 'COPY_ITEMS') && drawStart && currentPoint) {
                            tx = currentPoint.x - drawStart.x;
                            ty = currentPoint.y - drawStart.y;
                            if (orthoMode) { if (Math.abs(tx) > Math.abs(ty)) ty = 0; else tx = 0; }
                        }
                        const transform = `translate(${tx}, ${ty})`;

                        if (el.type === 'LINE' && el.start && el.end) {
                            return <line key={el.id} x1={el.start.x} y1={el.start.y} x2={el.end.x} y2={el.end.y} {...style} transform={transform} vectorEffect="non-scaling-stroke" />;
                        }
                        if (el.type === 'RECTANGLE' && el.start && el.width) {
                            const x = el.width > 0 ? el.start.x : el.start.x + el.width;
                            const y = el.height! > 0 ? el.start.y : el.start.y + el.height!;
                            return <rect key={el.id} x={x} y={y} width={Math.abs(el.width)} height={Math.abs(el.height || 0)} fill="none" {...style} transform={transform} vectorEffect="non-scaling-stroke" />;
                        }
                        if (el.type === 'CIRCLE' && el.center && el.radius) {
                            return <circle key={el.id} cx={el.center.x} cy={el.center.y} r={el.radius} fill="none" {...style} transform={transform} vectorEffect="non-scaling-stroke" />;
                        }
                        if (el.type === 'TEXT' && el.start && el.text) {
                            return <text key={el.id} x={el.start.x} y={el.start.y} fill={isSelected ? '#fbbf24' : 'var(--cad-text)'} fontSize={el.fontSize || 12} fontFamily="monospace" transform={transform} style={{userSelect: 'none', ...style, stroke: 'none'}}>{el.text}</text>;
                        }
                        if (el.type === 'LWPOLYLINE' && el.points) {
                            const pts = el.points.map(p => `${p.x},${p.y}`).join(' ');
                            return <polyline key={el.id} points={pts} fill="none" {...style} transform={transform} vectorEffect="non-scaling-stroke" />;
                        }
                        if (el.type === 'ARC' && el.center && el.radius && el.startAngle !== undefined && el.endAngle !== undefined) {
                            // SVG Path for Arc
                            const pathData = describeArc(el.center.x, el.center.y, el.radius, el.startAngle, el.endAngle, el.clockwise || false);
                            return <path key={el.id} d={pathData} fill="none" {...style} transform={transform} vectorEffect="non-scaling-stroke" />;
                        }
                        if (el.type === 'DIMENSION') {
                            return renderDimension(el, !!isSelected);
                        }
                        return null;
                    })}

                    {/* Interactive Drawing States */}
                    {activeTool === ToolType.POLYLINE && polyPoints.length > 0 && currentPoint && (
                        <g>
                             <polyline points={polyPoints.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#137fec" strokeWidth={2} vectorEffect="non-scaling-stroke"/>
                             <line x1={polyPoints[polyPoints.length-1].x} y1={polyPoints[polyPoints.length-1].y} x2={currentPoint.x} y2={currentPoint.y} stroke="#137fec" strokeDasharray="5,5" vectorEffect="non-scaling-stroke"/>
                        </g>
                    )}

                    {activeTool === ToolType.ARC && arcPoints.length > 0 && currentPoint && (
                        <g>
                            {arcPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2} fill="red"/>)}
                            <line x1={arcPoints[arcPoints.length-1].x} y1={arcPoints[arcPoints.length-1].y} x2={currentPoint.x} y2={currentPoint.y} stroke="#137fec" strokeDasharray="5,5"/>
                        </g>
                    )}

                    {activeTool === ToolType.DIMENSION && (
                        <g>
                            {dimPoints.length === 1 && currentPoint && (
                                <line x1={dimPoints[0].x} y1={dimPoints[0].y} x2={currentPoint.x} y2={currentPoint.y} stroke="#137fec" strokeDasharray="5,5"/>
                            )}
                            {dimPoints.length === 2 && currentPoint && (
                                // Show preview of dimension
                                renderDimension({ 
                                    id: 'temp', type: 'DIMENSION', layer: 'DIM', color: '#4ade80',
                                    start: dimPoints[0], end: dimPoints[1], offsetPoint: currentPoint 
                                }, false)
                            )}
                        </g>
                    )}

                    {/* Render Ghost Shape while Drag-Drawing */}
                    {dragMode === 'DRAW' && drawStart && currentPoint && (
                        <g opacity="0.6">
                            {activeTool === ToolType.LINE && (
                                <line x1={drawStart.x} y1={drawStart.y} x2={currentPoint.x} y2={currentPoint.y} stroke="#137fec" strokeWidth={2} strokeDasharray="5,5" vectorEffect="non-scaling-stroke" />
                            )}
                            {activeTool === ToolType.RECTANGLE && (
                                <rect 
                                    x={Math.min(drawStart.x, currentPoint.x)} 
                                    y={Math.min(drawStart.y, currentPoint.y)} 
                                    width={Math.abs(currentPoint.x - drawStart.x)} 
                                    height={Math.abs(currentPoint.y - drawStart.y)} 
                                    fill="rgba(19, 127, 236, 0.1)" stroke="#137fec" strokeWidth={2} strokeDasharray="5,5" vectorEffect="non-scaling-stroke" 
                                />
                            )}
                             {activeTool === ToolType.CIRCLE && (
                                <circle 
                                    cx={drawStart.x} 
                                    cy={drawStart.y} 
                                    r={dist(drawStart, currentPoint)} 
                                    fill="none" stroke="#137fec" strokeWidth={2} strokeDasharray="5,5" vectorEffect="non-scaling-stroke" 
                                />
                            )}
                        </g>
                    )}

                    {/* Render Mirror Line */}
                    {dragMode === 'MIRROR_LINE' && drawStart && currentPoint && (
                         <line x1={drawStart.x} y1={drawStart.y} x2={currentPoint.x} y2={currentPoint.y} stroke="#fbbf24" strokeWidth={1} strokeDasharray="10,5,2,5" vectorEffect="non-scaling-stroke" />
                    )}

                    {/* Render Measure Line */}
                    {dragMode === 'MEASURE' && drawStart && currentPoint && (
                         <g>
                             <line x1={drawStart.x} y1={drawStart.y} x2={currentPoint.x} y2={currentPoint.y} stroke="#22c55e" strokeWidth={2} strokeDasharray="4,2" vectorEffect="non-scaling-stroke" />
                             <text x={(drawStart.x + currentPoint.x)/2} y={(drawStart.y + currentPoint.y)/2 - 10} fill="#22c55e" fontSize="12" textAnchor="middle" style={{textShadow: '0 1px 2px black'}}>
                                 {dist(drawStart, currentPoint).toFixed(drawingSettings.dimPrecision)} {drawingSettings.units}
                             </text>
                         </g>
                    )}

                    {/* Render Selection Box */}
                    {dragMode === 'SELECT_BOX' && drawStart && currentPoint && (
                        <rect 
                            x={Math.min(drawStart.x, currentPoint.x)} 
                            y={Math.min(drawStart.y, currentPoint.y)} 
                            width={Math.abs(currentPoint.x - drawStart.x)} 
                            height={Math.abs(currentPoint.y - drawStart.y)} 
                            fill="rgba(59, 130, 246, 0.2)" stroke="#3b82f6" strokeWidth={1} vectorEffect="non-scaling-stroke" 
                        />
                    )}

                    {/* Snap Indicator */}
                    {snapIndicator && (
                        <rect 
                            x={snapIndicator.x - 3} y={snapIndicator.y - 3} 
                            width="6" height="6" 
                            fill="#facc15" stroke="none" 
                            className="animate-pulse"
                            vectorEffect="non-scaling-stroke" 
                        />
                    )}
                </svg>
            </div>
            
             {/* Floating Zoom Controls */}
             <div className="absolute top-4 right-4 flex flex-col items-center gap-1">
                 <div className="bg-cad-panel/90 backdrop-blur rounded p-1 shadow-lg border border-cad-border flex flex-col gap-1">
                    <button className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-cad-text" onClick={() => setViewBox(v => ({...v, w: v.w * 0.9, h: v.h * 0.9}))}><span className="material-symbols-outlined text-lg">add</span></button>
                    <button className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-cad-text" onClick={() => setViewBox(v => ({...v, w: v.w * 1.1, h: v.h * 1.1}))}><span className="material-symbols-outlined text-lg">remove</span></button>
                    <button className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-cad-text" onClick={() => setViewBox({ x: 0, y: 0, w: 800, h: 600 })}><span className="material-symbols-outlined text-lg">crop_free</span></button>
                 </div>
            </div>
        </main>
    );
};