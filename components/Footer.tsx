import React, { useState } from 'react';

interface FooterProps {
    orthoMode: boolean;
    toggleOrtho: () => void;
    snapMode: boolean;
    toggleSnap: () => void;
    gridMode: boolean;
    toggleGrid: () => void;
    onCommand: (cmd: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ 
    orthoMode, toggleOrtho, 
    snapMode, toggleSnap, 
    gridMode, toggleGrid,
    onCommand
}) => {
    const [inputValue, setInputValue] = useState("");

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            if (inputValue.trim()) {
                onCommand(inputValue);
                setInputValue(""); // Clear after execution
            }
        }
    };
    
    const ToggleButton = ({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) => (
        <button 
            onClick={onClick}
            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors font-mono
            ${active ? 'bg-cad-primary/20 text-cad-primary shadow-sm border border-cad-primary/30' : 'hover:bg-cad-text/10 text-cad-muted hover:text-cad-text border border-transparent'}`}
        >
            {label}
        </button>
    );

    return (
        <footer className="flex flex-col shrink-0 z-20 border-t border-cad-border bg-cad-panel transition-colors duration-300">
            {/* Command Line Input */}
            <div className="flex items-center px-4 py-2 border-b border-cad-border/50 bg-white dark:bg-[#0d1116] transition-colors duration-300">
                <span className="text-cad-primary font-mono text-sm mr-2 font-bold">&gt;</span>
                <input 
                    className="bg-transparent border-none text-cad-text text-sm w-full focus:ring-0 placeholder-gray-500 font-mono focus:outline-none transition-colors duration-300" 
                    placeholder="Type a command (e.g., LINE, CIRCLE, ORTHO)" 
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <div className="hidden md:flex gap-2">
                    <span className="text-[10px] text-cad-muted font-mono border border-cad-border rounded px-1.5 py-0.5 cursor-pointer hover:bg-cad-text/10 hover:text-cad-text transition-colors">ESC Cancel</span>
                    <span className="text-[10px] text-cad-muted font-mono border border-cad-border rounded px-1.5 py-0.5 cursor-pointer hover:bg-cad-text/10 hover:text-cad-text transition-colors">ENTER Execute</span>
                    <span className="text-[10px] text-cad-muted font-mono border border-cad-border rounded px-1.5 py-0.5 cursor-pointer hover:bg-cad-text/10 hover:text-cad-text transition-colors">DEL Delete</span>
                </div>
            </div>

            {/* Status Bar */}
            <div className="flex items-center justify-between px-4 h-8 bg-cad-panel text-[11px] text-cad-muted font-medium select-none transition-colors duration-300">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2 font-mono">
                        <span className="text-cad-muted">Ready</span>
                    </div>
                </div>
                
                <div className="flex items-center gap-1">
                    <button className="px-2 py-0.5 rounded hover:bg-cad-text/10 text-cad-text font-bold transition-colors">MODEL</button>
                    <div className="w-px h-3 bg-cad-border mx-1"></div>
                    <ToggleButton label="GRID" active={gridMode} onClick={toggleGrid} />
                    <ToggleButton label="SNAP" active={snapMode} onClick={toggleSnap} />
                    <ToggleButton label="ORTHO" active={orthoMode} onClick={toggleOrtho} />
                    <ToggleButton label="POLAR" active={false} onClick={() => {}} />
                    <ToggleButton label="OSNAP" active={snapMode} onClick={toggleSnap} />
                </div>
            </div>
        </footer>
    );
};