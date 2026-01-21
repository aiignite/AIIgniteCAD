/**
 * AI能力描述生成器
 * 自动生成给AI大模型的CAD引擎能力清单
 */

import { CAD_ALGORITHM_REGISTRY, AlgorithmMetadata, getAlgorithmsByCategory } from '../cadEngine/registry';

/**
 * 生成完整的能力清单Prompt
 */
export function generateCapabilitiesPrompt(): string {
    const categories = [
        'PRIMITIVES',
        'GEOMETRY',
        'TRANSFORM',
        'ADVANCED',
        'MEASUREMENT',
        'CONSTRAINT'
    ] as const;
    
    const sections = categories.map(category => {
        const algorithms = getAlgorithmsByCategory(category);
        if (algorithms.length === 0) return '';
        
        return generateCategorySection(category, algorithms);
    }).filter(Boolean);
    
    return `
# CAD引擎能力清单

你是一个专业的CAD助手，可以调用本地的CAD算法引擎来执行精确的几何计算和图形生成。

## 重要说明

1. **你的角色**：理解用户意图，提取参数，决定调用哪些算法
2. **算法职责**：执行精确的数学计算和图形生成
3. **输出格式**：必须返回JSON格式的结构化命令

## 可用算法分类

${sections.join('\n\n')}

## 输出格式要求

你必须返回以下JSON格式：

\`\`\`json
{
  "commands": [
    {
      "action": "算法ID",
      "params": {
        "参数名": "参数值"
      },
      "resultId": "可选的结果引用ID"
    }
  ],
  "explanation": "简短说明你的操作意图"
}
\`\`\`

## 示例对话

**用户**: "在画布中心画一个半径50的圆"

**你的回复**:
\`\`\`json
{
  "commands": [
    {
      "action": "DRAW_CIRCLE",
      "params": {
        "center": {"x": 400, "y": 300},
        "radius": 50
      }
    }
  ],
  "explanation": "在画布中心(400,300)创建半径50的圆"
}
\`\`\`

**用户**: "选中的两个矩形求并集"

**你的回复**:
\`\`\`json
{
  "commands": [
    {
      "action": "BOOLEAN_UNION",
      "params": {
        "shape1": "selected[0]",
        "shape2": "selected[1]"
      }
    }
  ],
  "explanation": "对选中的两个矩形执行布尔并运算"
}
\`\`\`

**用户**: "画一个圆，然后在圆上均匀分布8个点"

**你的回复**:
\`\`\`json
{
  "commands": [
    {
      "action": "DRAW_CIRCLE",
      "params": {
        "center": {"x": 400, "y": 300},
        "radius": 50
      },
      "resultId": "main_circle"
    },
    {
      "action": "ARRAY_CIRCULAR",
      "params": {
        "element": {
          "type": "CIRCLE",
          "radius": 5
        },
        "center": {"x": 400, "y": 300},
        "count": 8,
        "radius": 50
      }
    }
  ],
  "explanation": "创建主圆并在其周围均匀分布8个小圆"
}
\`\`\`

## 特殊参数说明

- **Point**: 坐标点对象，格式 \`{"x": 数值, "y": 数值}\`
- **selection**: 表示当前选中的元素，使用 \`"selected"\` 或 \`"selected[索引]"\`
- **resultId**: 用于引用之前命令生成的结果，格式 \`"result:resultId"\`

## 注意事项

1. 所有坐标系统以左上角为原点，X轴向右，Y轴向下
2. 角度单位为度（degree），0度为3点钟方向，逆时针为正
3. 画布默认大小为800x600，中心点约为(400, 300)
4. 如果用户没有指定位置，使用合理的默认值（如画布中心）
5. 如果操作需要多个步骤，按顺序生成多个命令
6. 只输出JSON，不要添加额外的解释文本
`;
}

/**
 * 生成单个分类的说明
 */
function generateCategorySection(
    category: AlgorithmMetadata['category'],
    algorithms: AlgorithmMetadata[]
): string {
    const categoryNames = {
        'PRIMITIVES': '基础图元绘制',
        'GEOMETRY': '几何计算',
        'TRANSFORM': '变换操作',
        'ADVANCED': '高级操作',
        'MEASUREMENT': '测量分析',
        'CONSTRAINT': '约束求解'
    };
    
    const categoryDesc = {
        'PRIMITIVES': '绘制基础图形元素',
        'GEOMETRY': '执行几何计算和分析',
        'TRANSFORM': '对现有元素进行变换',
        'ADVANCED': '执行复杂的CAD操作',
        'MEASUREMENT': '测量图形属性',
        'CONSTRAINT': '应用几何约束'
    };
    
    const algorithmsText = algorithms.map(alg => 
        generateAlgorithmDescription(alg)
    ).join('\n\n');
    
    return `### ${categoryNames[category]}

${categoryDesc[category]}

${algorithmsText}`;
}

/**
 * 生成单个算法的说明
 */
function generateAlgorithmDescription(algorithm: AlgorithmMetadata): string {
    const params = algorithm.parameters.map(param => {
        let paramDesc = `  - **${param.name}** (${param.type})`;
        if (param.required) paramDesc += ' [必需]';
        paramDesc += `: ${param.description}`;
        if (param.default !== undefined) paramDesc += ` (默认: ${JSON.stringify(param.default)})`;
        if (param.min !== undefined || param.max !== undefined) {
            const range = [];
            if (param.min !== undefined) range.push(`最小: ${param.min}`);
            if (param.max !== undefined) range.push(`最大: ${param.max}`);
            paramDesc += ` [${range.join(', ')}]`;
        }
        if (param.enum) paramDesc += ` [可选值: ${param.enum.join(', ')}]`;
        return paramDesc;
    }).join('\n');
    
    const examples = algorithm.examples.length > 0 
        ? `\n  示例: "${algorithm.examples[0].input}"`
        : '';
    
    return `#### ${algorithm.id} - ${algorithm.name}

${algorithm.description}

参数:
${params}

返回: ${algorithm.returns.description}${examples}`;
}

/**
 * 生成简化版能力清单（用于token限制场景）
 */
export function generateCompactCapabilitiesPrompt(): string {
    const algorithms = Object.values(CAD_ALGORITHM_REGISTRY);
    
    const algorithmsList = algorithms.map(alg => {
        const requiredParams = alg.parameters
            .filter(p => p.required)
            .map(p => `${p.name}: ${p.type}`)
            .join(', ');
        
        return `- **${alg.id}**: ${alg.description} (${requiredParams})`;
    }).join('\n');
    
    return `
# CAD算法快速参考

你可以调用以下算法。输出JSON格式：\`{"commands": [{"action": "算法ID", "params": {...}}], "explanation": "..."}\`

${algorithmsList}

画布大小: 800x600, 中心: (400, 300)
角度: 度数制, 0度=右方向
`;
}

/**
 * 生成算法参数的JSON Schema
 */
export function generateAlgorithmSchema(algorithmId: string): object | null {
    const algorithm = CAD_ALGORITHM_REGISTRY[algorithmId];
    if (!algorithm) return null;
    
    const properties: Record<string, any> = {};
    const required: string[] = [];
    
    for (const param of algorithm.parameters) {
        const schema: any = {
            description: param.description
        };
        
        switch (param.type) {
            case 'number':
                schema.type = 'number';
                if (param.min !== undefined) schema.minimum = param.min;
                if (param.max !== undefined) schema.maximum = param.max;
                break;
            case 'string':
                schema.type = 'string';
                if (param.enum) schema.enum = param.enum;
                break;
            case 'boolean':
                schema.type = 'boolean';
                break;
            case 'Point':
                schema.type = 'object';
                schema.properties = {
                    x: { type: 'number' },
                    y: { type: 'number' }
                };
                schema.required = ['x', 'y'];
                break;
            case 'Point[]':
                schema.type = 'array';
                schema.items = {
                    type: 'object',
                    properties: {
                        x: { type: 'number' },
                        y: { type: 'number' }
                    },
                    required: ['x', 'y']
                };
                break;
            default:
                schema.type = 'object';
        }
        
        if (param.default !== undefined) {
            schema.default = param.default;
        }
        
        properties[param.name] = schema;
        
        if (param.required) {
            required.push(param.name);
        }
    }
    
    return {
        type: 'object',
        properties,
        required,
        additionalProperties: false
    };
}

/**
 * 生成所有算法的Schema集合
 */
export function generateAllAlgorithmsSchema(): Record<string, object> {
    const schemas: Record<string, object> = {};
    
    for (const algorithmId of Object.keys(CAD_ALGORITHM_REGISTRY)) {
        const schema = generateAlgorithmSchema(algorithmId);
        if (schema) {
            schemas[algorithmId] = schema;
        }
    }
    
    return schemas;
}

/**
 * 生成响应格式Schema
 */
export function generateResponseSchema(): object {
    return {
        type: 'object',
        properties: {
            commands: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: Object.keys(CAD_ALGORITHM_REGISTRY)
                        },
                        params: {
                            type: 'object'
                        },
                        resultId: {
                            type: 'string'
                        }
                    },
                    required: ['action', 'params']
                }
            },
            explanation: {
                type: 'string',
                description: '操作说明'
            }
        },
        required: ['commands', 'explanation']
    };
}
