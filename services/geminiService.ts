import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AIActionResponse, CADElement } from "../types";

// Helper for ID generation if the AI doesn't provide one
const uid = () => Math.random().toString(36).substr(2, 9);

export const sendCADCommandToGemini = async (
    prompt: string, 
    currentElements: CADElement[]
): Promise<AIActionResponse> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        // Construct context about the current drawing
        const contextSummary = currentElements.length > 0 
            ? `Current drawing contains ${currentElements.length} elements. ` 
            : "Drawing is empty. ";

        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `You are an expert CAD assistant. 
            The user will ask you to draw shapes or plan layouts.
            ${contextSummary}
            
            Return a JSON response with:
            1. 'message': A short friendly confirmation.
            2. 'operation': 'ADD', 'CLEAR', 'DELETE_LAST', or 'NONE'.
            3. 'elements': An array of elements to add (if operation is ADD).
            
            Supported element types for 'elements':
            - LINE: needs start {x,y} and end {x,y}
            - LWPOLYLINE: needs points array [{x,y}, {x,y}, ...] for multi-point curves
            - RECTANGLE: needs start {x,y} (top-left), width, height
            - CIRCLE: needs center {x,y}, radius
            
            For LWPOLYLINE curves (sine waves, spirals, etc.):
            Use the mathematical formula to generate 50-100+ evenly spaced points.
            
            SINE WAVE FORMULA:
            y = centerY + amplitude * sin(2π * (x - startX) / wavelength)
            Where:
            - centerY = middle y coordinate (default 300)
            - amplitude = peak height from center (e.g., 100-150)
            - wavelength = horizontal distance for one complete cycle (e.g., 400-500)
            - startX = starting x coordinate
            
            Example sine wave (x from 50 to 750, y=300 center, 100 amplitude):
            - Points should start at (50, 300) 
            - Go DOWN first to (150, 200) at quarter wavelength
            - Back UP to center at (250, 300)
            - Go UP to (350, 400) at 3/4 wavelength
            - Back to center at (450, 300)
            - Pattern repeats for remaining points
            Generate 60+ points with even x spacing.
            
            Coordinate system: X increases right, Y increases down (screen coordinates). 
            Center of screen is roughly 400, 300.
            
            User Prompt: ${prompt}`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        message: { type: Type.STRING },
                        operation: { type: Type.STRING, enum: ["ADD", "CLEAR", "DELETE_LAST", "COPY", "MOVE", "ROTATE", "MIRROR", "NONE"] },
                        elements: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    type: { type: Type.STRING, enum: ["LINE", "LWPOLYLINE", "RECTANGLE", "CIRCLE"] },
                                    layer: { type: Type.STRING },
                                    start: { 
                                        type: Type.OBJECT,
                                        properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } }
                                    },
                                    end: { 
                                        type: Type.OBJECT,
                                        properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } }
                                    },
                                    points: {
                                        type: Type.ARRAY,
                                        items: {
                                            type: Type.OBJECT,
                                            properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } }
                                        }
                                    },
                                    center: { 
                                        type: Type.OBJECT,
                                        properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } }
                                    },
                                    width: { type: Type.NUMBER },
                                    height: { type: Type.NUMBER },
                                    radius: { type: Type.NUMBER }
                                }
                            }
                        }
                    }
                }
            }
        });

        const result = response.text;
        if (!result) throw new Error("No response from AI");

        const parsed: AIActionResponse = JSON.parse(result);
        
        // Post-process to ensure IDs exist
        if (parsed.elements) {
            parsed.elements = parsed.elements.map(el => ({
                ...el,
                id: uid(),
                color: '#137fec', // Default AI color
                layer: 'AI_GENERATED'
            }));
        }

        return parsed;

    } catch (error) {
        console.error("Gemini Error:", error);
        return {
            message: "I encountered an error processing that request.",
            operation: 'NONE'
        };
    }
};