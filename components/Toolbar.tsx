import React, { useState, useEffect, useRef } from 'react';
import { ToolType } from '../types';

interface ToolbarProps {
    activeTool: ToolType;
    onToolSelect: (tool: ToolType) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ activeTool, onToolSelect }) => {
    const [showOverflow, setShowOverflow] = useState(false);
    const overflowRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) {
                setShowOverflow(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);
    
    const ToolButton = ({ tool, icon, label, onClick }: { tool?: ToolType, icon: string, label: string, onClick?: () => void }) => {
        const isActive = tool && activeTool === tool;
        const handleClick = onClick || (tool ? () => onToolSelect(tool) : undefined);
        
        return (
            <button 
                onClick={handleClick}
                className={`group relative flex size-9 items-center justify-center rounded transition-all shrink-0 
                ${isActive ? 'bg-cad-primary text-white shadow-md' : 'text-gray-400 hover:bg-cad-text/10 hover:text-cad-text'}`}
                title={label}
            >
                <span className="material-symbols-outlined text-[20px]">{icon}</span>
                <span className="absolute left-10 bg-black text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-lg">
                    {label}
                </span>
            </button>
        );
    };

    return (
        <aside className="w-12 bg-cad-panel border-r border-cad-border flex flex-col items-center py-3 gap-1 shrink-0 z-10 relative">
            {/* Selection & Navigation */}
            <ToolButton tool={ToolType.SELECT} icon="arrow_selector_tool" label="Select" />
            <ToolButton tool={ToolType.PAN} icon="drag_pan" label="Pan (Move Canvas)" />
            
            <div className="w-6 h-px bg-cad-border my-1 shrink-0"></div>
            
            {/* Creation Tools */}
            <ToolButton tool={ToolType.LINE} icon="remove" label="Line" />
            <ToolButton tool={ToolType.POLYLINE} icon="polyline" label="Polyline" />
            <ToolButton tool={ToolType.CIRCLE} icon="circle" label="Circle" />
            <ToolButton tool={ToolType.ARC} icon="architecture" label="Arc" />
            <ToolButton tool={ToolType.RECTANGLE} icon="rectangle" label="Rectangle" />
            <ToolButton tool={ToolType.TEXT} icon="title" label="Text" />
            
            <div className="w-6 h-px bg-cad-border my-1 shrink-0"></div>
            
            {/* Modification Tools */}
            <ToolButton tool={ToolType.COPY} icon="content_copy" label="Copy" />
            <ToolButton tool={ToolType.TRIM} icon="content_cut" label="Trim" />
            <ToolButton tool={ToolType.MIRROR} icon="flip" label="Mirror" />
            <ToolButton tool={ToolType.ROTATE} icon="rotate_right" label="Rotate" />

            <div className="flex-1"></div>

            {/* Overflow Menu */}
            <div className="relative" ref={overflowRef}>
                <button 
                    onClick={() => setShowOverflow(!showOverflow)}
                    className={`group relative flex size-9 items-center justify-center rounded transition-all shrink-0 
                    ${showOverflow ? 'bg-cad-text/10 text-cad-text' : 'text-gray-400 hover:bg-cad-text/10 hover:text-cad-text'}`}
                    title="More Tools"
                >
                    <span className="material-symbols-outlined text-[20px]">more_horiz</span>
                </button>

                {showOverflow && (
                    <div className="absolute left-10 bottom-0 mb-0 ml-2 bg-cad-panel border border-cad-border rounded shadow-xl p-2 flex flex-col gap-1 z-50 w-40 animate-in fade-in zoom-in duration-100">
                        <div className="text-[10px] font-bold text-cad-muted uppercase px-2 py-1">Annotation</div>
                        <button 
                            onClick={() => { onToolSelect(ToolType.DIMENSION); setShowOverflow(false); }}
                            className={`flex items-center gap-3 px-2 py-1.5 rounded text-xs transition-colors
                            ${activeTool === ToolType.DIMENSION ? 'bg-cad-primary/10 text-cad-primary' : 'text-cad-text hover:bg-cad-text/5'}`}
                        >
                            <span className="material-symbols-outlined text-[18px]">straighten</span> Dimension
                        </button>
                        <button 
                            onClick={() => { onToolSelect(ToolType.MEASURE); setShowOverflow(false); }}
                            className={`flex items-center gap-3 px-2 py-1.5 rounded text-xs transition-colors
                            ${activeTool === ToolType.MEASURE ? 'bg-cad-primary/10 text-cad-primary' : 'text-cad-text hover:bg-cad-text/5'}`}
                        >
                            <span className="material-symbols-outlined text-[18px]">square_foot</span> Measure
                        </button>
                        
                        <div className="h-px bg-cad-border my-1"></div>
                        
                        <div className="text-[10px] font-bold text-cad-muted uppercase px-2 py-1">Draw</div>
                        <button 
                            onClick={() => { onToolSelect(ToolType.HATCH); setShowOverflow(false); }}
                            className={`flex items-center gap-3 px-2 py-1.5 rounded text-xs transition-colors
                            ${activeTool === ToolType.HATCH ? 'bg-cad-primary/10 text-cad-primary' : 'text-cad-text hover:bg-cad-text/5'}`}
                        >
                            <span className="material-symbols-outlined text-[18px]">texture</span> Hatch
                        </button>
                    </div>
                )}
            </div>
        </aside>
    );
};