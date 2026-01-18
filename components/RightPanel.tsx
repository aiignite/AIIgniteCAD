import React, { useState, useEffect, useRef } from 'react';
import { SidePanelMode, ChatMessage, CADElement, LLMModel, Assistant, DrawingSettings, ProjectFile } from '../types';
import { sendCADCommandToGemini } from '../services/geminiService';

interface RightPanelProps {
    mode: SidePanelMode;
    onChangeMode: (mode: SidePanelMode) => void;
    currentElements: CADElement[];
    onUpdateElement: (el: CADElement) => void;
    onApplyAIAction: (operation: string, elements?: CADElement[]) => void;
    drawingSettings: DrawingSettings;
    onUpdateSettings: (settings: DrawingSettings) => void;
    // Files Props
    files: ProjectFile[];
    onLoadFile: (file: ProjectFile) => void;
    onCreateFile: (name: string) => void;
    onRenameFile: (id: string, newName: string) => void;
    onDeleteFile: (id: string) => void;
}

export const RightPanel: React.FC<RightPanelProps> = ({ 
    mode, onChangeMode, currentElements, onUpdateElement, onApplyAIAction,
    drawingSettings, onUpdateSettings,
    files, onLoadFile, onCreateFile, onRenameFile, onDeleteFile
}) => {
    // --- STATE ---
    
    // Properties Panel State: INSPECTOR (Props+Layers), STRUCTURE (Old Model List), BLOCKS
    const [propTab, setPropTab] = useState<'INSPECTOR' | 'STRUCTURE' | 'BLOCKS'>('INSPECTOR');
    
    // Structure Tab State
    const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set(['0', 'AI_GENERATED']));

    // Files State
    const [searchQuery, setSearchQuery] = useState("");
    const [editingFileId, setEditingFileId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");

    // LLM Models State
    const [llmModels, setLlmModels] = useState<LLMModel[]>([
        { id: '1', name: 'Gemini 1.5 Pro', provider: 'Google', status: 'Active' },
        { id: '2', name: 'Llama 3 Local', provider: 'Ollama', status: 'Inactive' },
        { id: '3', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', status: 'Inactive' },
    ]);

    // Assistants State
    const [assistants, setAssistants] = useState<Assistant[]>([
        { id: 'layout', name: 'Layout Generator', icon: 'psychology', desc: 'Space optimization', color: 'text-cad-primary' },
        { id: 'plumbing', name: 'Plumbing Auditor', icon: 'water_drop', desc: 'Pipe connectivity', color: 'text-cyan-400' },
        { id: 'electrical', name: 'Electrical Check', icon: 'electrical_services', desc: 'Wiring compliance', color: 'text-yellow-400' },
        { id: 'safety', name: 'Safety Inspector', icon: 'health_and_safety', desc: 'Egress paths', color: 'text-red-400' },
    ]);

    // UI State
    const [activeDropdown, setActiveDropdown] = useState<string | null>(null); // ID of item with open menu
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
    
    // Chat State
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            id: '1',
            sender: 'ai',
            text: "I'm ready to help with your floor plan. I can suggest furniture arrangements or optimize pathways. What are the constraints?",
            type: 'text',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
    ]);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = () => setActiveDropdown(null);
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async () => {
        if (!inputValue.trim()) return;

        const userMsg: ChatMessage = {
            id: Date.now().toString(),
            sender: 'user',
            text: inputValue,
            type: 'text',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setMessages(prev => [...prev, userMsg]);
        setInputValue("");
        setIsLoading(true);

        try {
            const response = await sendCADCommandToGemini(userMsg.text, currentElements);

            setIsLoading(false);

            const aiMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                sender: 'ai',
                text: response.message,
                type: 'text',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            setMessages(prev => [...prev, aiMsg]);

            if (response.operation && response.operation !== 'NONE') {
                onApplyAIAction(response.operation, response.elements);
            }
        } catch (e) {
            console.error(e);
            setIsLoading(false);
            const errorMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                sender: 'ai',
                text: "Sorry, I encountered an error.",
                type: 'text',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            setMessages(prev => [...prev, errorMsg]);
        }
    };

    // --- PROPERTY UPDATE LOGIC ---
    const handlePropChange = (e: React.ChangeEvent<HTMLInputElement>, field: string, isNumber = false) => {
        const selected = currentElements.find(el => el.selected);
        if (!selected) return;

        let val: string | number = e.target.value;
        if (isNumber) {
            val = parseFloat(e.target.value);
            if (isNaN(val)) return; // Ignore invalid numbers
        }

        const newEl = { ...selected };

        if (field === 'x') {
            const numVal = val as number;
            if (newEl.start) newEl.start = { ...newEl.start, x: numVal };
            if (newEl.center) newEl.center = { ...newEl.center, x: numVal };
        } else if (field === 'y') {
            const numVal = val as number;
            if (newEl.start) newEl.start = { ...newEl.start, y: numVal };
            if (newEl.center) newEl.center = { ...newEl.center, y: numVal };
        } else if (field === 'width') {
             newEl.width = val as number;
        } else if (field === 'height') {
             newEl.height = val as number;
        } else if (field === 'radius') {
             newEl.radius = val as number;
        } else if (field === 'color') {
             newEl.color = String(val);
        } else if (field === 'layer') {
             newEl.layer = String(val);
        }

        onUpdateElement(newEl);
    };

    const toggleLayer = (layerName: string) => {
        const newSet = new Set(expandedLayers);
        if (newSet.has(layerName)) {
            newSet.delete(layerName);
        } else {
            newSet.add(layerName);
        }
        setExpandedLayers(newSet);
    };

    const toggleSelection = (element: CADElement) => {
        onUpdateElement({ ...element, selected: !element.selected });
    };

    // Explicit handler to avoid type inference issues
    const handleDropdownToggle = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setActiveDropdown(activeDropdown === id ? null : id);
    };

    const handleCreateFile = () => {
        onCreateFile("Untitled Drawing");
    };

    const startEditingFile = (file: ProjectFile) => {
        setEditingFileId(file.id);
        setEditName(file.name);
        setActiveDropdown(null);
    };

    const saveFileName = (id: string) => {
        if (editName.trim()) {
            onRenameFile(id, editName);
        }
        setEditingFileId(null);
    };

    // --- SUB-COMPONENT RENDERERS ---

    const DropdownMenu = ({ onEdit, onDelete }: { onEdit?: () => void, onDelete?: () => void }) => (
        <div className="absolute right-0 top-6 w-32 bg-cad-panel border border-cad-border rounded shadow-xl z-50 flex flex-col py-1 animate-in fade-in zoom-in duration-100">
            <button onClick={(e) => { e.stopPropagation(); onEdit?.(); }} className="px-3 py-2 text-left text-xs text-cad-muted hover:bg-cad-text/10 hover:text-cad-text flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px]">edit</span> Rename
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete?.(); }} className="px-3 py-2 text-left text-xs text-red-400 hover:bg-red-900/20 hover:text-red-300 flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px]">delete</span> Delete
            </button>
        </div>
    );

    const renderPropertiesAndStructure = () => {
        const selected = currentElements.find(e => e.selected);
        const layers = Array.from(new Set(currentElements.map(el => el.layer || '0'))).sort();

        return (
            <div className="flex flex-col h-full bg-cad-panel">
                 <div className="flex border-b border-cad-border bg-cad-panel">
                    <button onClick={() => setPropTab('INSPECTOR')} className={`flex-1 py-3 text-xs font-bold transition-colors border-b-2 ${propTab === 'INSPECTOR' ? 'text-cad-primary border-cad-primary bg-cad-primary/10' : 'text-cad-muted border-transparent hover:text-cad-text'}`}>Inspector</button>
                    <button onClick={() => setPropTab('STRUCTURE')} className={`flex-1 py-3 text-xs font-bold transition-colors border-b-2 ${propTab === 'STRUCTURE' ? 'text-cad-primary border-cad-primary bg-cad-primary/10' : 'text-cad-muted border-transparent hover:text-cad-text'}`}>Structure</button>
                    <button onClick={() => setPropTab('BLOCKS')} className={`flex-1 py-3 text-xs font-bold transition-colors border-b-2 ${propTab === 'BLOCKS' ? 'text-cad-primary border-cad-primary bg-cad-primary/10' : 'text-cad-muted border-transparent hover:text-cad-text'}`}>Blocks</button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {propTab === 'INSPECTOR' && (
                        <>
                            {/* General Section */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-xs font-bold text-cad-muted uppercase tracking-wider">General</h3>
                                    {selected ? (
                                        <span className="text-[10px] px-1.5 py-0.5 bg-cad-primary/20 text-cad-primary rounded border border-cad-primary/30">{selected.type}</span>
                                    ) : (
                                        <span className="text-[10px] text-gray-500 italic">No Selection</span>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-[10px] text-cad-muted font-medium">COLOR</label>
                                        <div className="h-8 bg-white dark:bg-black/40 border border-cad-border rounded flex items-center px-2 gap-2 relative group-input">
                                            <input 
                                                type="color" 
                                                value={selected?.color || '#3b82f6'} 
                                                onChange={(e) => handlePropChange(e, 'color')}
                                                disabled={!selected}
                                                className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                                            />
                                            <div className="size-3 rounded-sm pointer-events-none" style={{ backgroundColor: selected?.color || '#3b82f6' }}></div>
                                            <span className="text-xs text-cad-text pointer-events-none">{selected?.color || 'ByLayer'}</span>
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] text-cad-muted font-medium">LAYER</label>
                                        <div className="h-8 bg-white dark:bg-black/40 border border-cad-border rounded flex items-center px-2 gap-2">
                                            <span className="material-symbols-outlined text-[14px] text-gray-500">layers</span>
                                            <input 
                                                value={selected?.layer || '0'} 
                                                onChange={(e) => handlePropChange(e, 'layer')}
                                                disabled={!selected}
                                                className="w-full bg-transparent text-xs text-cad-text outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="h-px bg-cad-border"></div>
                            {/* Geometry Section */}
                            <div className="space-y-3">
                                <h3 className="text-xs font-bold text-cad-muted uppercase tracking-wider">Geometry</h3>
                                {selected ? (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-cad-muted font-medium">Position X</label>
                                            <input 
                                                type="number"
                                                value={(selected.start?.x || selected.center?.x || 0).toFixed(2)} 
                                                onChange={(e) => handlePropChange(e, 'x', true)}
                                                className="w-full h-8 bg-gray-100 dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-right font-mono text-cad-text focus:border-cad-primary focus:bg-white dark:focus:bg-black/40 outline-none transition-colors" 
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-cad-muted font-medium">Position Y</label>
                                            <input 
                                                type="number"
                                                value={(selected.start?.y || selected.center?.y || 0).toFixed(2)} 
                                                onChange={(e) => handlePropChange(e, 'y', true)}
                                                className="w-full h-8 bg-gray-100 dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-right font-mono text-cad-text focus:border-cad-primary focus:bg-white dark:focus:bg-black/40 outline-none transition-colors" 
                                            />
                                        </div>
                                        {(selected.type === 'RECTANGLE' || selected.width !== undefined) && <>
                                            <div className="space-y-1">
                                                <label className="text-[10px] text-cad-muted font-medium">Width</label>
                                                <input 
                                                    type="number"
                                                    value={Math.abs(selected.width || 0).toFixed(2)} 
                                                    onChange={(e) => handlePropChange(e, 'width', true)}
                                                    className="w-full h-8 bg-gray-100 dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-right font-mono text-cad-text focus:border-cad-primary focus:bg-white dark:focus:bg-black/40 outline-none transition-colors" 
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] text-cad-muted font-medium">Height</label>
                                                <input 
                                                    type="number"
                                                    value={Math.abs(selected.height || 0).toFixed(2)} 
                                                    onChange={(e) => handlePropChange(e, 'height', true)}
                                                    className="w-full h-8 bg-gray-100 dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-right font-mono text-cad-text focus:border-cad-primary focus:bg-white dark:focus:bg-black/40 outline-none transition-colors" 
                                                />
                                            </div>
                                        </>}
                                        {selected.type === 'CIRCLE' && (
                                            <div className="space-y-1">
                                                <label className="text-[10px] text-cad-muted font-medium">Radius</label>
                                                <input 
                                                    type="number"
                                                    value={(selected.radius || 0).toFixed(2)} 
                                                    onChange={(e) => handlePropChange(e, 'radius', true)}
                                                    className="w-full h-8 bg-gray-100 dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-right font-mono text-cad-text focus:border-cad-primary focus:bg-white dark:focus:bg-black/40 outline-none transition-colors" 
                                                />
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="p-4 bg-cad-bg rounded border border-cad-border/50 text-center"><span className="text-xs text-cad-muted">Select an object to view geometry</span></div>
                                )}
                            </div>
                        </>
                    )}

                    {propTab === 'STRUCTURE' && (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] text-cad-muted font-bold uppercase">Layers</span>
                                <span className="text-[10px] text-gray-500">{currentElements.length} Entities</span>
                            </div>
                            {layers.map(layerName => {
                                const layerElements = currentElements.filter(el => (el.layer || '0') === layerName);
                                const isExpanded = expandedLayers.has(layerName);
                                return (
                                    <div key={layerName} className="border border-cad-border rounded bg-cad-bg overflow-hidden">
                                        <div 
                                            className="flex items-center p-2 bg-cad-panel hover:bg-cad-border/50 cursor-pointer transition-colors"
                                            onClick={() => toggleLayer(layerName)}
                                        >
                                            <span className="material-symbols-outlined text-[16px] text-cad-muted mr-2 transform transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>chevron_right</span>
                                            <span className="material-symbols-outlined text-[16px] text-cad-muted mr-2">layers</span>
                                            <span className="text-xs font-bold text-cad-text flex-1">{layerName}</span>
                                            <span className="text-[9px] text-cad-muted bg-cad-border/50 px-1.5 rounded-full">{layerElements.length}</span>
                                        </div>
                                        {isExpanded && (
                                            <div className="flex flex-col gap-0.5 p-1 bg-cad-bg/50">
                                                {layerElements.length === 0 ? <div className="p-2 text-center text-[10px] text-gray-500 italic">Empty layer</div> : 
                                                    layerElements.map((el: CADElement) => (
                                                        <div key={el.id} onClick={() => toggleSelection(el)} className={`flex items-center p-1.5 rounded-sm hover:bg-cad-text/5 cursor-pointer text-xs ml-2 border-l-2 border-transparent transition-all ${el.selected ? 'bg-cad-primary/10 border-l-cad-primary text-cad-primary font-medium' : 'text-cad-text'}`}>
                                                            <span className="material-symbols-outlined text-[14px] mr-2 opacity-70">
                                                                {el.type === 'LINE' ? 'remove' : el.type === 'CIRCLE' ? 'circle' : el.type === 'RECTANGLE' ? 'rectangle' : el.type === 'TEXT' ? 'title' : el.type === 'DIMENSION' ? 'straighten' : el.type === 'ARC' ? 'architecture' : 'polyline'}
                                                            </span>
                                                            <span className="truncate flex-1">{el.type}</span>
                                                            <span className="text-[9px] text-cad-muted font-mono">{el.id.slice(0,4)}</span>
                                                        </div>
                                                    ))
                                                }
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    
                    {propTab === 'BLOCKS' && (
                        <div className="text-center p-8">
                            <span className="material-symbols-outlined text-gray-600 text-[32px] mb-2">grid_view</span>
                            <p className="text-xs text-gray-500">No blocks defined in this drawing.</p>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderFiles = () => {
        const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));

        return (
            <div className="flex flex-col h-full bg-cad-bg">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
                    <h3 className="text-sm font-bold text-cad-text">Project Files</h3>
                    <div className="flex items-center gap-2">
                        <button className="p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text" title="Sort">
                             <span className="material-symbols-outlined text-[20px]">sort</span>
                        </button>
                        <button 
                            onClick={handleCreateFile}
                            className="flex items-center justify-center size-6 bg-cad-primary text-white rounded hover:bg-cad-primaryHover transition-colors shadow-sm" 
                            title="New File"
                        >
                            <span className="material-symbols-outlined text-[18px]">add</span>
                        </button>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="p-3 border-b border-cad-border bg-cad-bg">
                    <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-gray-400">search</span>
                        <input 
                            type="text"
                            placeholder="Search files..."
                            className="w-full h-8 pl-8 pr-3 rounded bg-cad-panel border border-cad-border text-xs text-cad-text focus:border-cad-primary focus:ring-1 focus:ring-cad-primary outline-none transition-all placeholder-gray-500"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                {/* File List */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {filteredFiles.map((file: ProjectFile) => (
                        <div 
                            key={file.id} 
                            onClick={() => onLoadFile(file)}
                            className="group relative flex items-center p-3 rounded-lg hover:bg-cad-text/5 border border-transparent hover:border-cad-border cursor-pointer transition-all"
                        >
                            <div className="size-8 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mr-3 text-cad-primary">
                                <span className="material-symbols-outlined text-[20px]">description</span>
                            </div>
                            
                            <div className="flex-1 min-w-0">
                                {editingFileId === file.id ? (
                                    <input 
                                        autoFocus
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onBlur={() => saveFileName(file.id)}
                                        onKeyDown={(e) => e.key === 'Enter' && saveFileName(file.id)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="w-full bg-cad-bg border border-cad-primary rounded px-1 py-0.5 text-xs text-cad-text outline-none"
                                    />
                                ) : (
                                    <h4 className="text-sm font-medium text-cad-text truncate">{file.name}</h4>
                                )}
                                <span className="text-[10px] text-cad-muted">{file.lastModified}</span>
                            </div>

                            <button 
                                onClick={(e) => handleDropdownToggle(e, file.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text transition-opacity"
                            >
                                <span className="material-symbols-outlined text-[18px]">more_vert</span>
                            </button>

                            {activeDropdown === file.id && (
                                <DropdownMenu 
                                    onEdit={() => startEditingFile(file)} 
                                    onDelete={() => onDeleteFile(file.id)} 
                                />
                             )}
                        </div>
                    ))}
                    
                    {filteredFiles.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-cad-muted">
                            <span className="material-symbols-outlined text-[48px] opacity-20 mb-2">folder_off</span>
                            <p className="text-xs">No files found</p>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderLLMModels = () => {
        return (
            <div className="flex flex-col h-full bg-cad-bg">
                <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
                    <h3 className="text-sm font-bold text-cad-text">LLM Models</h3>
                    <button className="flex items-center justify-center size-6 rounded hover:bg-cad-text/10 text-gray-400 hover:text-cad-text transition-colors" title="Add Model">
                        <span className="material-symbols-outlined text-[20px]">add</span>
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                    {llmModels.map((model) => (
                        <div key={model.id} className="group relative flex items-center justify-between p-3 rounded-lg hover:bg-cad-text/5 border border-transparent hover:border-cad-border mb-2 transition-all">
                             <div className="flex items-center gap-3">
                                 <div className={`size-2 rounded-full ${model.status === 'Active' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-gray-600'}`}></div>
                                 <div className="flex flex-col">
                                     <span className="text-xs font-bold text-cad-text">{model.name}</span>
                                     <span className="text-[10px] text-cad-muted">{model.provider}</span>
                                 </div>
                             </div>
                             
                             <button 
                                onClick={(e) => handleDropdownToggle(e, model.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text transition-opacity"
                             >
                                <span className="material-symbols-outlined text-[18px]">more_vert</span>
                             </button>

                             {activeDropdown === model.id && (
                                <DropdownMenu 
                                    onEdit={() => console.log('Edit', model.id)} 
                                    onDelete={() => setLlmModels(prev => prev.filter(m => m.id !== model.id))} 
                                />
                             )}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderAssistants = () => {
        return (
            <div className="flex flex-col h-full bg-cad-bg">
                <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
                    <h3 className="text-sm font-bold text-cad-text">Assistants</h3>
                    <button className="flex items-center justify-center size-6 rounded hover:bg-cad-text/10 text-gray-400 hover:text-cad-text transition-colors" title="Create Assistant">
                        <span className="material-symbols-outlined text-[20px]">add</span>
                    </button>
                </div>
                <div className="grid grid-cols-1 gap-3 p-4">
                    {assistants.map(a => (
                         <div key={a.id} className="relative group bg-cad-panel border border-cad-border p-3 rounded-lg hover:border-cad-primary transition-all flex items-start gap-3">
                            <div onClick={() => onChangeMode(SidePanelMode.CHAT)} className="flex-1 flex gap-3 cursor-pointer">
                                <div className="p-2 bg-black/10 dark:bg-black/30 rounded-md shrink-0">
                                    <span className={`material-symbols-outlined ${a.color} text-[24px]`}>{a.icon}</span>
                                </div>
                                <div>
                                    <h4 className="text-xs font-bold text-cad-text group-hover:text-cad-primary transition-colors">{a.name}</h4>
                                    <p className="text-[10px] text-cad-muted leading-tight mt-1">{a.desc}</p>
                                </div>
                            </div>

                            <button 
                                onClick={(e) => handleDropdownToggle(e, a.id)}
                                className="opacity-0 group-hover:opacity-100 absolute top-2 right-2 p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text transition-opacity"
                            >
                                <span className="material-symbols-outlined text-[18px]">more_vert</span>
                            </button>

                            {activeDropdown === a.id && (
                                <DropdownMenu 
                                    onEdit={() => console.log('Edit Assistant', a.id)} 
                                    onDelete={() => setAssistants(prev => prev.filter(item => item.id !== a.id))} 
                                />
                             )}
                         </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderSettings = () => (
        <div className="flex flex-col h-full bg-cad-bg">
            <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
                <h3 className="text-sm font-bold text-cad-text">Drawing Settings</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                
                {/* Coordinate System */}
                <div className="space-y-3">
                    <h4 className="text-xs font-bold text-cad-muted uppercase tracking-wider">Coordinate System</h4>
                    <div className="space-y-2">
                        <label className="text-xs text-cad-text font-medium">Drawing Units</label>
                        <div className="flex rounded border border-cad-border bg-cad-panel overflow-hidden">
                            {(['mm', 'cm', 'm', 'in', 'ft'] as const).map(u => (
                                <button 
                                    key={u}
                                    onClick={() => onUpdateSettings({ ...drawingSettings, units: u })}
                                    className={`flex-1 py-1.5 text-xs font-mono transition-colors ${drawingSettings.units === u ? 'bg-cad-primary text-white' : 'text-cad-muted hover:bg-cad-border/50'}`}
                                >
                                    {u}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                         <div className="space-y-1">
                             <label className="text-[10px] text-cad-muted font-medium">Grid Spacing</label>
                             <input 
                                type="number" 
                                value={drawingSettings.gridSpacing} 
                                onChange={(e) => onUpdateSettings({...drawingSettings, gridSpacing: parseFloat(e.target.value) || 10})}
                                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs font-mono"
                             />
                         </div>
                         <div className="space-y-1">
                             <label className="text-[10px] text-cad-muted font-medium">Snap Dist</label>
                             <input 
                                type="number" 
                                value={drawingSettings.snapDistance} 
                                onChange={(e) => onUpdateSettings({...drawingSettings, snapDistance: parseFloat(e.target.value) || 1})}
                                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs font-mono"
                             />
                         </div>
                    </div>
                </div>

                <div className="h-px bg-cad-border"></div>

                {/* Dimension Style */}
                <div className="space-y-3">
                    <h4 className="text-xs font-bold text-cad-muted uppercase tracking-wider">Dimension Style</h4>
                    <div className="grid grid-cols-2 gap-3">
                         <div className="space-y-1">
                             <label className="text-[10px] text-cad-muted font-medium">Scale Factor</label>
                             <input 
                                type="number" 
                                step="0.1"
                                value={drawingSettings.dimScale} 
                                onChange={(e) => onUpdateSettings({...drawingSettings, dimScale: parseFloat(e.target.value) || 1})}
                                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs font-mono"
                             />
                         </div>
                         <div className="space-y-1">
                             <label className="text-[10px] text-cad-muted font-medium">Precision</label>
                             <input 
                                type="number" 
                                min="0" max="8"
                                value={drawingSettings.dimPrecision} 
                                onChange={(e) => onUpdateSettings({...drawingSettings, dimPrecision: parseInt(e.target.value) || 0})}
                                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs font-mono"
                             />
                         </div>
                    </div>
                    <div className="p-3 bg-cad-panel rounded border border-cad-border flex flex-col items-center justify-center h-20 overflow-hidden relative">
                         <span className="text-[10px] text-cad-muted absolute top-1 left-2">Preview</span>
                         {/* Mini preview of a dimension */}
                         <svg width="150" height="40" className="overflow-visible">
                            <line x1="10" y1="30" x2="140" y2="30" stroke="#4ade80" strokeWidth="1" />
                            <line x1="10" y1="25" x2="10" y2="35" stroke="#4ade80" strokeWidth="1" />
                            <line x1="140" y1="25" x2="140" y2="35" stroke="#4ade80" strokeWidth="1" />
                            <text x="75" y="20" textAnchor="middle" fill="#4ade80" fontSize={10 * drawingSettings.dimScale} fontFamily="monospace">
                                {(100.23456).toFixed(drawingSettings.dimPrecision)}
                            </text>
                         </svg>
                    </div>
                </div>

            </div>
        </div>
    );

    const renderChat = () => (
        <div className="flex flex-col h-full bg-cad-bg">
            <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
                <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-cad-primary text-[20px] animate-pulse">psychology</span>
                    <div>
                        <h3 className="text-sm font-bold text-cad-text leading-none">Layout Generator</h3>
                        <p className="text-[10px] text-cad-muted mt-0.5">Optimizing space usage...</p>
                    </div>
                </div>
                <span className="text-[9px] bg-cad-primary/20 text-cad-primary px-1.5 py-0.5 rounded font-mono border border-cad-primary/30">BETA</span>
            </div>

            <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-cad-bg">
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex gap-3 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
                         {msg.sender === 'ai' && (
                            <div className="size-8 rounded-full bg-white dark:bg-[#1e293b] flex items-center justify-center shrink-0 border border-cad-border shadow-sm">
                                <span className="material-symbols-outlined text-cad-primary text-[16px]">smart_toy</span>
                            </div>
                         )}
                         <div className={`flex flex-col gap-1 max-w-[85%] ${msg.sender === 'user' ? 'items-end' : ''}`}>
                            <div className={`p-3 rounded-2xl text-sm leading-relaxed shadow-sm border
                                ${msg.sender === 'ai' ? 'bg-white dark:bg-[#1e293b] rounded-tl-none border-cad-border text-cad-text' : 'bg-cad-primary text-white rounded-tr-none border-transparent'}`}>
                                {msg.text}
                            </div>
                         </div>
                    </div>
                ))}
                {isLoading && (
                     <div className="flex gap-3">
                        <div className="size-8 rounded-full bg-white dark:bg-[#1e293b] flex items-center justify-center shrink-0 border border-cad-border"><span className="material-symbols-outlined text-cad-primary text-[16px] animate-spin">sync</span></div>
                        <div className="flex items-center"><div className="typing-indicator flex gap-1"><span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"></span><span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></span><span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></span></div></div>
                     </div>
                )}
            </div>

            <div className="p-3 bg-cad-panel border-t border-cad-border">
                <div className="relative">
                    <textarea 
                        className="w-full bg-white dark:bg-[#0d1116] border border-cad-border rounded-lg pl-3 pr-10 py-2 text-sm text-cad-text placeholder-gray-500 focus:ring-1 focus:ring-cad-primary focus:border-cad-primary outline-none resize-none" 
                        placeholder="Ask Layout Generator..." 
                        rows={2}
                        value={inputValue} 
                        onChange={(e) => setInputValue(e.target.value)} 
                        onKeyDown={(e) => { 
                            if(e.key === 'Enter' && !e.shiftKey) { 
                                e.preventDefault();
                                handleSend(); 
                            }
                        }} 
                    />
                    <button onClick={handleSend} className="absolute right-2 bottom-2 p-1.5 bg-cad-primary hover:bg-blue-600 text-white rounded-md transition-colors flex items-center justify-center shadow-lg"><span className="material-symbols-outlined text-[16px]">send</span></button>
                </div>
            </div>
        </div>
    );

    const NavButton = ({ icon, label, active, onClick }: { icon: string, label: string, active: boolean, onClick: () => void }) => (
        <button onClick={onClick} className={`group flex flex-col items-center gap-1 p-2 rounded-lg transition-all w-10 ${active ? 'bg-cad-primary/20 text-cad-primary' : 'text-gray-500 hover:text-cad-text hover:bg-white/5'}`} title={label}>
            <span className={`material-symbols-outlined text-[20px] ${active ? 'filled' : ''}`}>{icon}</span>
        </button>
    );

    // --- RENDER ---
    return (
        <div className="flex h-full shrink-0 z-20 shadow-xl shadow-black/50 border-l border-cad-border bg-cad-panel">
            
            {/* Frame 1: Properties Library (Always visible on large screens or if not fully collapsed) */}
             <div className="w-64 border-r border-cad-border flex flex-col relative bg-cad-panel hidden lg:flex">
                {renderPropertiesAndStructure()}
            </div>

            {/* Frame 2: AI / Dynamic Content (Collapsible) */}
            <div className={`flex flex-col relative bg-cad-panel transition-all duration-300 ${isPanelCollapsed ? 'w-0 overflow-hidden' : 'w-80 border-l border-cad-border'}`}>
                {mode === SidePanelMode.LLM_MODELS && renderLLMModels()}
                {mode === SidePanelMode.ASSISTANTS && renderAssistants()}
                {mode === SidePanelMode.CHAT && renderChat()}
                {mode === SidePanelMode.FILES && renderFiles()}
                {mode === SidePanelMode.SETTINGS && renderSettings()}
            </div>

            {/* Navigation Strip */}
            <nav className="w-12 border-l border-cad-border bg-cad-bg dark:bg-[#0d1116] flex flex-col items-center py-4 gap-4 z-40 transition-colors duration-300">
                {/* Panel Toggle Button */}
                <button 
                    onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
                    className="group flex flex-col items-center gap-1 p-2 rounded-lg transition-all w-10 text-gray-500 hover:text-cad-text hover:bg-cad-text/5"
                    title={isPanelCollapsed ? "Expand Panel" : "Collapse Panel"}
                >
                    <span className="material-symbols-outlined text-[20px]">
                        {isPanelCollapsed ? 'keyboard_double_arrow_left' : 'keyboard_double_arrow_right'}
                    </span>
                </button>
                
                <div className="w-8 h-px bg-cad-border shrink-0"></div>

                <NavButton icon="deployed_code" label="LLM Models" active={mode === SidePanelMode.LLM_MODELS} onClick={() => { setIsPanelCollapsed(false); onChangeMode(SidePanelMode.LLM_MODELS); }} />
                <NavButton icon="group" label="Assistants" active={mode === SidePanelMode.ASSISTANTS} onClick={() => { setIsPanelCollapsed(false); onChangeMode(SidePanelMode.ASSISTANTS); }} />
                <NavButton icon="chat" label="Dialogue" active={mode === SidePanelMode.CHAT} onClick={() => { setIsPanelCollapsed(false); onChangeMode(SidePanelMode.CHAT); }} />
                <NavButton icon="folder_open" label="Files" active={mode === SidePanelMode.FILES} onClick={() => { setIsPanelCollapsed(false); onChangeMode(SidePanelMode.FILES); }} />
                
                <div className="flex-1"></div>
                <NavButton icon="settings" label="Settings" active={mode === SidePanelMode.SETTINGS} onClick={() => { setIsPanelCollapsed(false); onChangeMode(SidePanelMode.SETTINGS); }} />
                <div className="size-8 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] font-bold text-white cursor-pointer mt-2">JS</div>
            </nav>
        </div>
    );
};