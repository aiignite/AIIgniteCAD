import React, { useState } from 'react';
import { ToolType } from '../types';

interface AdvancedShapeModalProps {
    tool: ToolType;
    onConfirm: (params: any) => void;
    onCancel: () => void;
}

export const AdvancedShapeModal: React.FC<AdvancedShapeModalProps> = ({
    tool,
    onConfirm,
    onCancel
}) => {
    // Gear parameters
    const [numTeeth, setNumTeeth] = useState(20);
    const [module, setModule] = useState(5);
    const [pressureAngle, setPressureAngle] = useState(20);

    // Polygon parameters
    const [sides, setSides] = useState(6);
    const [rotation, setRotation] = useState(0);

    // Ellipse parameters
    const [radiusX, setRadiusX] = useState(100);
    const [radiusY, setRadiusY] = useState(60);
    const [ellipseRotation, setEllipseRotation] = useState(0);

    // Spiral parameters
    const [turns, setTurns] = useState(3);
    const [startRadius, setStartRadius] = useState(20);
    const [radiusIncrement, setRadiusIncrement] = useState(30);

    // Spring parameters
    const [coils, setCoils] = useState(8);
    const [springRadius, setSpringRadius] = useState(20);

    // Involute parameters
    const [baseRadius, setBaseRadius] = useState(50);
    const [involuteTurns, setInvoluteTurns] = useState(2);

    const handleConfirm = () => {
        let params: any = {};
        
        switch (tool) {
            case ToolType.GEAR:
                params = { numTeeth, module, pressureAngle };
                break;
            case ToolType.POLYGON:
                params = { sides, rotation };
                break;
            case ToolType.ELLIPSE:
                params = { radiusX, radiusY, rotation: ellipseRotation };
                break;
            case ToolType.SPIRAL:
                params = { turns, startRadius, radiusIncrement };
                break;
            case ToolType.SPRING:
                params = { coils, springRadius };
                break;
            case ToolType.INVOLUTE:
                params = { baseRadius, turns: involuteTurns };
                break;
        }
        
        onConfirm(params);
    };

    const renderInputs = () => {
        switch (tool) {
            case ToolType.GEAR:
                return (
                    <>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Number of Teeth
                            </label>
                            <input
                                type="number"
                                min="3"
                                max="200"
                                value={numTeeth}
                                onChange={(e) => setNumTeeth(parseInt(e.target.value) || 20)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Module (mm)
                            </label>
                            <input
                                type="number"
                                min="0.5"
                                max="50"
                                step="0.5"
                                value={module}
                                onChange={(e) => setModule(parseFloat(e.target.value) || 5)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Pressure Angle (°)
                            </label>
                            <input
                                type="number"
                                min="14.5"
                                max="25"
                                step="0.5"
                                value={pressureAngle}
                                onChange={(e) => setPressureAngle(parseFloat(e.target.value) || 20)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                    </>
                );
                
            case ToolType.POLYGON:
                return (
                    <>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Number of Sides
                            </label>
                            <input
                                type="number"
                                min="3"
                                max="100"
                                value={sides}
                                onChange={(e) => setSides(parseInt(e.target.value) || 6)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Rotation (°)
                            </label>
                            <input
                                type="number"
                                min="0"
                                max="360"
                                value={rotation}
                                onChange={(e) => setRotation(parseFloat(e.target.value) || 0)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                    </>
                );
                
            case ToolType.ELLIPSE:
                return (
                    <>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Radius X
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="1000"
                                value={radiusX}
                                onChange={(e) => setRadiusX(parseFloat(e.target.value) || 100)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Radius Y
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="1000"
                                value={radiusY}
                                onChange={(e) => setRadiusY(parseFloat(e.target.value) || 60)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Rotation (°)
                            </label>
                            <input
                                type="number"
                                min="0"
                                max="360"
                                value={ellipseRotation}
                                onChange={(e) => setEllipseRotation(parseFloat(e.target.value) || 0)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                    </>
                );
                
            case ToolType.SPIRAL:
                return (
                    <>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Number of Turns
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="20"
                                step="0.5"
                                value={turns}
                                onChange={(e) => setTurns(parseFloat(e.target.value) || 3)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Start Radius
                            </label>
                            <input
                                type="number"
                                min="0"
                                max="500"
                                value={startRadius}
                                onChange={(e) => setStartRadius(parseFloat(e.target.value) || 20)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Radius Increment per Turn
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="200"
                                value={radiusIncrement}
                                onChange={(e) => setRadiusIncrement(parseFloat(e.target.value) || 30)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                    </>
                );
                
            case ToolType.SPRING:
                return (
                    <>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Number of Coils
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="50"
                                value={coils}
                                onChange={(e) => setCoils(parseInt(e.target.value) || 8)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Spring Radius
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="200"
                                value={springRadius}
                                onChange={(e) => setSpringRadius(parseFloat(e.target.value) || 20)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                    </>
                );
                
            case ToolType.INVOLUTE:
                return (
                    <>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Base Radius
                            </label>
                            <input
                                type="number"
                                min="10"
                                max="500"
                                value={baseRadius}
                                onChange={(e) => setBaseRadius(parseFloat(e.target.value) || 50)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-cad-text mb-2">
                                Number of Turns
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="10"
                                step="0.5"
                                value={involuteTurns}
                                onChange={(e) => setInvoluteTurns(parseFloat(e.target.value) || 2)}
                                className="w-full px-3 py-2 bg-cad-bg border border-cad-border rounded text-cad-text focus:outline-none focus:ring-2 focus:ring-cad-primary"
                            />
                        </div>
                    </>
                );
                
            default:
                return null;
        }
    };

    const getTitle = () => {
        switch (tool) {
            case ToolType.GEAR:
                return 'Gear Parameters';
            case ToolType.POLYGON:
                return 'Polygon Parameters';
            case ToolType.ELLIPSE:
                return 'Ellipse Parameters';
            case ToolType.SPIRAL:
                return 'Spiral Parameters';
            case ToolType.SPRING:
                return 'Spring Parameters';
            case ToolType.INVOLUTE:
                return 'Involute Parameters';
            default:
                return 'Shape Parameters';
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-cad-panel border border-cad-border rounded-lg shadow-xl w-96 max-h-[80vh] overflow-y-auto">
                <div className="p-6">
                    <h2 className="text-xl font-bold text-cad-text mb-4">{getTitle()}</h2>
                    
                    {renderInputs()}
                    
                    <div className="flex gap-3 mt-6">
                        <button
                            onClick={handleConfirm}
                            className="flex-1 px-4 py-2 bg-cad-primary text-white rounded hover:bg-cad-primary/90 transition-colors font-medium"
                        >
                            Create
                        </button>
                        <button
                            onClick={onCancel}
                            className="flex-1 px-4 py-2 bg-cad-bg border border-cad-border text-cad-text rounded hover:bg-cad-text/10 transition-colors font-medium"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
