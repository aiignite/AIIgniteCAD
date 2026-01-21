/**
 * 命令执行引擎
 * 接收AI输出的结构化命令，调用本地CAD算法执行
 */

import { CADElement, Point } from '../../types';
import { CAD_ALGORITHM_REGISTRY, AlgorithmMetadata } from '../cadEngine/registry';
import * as Primitives from '../cadEngine/primitives';
import * as Geometry from '../cadEngine/geometry';
import * as AdvancedShapes from '../advancedShapesService';
import * as Transform from '../../lib/transform';

// 命令接口定义
export interface Command {
    action: string;
    params: Record<string, any>;
    resultId?: string;
    targetIds?: string[];
}

export interface AIResponse {
    commands: Command[];
    explanation: string;
}

export interface ExecutionResult {
    success: boolean;
    elements: CADElement[];
    measurements?: Record<string, any>;
    error?: string;
    results: Map<string, any>; // 存储中间结果
}

/**
 * 执行AI生成的命令序列
 */
export async function executeCommands(
    commands: Command[],
    currentElements: CADElement[]
): Promise<ExecutionResult> {
    const result: ExecutionResult = {
        success: true,
        elements: [],
        measurements: {},
        results: new Map()
    };
    
    try {
        for (const command of commands) {
            const commandResult = await executeCommand(command, currentElements, result.results);
            
            if (!commandResult.success) {
                result.success = false;
                result.error = commandResult.error;
                break;
            }
            
            // 收集生成的元素
            if (commandResult.elements && commandResult.elements.length > 0) {
                result.elements.push(...commandResult.elements);
            }
            
            // 收集测量数据
            if (commandResult.measurement) {
                Object.assign(result.measurements!, commandResult.measurement);
            }
            
            // 存储结果引用
            if (command.resultId && commandResult.elements && commandResult.elements.length > 0) {
                result.results.set(command.resultId, commandResult.elements);
            }
        }
    } catch (error) {
        result.success = false;
        result.error = error instanceof Error ? error.message : String(error);
    }
    
    return result;
}

/**
 * 执行单个命令
 */
async function executeCommand(
    command: Command,
    currentElements: CADElement[],
    results: Map<string, any>
): Promise<{
    success: boolean;
    elements?: CADElement[];
    measurement?: Record<string, any>;
    error?: string;
}> {
    // 验证命令
    const algorithm = CAD_ALGORITHM_REGISTRY[command.action];
    if (!algorithm) {
        return {
            success: false,
            error: `Unknown algorithm: ${command.action}`
        };
    }
    
    // 验证参数
    const validationError = validateParameters(command.params, algorithm);
    if (validationError) {
        return {
            success: false,
            error: validationError
        };
    }
    
    // 解析参数中的引用
    const resolvedParams = resolveParameters(command.params, currentElements, results);
    
    // 执行对应的算法
    try {
        switch (command.action) {
            // ========== 基础图元 ==========
            case 'DRAW_LINE':
                return {
                    success: true,
                    elements: [Primitives.drawLine(
                        resolvedParams.start,
                        resolvedParams.end,
                        resolvedParams.color,
                        resolvedParams.layer
                    )]
                };
            
            case 'DRAW_CIRCLE':
                return {
                    success: true,
                    elements: [Primitives.drawCircle(
                        resolvedParams.center,
                        resolvedParams.radius,
                        resolvedParams.color,
                        resolvedParams.layer
                    )]
                };
            
            case 'DRAW_RECTANGLE':
                return {
                    success: true,
                    elements: [Primitives.drawRectangle(
                        resolvedParams.corner,
                        resolvedParams.width,
                        resolvedParams.height,
                        resolvedParams.color,
                        resolvedParams.layer
                    )]
                };
            
            case 'DRAW_POLYGON':
                return {
                    success: true,
                    elements: [AdvancedShapes.generatePolygon(
                        resolvedParams.center,
                        resolvedParams.radius,
                        resolvedParams.sides,
                        resolvedParams.rotation || 0,
                        resolvedParams.color,
                        resolvedParams.layer
                    )]
                };
            
            // ========== 几何计算 ==========
            case 'FIND_INTERSECTION':
                const intersections = findIntersection(
                    resolvedParams.element1,
                    resolvedParams.element2
                );
                return {
                    success: true,
                    measurement: { intersections }
                };
            
            case 'MEASURE_DISTANCE':
                const distance = Geometry.distance(
                    resolvedParams.point1,
                    resolvedParams.point2
                );
                return {
                    success: true,
                    measurement: { distance }
                };
            
            // ========== 变换操作 ==========
            case 'MOVE_ELEMENTS':
                const movedElements = resolvedParams.elements.map((el: CADElement) => 
                    Transform.moveElement(el, { x: resolvedParams.dx, y: resolvedParams.dy })
                );
                return {
                    success: true,
                    elements: movedElements
                };
            
            case 'ROTATE_ELEMENTS':
                const rotatedElements = Transform.rotateElements(
                    resolvedParams.elements,
                    resolvedParams.center,
                    resolvedParams.angle
                ).map(el => ({ ...el, id: generateId() }));
                return {
                    success: true,
                    elements: rotatedElements
                };
            
            case 'MIRROR_ELEMENTS':
                const mirroredElements = Transform.mirrorElements(
                    resolvedParams.elements,
                    {
                        start: resolvedParams.axisStart,
                        end: resolvedParams.axisEnd
                    }
                ).map(el => ({ ...el, id: generateId() }));
                return {
                    success: true,
                    elements: mirroredElements
                };
            
            // ========== 高级操作 ==========
            case 'ARRAY_LINEAR':
                const linearArray: CADElement[] = [];
                const baseElement = resolvedParams.element;
                for (let i = 0; i < resolvedParams.count; i++) {
                    const cloned = Primitives.cloneElement(baseElement);
                    const moved = Transform.moveElement(
                        cloned,
                        { x: i * resolvedParams.dx, y: i * resolvedParams.dy }
                    );
                    linearArray.push(moved);
                }
                return {
                    success: true,
                    elements: linearArray
                };
            
            case 'ARRAY_CIRCULAR':
                const circularArray: CADElement[] = [];
                const element = resolvedParams.element;
                const center = resolvedParams.center;
                const count = resolvedParams.count;
                const angleStep = 360 / count;
                
                for (let i = 0; i < count; i++) {
                    const cloned = Primitives.cloneElement(element);
                    const rotated = Transform.rotateElements(
                        [cloned],
                        center,
                        i * angleStep
                    )[0];
                    circularArray.push(rotated);
                }
                return {
                    success: true,
                    elements: circularArray
                };
            
            case 'OFFSET_ELEMENT':
                // TODO: 实现偏移算法
                return {
                    success: false,
                    error: 'OFFSET_ELEMENT not yet implemented'
                };
            
            // ========== 测量分析 ==========
            case 'MEASURE_AREA':
                const area = calculateArea(resolvedParams.elements);
                return {
                    success: true,
                    measurement: { area }
                };
            
            case 'MEASURE_PERIMETER':
                const perimeter = calculatePerimeter(resolvedParams.elements);
                return {
                    success: true,
                    measurement: { perimeter }
                };
            
            default:
                return {
                    success: false,
                    error: `Algorithm ${command.action} not implemented yet`
                };
        }
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * 验证参数
 */
function validateParameters(
    params: Record<string, any>,
    algorithm: AlgorithmMetadata
): string | null {
    // 检查必需参数
    for (const param of algorithm.parameters) {
        if (param.required && !(param.name in params)) {
            return `Missing required parameter: ${param.name}`;
        }
    }
    
    // 检查参数类型和范围
    for (const [key, value] of Object.entries(params)) {
        const paramDef = algorithm.parameters.find(p => p.name === key);
        if (!paramDef) continue;
        
        if (paramDef.type === 'number') {
            if (typeof value !== 'number') {
                return `Parameter ${key} must be a number`;
            }
            if (paramDef.min !== undefined && value < paramDef.min) {
                return `Parameter ${key} must be >= ${paramDef.min}`;
            }
            if (paramDef.max !== undefined && value > paramDef.max) {
                return `Parameter ${key} must be <= ${paramDef.max}`;
            }
        }
    }
    
    return null;
}

/**
 * 解析参数中的引用
 */
function resolveParameters(
    params: Record<string, any>,
    currentElements: CADElement[],
    results: Map<string, any>
): Record<string, any> {
    const resolved: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string') {
            // 处理选中元素引用
            if (value === 'selected') {
                resolved[key] = currentElements.filter(el => el.selected);
            } else if (value.startsWith('selected[') && value.endsWith(']')) {
                const index = parseInt(value.slice(9, -1));
                const selected = currentElements.filter(el => el.selected);
                resolved[key] = selected[index];
            }
            // 处理结果引用
            else if (value.startsWith('result:')) {
                const resultId = value.slice(7);
                resolved[key] = results.get(resultId);
            }
            else {
                resolved[key] = value;
            }
        } else {
            resolved[key] = value;
        }
    }
    
    return resolved;
}

/**
 * 查找两个元素的交点
 */
function findIntersection(elem1: CADElement, elem2: CADElement): Point[] {
    if (elem1.type === 'LINE' && elem2.type === 'LINE') {
        if (elem1.start && elem1.end && elem2.start && elem2.end) {
            const intersection = Geometry.segmentIntersection(
                elem1.start, elem1.end,
                elem2.start, elem2.end
            );
            return intersection ? [intersection] : [];
        }
    }
    
    if (elem1.type === 'LINE' && elem2.type === 'CIRCLE') {
        if (elem1.start && elem1.end && elem2.center && elem2.radius) {
            return Geometry.lineCircleIntersection(
                elem1.start, elem1.end,
                elem2.center, elem2.radius
            );
        }
    }
    
    if (elem1.type === 'CIRCLE' && elem2.type === 'LINE') {
        return findIntersection(elem2, elem1);
    }
    
    if (elem1.type === 'CIRCLE' && elem2.type === 'CIRCLE') {
        if (elem1.center && elem1.radius && elem2.center && elem2.radius) {
            return Geometry.circleCircleIntersection(
                elem1.center, elem1.radius,
                elem2.center, elem2.radius
            );
        }
    }
    
    return [];
}

/**
 * 计算元素面积
 */
function calculateArea(elements: CADElement[]): number {
    let totalArea = 0;
    
    for (const elem of elements) {
        if (elem.type === 'CIRCLE' && elem.radius) {
            totalArea += Math.PI * elem.radius * elem.radius;
        } else if (elem.type === 'RECTANGLE' && elem.width && elem.height) {
            totalArea += Math.abs(elem.width * elem.height);
        } else if ((elem.type === 'LWPOLYLINE' || elem.type === 'GEAR') && elem.points) {
            totalArea += Geometry.polygonArea(elem.points);
        }
    }
    
    return totalArea;
}

/**
 * 计算元素周长
 */
function calculatePerimeter(elements: CADElement[]): number {
    let totalPerimeter = 0;
    
    for (const elem of elements) {
        if (elem.type === 'CIRCLE' && elem.radius) {
            totalPerimeter += 2 * Math.PI * elem.radius;
        } else if (elem.type === 'RECTANGLE' && elem.width && elem.height) {
            totalPerimeter += 2 * (Math.abs(elem.width) + Math.abs(elem.height));
        } else if (elem.type === 'LINE' && elem.start && elem.end) {
            totalPerimeter += Geometry.distance(elem.start, elem.end);
        } else if ((elem.type === 'LWPOLYLINE' || elem.type === 'GEAR') && elem.points) {
            totalPerimeter += Geometry.polygonPerimeter(elem.points);
        }
    }
    
    return totalPerimeter;
}

/**
 * 生成唯一ID
 */
function generateId(): string {
    return Math.random().toString(36).substr(2, 9);
}
