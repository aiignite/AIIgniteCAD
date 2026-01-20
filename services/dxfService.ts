import { CADElement } from '../types';

// Helper to generate a unique ID
const uid = () => Math.random().toString(36).substr(2, 9);

// --- EXPORT LOGIC ---
export const exportToDXF = (elements: CADElement[]): string => {
    // Calculate extents (boundaries) of all elements
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    elements.forEach(el => {
        if (el.type === 'LINE' && el.start && el.end) {
            minX = Math.min(minX, el.start.x, el.end.x);
            maxX = Math.max(maxX, el.start.x, el.end.x);
            minY = Math.min(minY, el.start.y, el.end.y);
            maxY = Math.max(maxY, el.start.y, el.end.y);
        } else if (el.type === 'CIRCLE' && el.center && el.radius) {
            minX = Math.min(minX, el.center.x - el.radius);
            maxX = Math.max(maxX, el.center.x + el.radius);
            minY = Math.min(minY, el.center.y - el.radius);
            maxY = Math.max(maxY, el.center.y + el.radius);
        } else if (el.type === 'RECTANGLE' && el.start && el.width && el.height) {
            const x = el.width > 0 ? el.start.x : el.start.x + el.width;
            const y = el.height > 0 ? el.start.y : el.start.y + el.height;
            const w = Math.abs(el.width);
            const h = Math.abs(el.height);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x + w);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y + h);
        } else if (el.type === 'TEXT' && el.start) {
            minX = Math.min(minX, el.start.x);
            maxX = Math.max(maxX, el.start.x + (el.text?.length || 1) * 5);
            minY = Math.min(minY, el.start.y);
            maxY = Math.max(maxY, el.start.y + (el.fontSize || 12));
        } else if (el.type === 'LWPOLYLINE' && el.points) {
            el.points.forEach(p => {
                minX = Math.min(minX, p.x);
                maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y);
                maxY = Math.max(maxY, p.y);
            });
        } else if (el.type === 'ARC' && el.center && el.radius) {
            minX = Math.min(minX, el.center.x - el.radius);
            maxX = Math.max(maxX, el.center.x + el.radius);
            minY = Math.min(minY, el.center.y - el.radius);
            maxY = Math.max(maxY, el.center.y + el.radius);
        }
    });
    
    // Add padding to ensure nothing is cut off
    const padding = 10;
    if (minX !== Infinity) {
        minX -= padding;
        maxX += padding;
        minY -= padding;
        maxY += padding;
    } else {
        // No elements, use default bounds
        minX = 0;
        maxX = 100;
        minY = 0;
        maxY = 100;
    }

    // Build DXF with proper HEADER section containing EXTENTS
    let dxf = "0\nSECTION\n2\nHEADER\n";
    dxf += "9\n$EXTMIN\n10\n" + minX + "\n20\n" + minY + "\n";
    dxf += "9\n$EXTMAX\n10\n" + maxX + "\n20\n" + maxY + "\n";
    dxf += "0\nENDSEC\n";
    dxf += "0\nSECTION\n2\nTABLES\n0\nENDSEC\n";
    dxf += "0\nSECTION\n2\nBLOCKS\n0\nENDSEC\n";
    dxf += "0\nSECTION\n2\nENTITIES\n";

    elements.forEach(el => {
        if (el.type === 'LINE' && el.start && el.end) {
            dxf += `0\nLINE\n8\n${el.layer}\n10\n${el.start.x}\n20\n${el.start.y}\n11\n${el.end.x}\n21\n${el.end.y}\n`;
        } else if (el.type === 'CIRCLE' && el.center && el.radius) {
            dxf += `0\nCIRCLE\n8\n${el.layer}\n10\n${el.center.x}\n20\n${el.center.y}\n40\n${el.radius}\n`;
        } else if (el.type === 'RECTANGLE' && el.start && el.width && el.height) {
            // Export rectangle as LWPOLYLINE with explicit closing
            // Handle negative width/height by calculating normalized coordinates
            const x = el.width > 0 ? el.start.x : el.start.x + el.width;
            const y = el.height > 0 ? el.start.y : el.start.y + el.height;
            const w = Math.abs(el.width);
            const h = Math.abs(el.height);
            
            dxf += `0\nLWPOLYLINE\n8\n${el.layer}\n90\n5\n70\n1\n`;
            dxf += `10\n${x}\n20\n${y}\n`;                      // Bottom-left
            dxf += `10\n${x + w}\n20\n${y}\n`;                  // Bottom-right
            dxf += `10\n${x + w}\n20\n${y + h}\n`;              // Top-right
            dxf += `10\n${x}\n20\n${y + h}\n`;                  // Top-left
            dxf += `10\n${x}\n20\n${y}\n`;                      // Close back to start
        } else if (el.type === 'TEXT' && el.start && el.text) {
            dxf += `0\nTEXT\n8\n${el.layer}\n10\n${el.start.x}\n20\n${el.start.y}\n40\n${el.fontSize || 12}\n1\n${el.text}\n`;
        } else if (el.type === 'LWPOLYLINE' && el.points) {
            dxf += `0\nLWPOLYLINE\n8\n${el.layer}\n90\n${el.points.length}\n70\n0\n`;
            el.points.forEach(p => {
                dxf += `10\n${p.x}\n20\n${p.y}\n`;
            });
        } else if (el.type === 'ARC' && el.center && el.radius && el.startAngle !== undefined && el.endAngle !== undefined) {
            dxf += `0\nARC\n8\n${el.layer}\n10\n${el.center.x}\n20\n${el.center.y}\n40\n${el.radius}\n50\n${el.startAngle}\n51\n${el.endAngle}\n`;
        }
        // Dimensions are skipped for now
    });

    dxf += "0\nENDSEC\n0\nEOF";
    return dxf;
};

// --- IMPORT LOGIC ---
export const parseDXF = (dxfContent: string): CADElement[] => {
    const lines = dxfContent.split(/\r?\n/);
    const elements: CADElement[] = [];
    
    let currentEntity: any = null;
    let section = '';
    
    for (let i = 0; i < lines.length; i++) {
        const code = lines[i].trim();
        const value = lines[i + 1]?.trim();
        i++; // consume value

        if (code === '0' && value === 'SECTION') continue;
        if (code === '2' && value === 'ENTITIES') { section = 'ENTITIES'; continue; }
        if (code === '0' && value === 'ENDSEC') { section = ''; continue; }

        if (section === 'ENTITIES') {
            if (code === '0') {
                if (currentEntity) {
                    elements.push(finalizeEntity(currentEntity));
                }
                if (['LINE', 'CIRCLE', 'LWPOLYLINE', 'TEXT', 'DIMENSION', 'ARC'].includes(value)) {
                    currentEntity = { type: value, points: [] };
                } else {
                    currentEntity = null;
                }
            } else if (currentEntity) {
                parseEntityProp(currentEntity, code, value);
            }
        }
    }
    if (currentEntity) elements.push(finalizeEntity(currentEntity));

    return elements;
};

function parseEntityProp(entity: any, code: string, value: string) {
    const val = parseFloat(value);
    switch (code) {
        case '8': entity.layer = value; break;
        case '10': entity.x1 = val; if(entity.type === 'LWPOLYLINE') entity.points.push({x: val, y:0}); break; 
        case '20': entity.y1 = val; if(entity.type === 'LWPOLYLINE') entity.points[entity.points.length-1].y = val; break;
        case '11': entity.x2 = val; break;
        case '21': entity.y2 = val; break;
        case '13': entity.x3 = val; break; // Dimension def point
        case '23': entity.y3 = val; break;
        case '40': entity.r = val; entity.height = val; break; 
        case '50': entity.startAngle = val; break;
        case '51': entity.endAngle = val; break;
        case '1': entity.text = value; break; 
    }
}

function finalizeEntity(entity: any): CADElement {
    const base = { id: uid(), layer: entity.layer || '0', color: '#e6edf3' };
    
    if (entity.type === 'LINE') {
        return { ...base, type: 'LINE', start: { x: entity.x1 || 0, y: entity.y1 || 0 }, end: { x: entity.x2 || 0, y: entity.y2 || 0 } };
    } else if (entity.type === 'CIRCLE') {
        return { ...base, type: 'CIRCLE', center: { x: entity.x1 || 0, y: entity.y1 || 0 }, radius: entity.r || 10 };
    } else if (entity.type === 'TEXT') {
        return { ...base, type: 'TEXT', start: { x: entity.x1 || 0, y: entity.y1 || 0 }, text: entity.text || 'Text', fontSize: entity.height || 12 };
    } else if (entity.type === 'LWPOLYLINE') {
        return { ...base, type: 'LWPOLYLINE', points: entity.points || [] };
    } else if (entity.type === 'ARC') {
        return { 
            ...base, type: 'ARC', 
            center: { x: entity.x1 || 0, y: entity.y1 || 0 }, 
            radius: entity.r || 10,
            startAngle: entity.startAngle || 0,
            endAngle: entity.endAngle || 90
        };
    }
    
    // Fallback
    return { ...base, type: 'LINE', start: {x:0, y:0}, end: {x:0, y:0} }; 
}
