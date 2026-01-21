/**
 * AI能力生成器 - 后端版本
 * 
 * 自动从算法注册表生成AI提示词，让LLM了解可用的CAD能力
 */

import { CAD_ALGORITHM_REGISTRY, AlgorithmMetadata, getAlgorithmsByCategory } from '../cadEngine/registry';

/**
 * 生成完整的CAD能力清单提示词
 * 包含所有算法的详细信息和示例
 */
export function generateCapabilitiesPrompt(): string {
    const categories = ['PRIMITIVES', 'GEOMETRY', 'TRANSFORM', 'MEASUREMENT', 'ADVANCED'] as const;
    
    let prompt = `# CAD Assistant System Capabilities

You are a professional CAD assistant with access to specialized geometric algorithms.
When users request CAD operations, you must output structured commands in JSON format.

## Output Format

You MUST respond with valid JSON in this exact format:

\`\`\`json
{
  "commands": [
    {
      "action": "ALGORITHM_ID",
      "params": { ... },
      "resultId": "optional_result_name"
    }
  ],
  "explanation": "Brief explanation of what you're doing"
}
\`\`\`

## Important Rules

1. **Always use valid algorithm IDs** from the list below
2. **Provide all required parameters** for each algorithm
3. **Use "selected" keyword** to reference user-selected elements
4. **Use "result:id" syntax** to reference previous command results
5. **Include explanation** to help users understand your actions

## Available Algorithms

`;

    // 按分类组织算法
    categories.forEach(category => {
        const algos = getAlgorithmsByCategory(category);
        if (algos.length === 0) return;
        
        prompt += `\n### ${category}\n\n`;
        
        algos.forEach((metadata: AlgorithmMetadata) => {
            prompt += formatAlgorithmForPrompt(metadata);
        });
    });

    prompt += `\n## Command Chaining Examples

### Example 1: Draw and Transform
\`\`\`json
{
  "commands": [
    {
      "action": "DRAW_CIRCLE",
      "params": { "center": {"x": 100, "y": 100}, "radius": 50 },
      "resultId": "my_circle"
    },
    {
      "action": "MOVE_ELEMENTS",
      "params": { "elements": "result:my_circle", "dx": 50, "dy": 0 }
    }
  ],
  "explanation": "Created a circle and moved it 50 units to the right"
}
\`\`\`

### Example 2: Measure Selected
\`\`\`json
{
  "commands": [
    {
      "action": "MEASURE_AREA",
      "params": { "element": "selected" }
    }
  ],
  "explanation": "Calculating the area of selected element"
}
\`\`\`

### Example 3: Array Pattern
\`\`\`json
{
  "commands": [
    {
      "action": "DRAW_CIRCLE",
      "params": { "center": {"x": 400, "y": 300}, "radius": 20 },
      "resultId": "base_circle"
    },
    {
      "action": "ARRAY_CIRCULAR",
      "params": {
        "element": "result:base_circle",
        "center": {"x": 400, "y": 300},
        "count": 8,
        "angle": 360
      }
    }
  ],
  "explanation": "Created a circular array of 8 circles"
}
\`\`\`

Now you're ready to assist with CAD operations!
`;

    return prompt;
}

/**
 * 生成紧凑版能力清单（节省tokens）
 * 只包含关键信息，适合频繁调用
 */
export function generateCompactCapabilitiesPrompt(): string {
    let prompt = `# CAD System Capabilities (Compact)

Output JSON format:
{
  "commands": [{"action": "ID", "params": {...}, "resultId": "optional"}],
  "explanation": "text"
}

## Algorithms:
`;

    Object.values(CAD_ALGORITHM_REGISTRY).forEach((algo: AlgorithmMetadata) => {
        const params = algo.parameters
            .map((p: any) => `${p.name}${p.required ? '*' : ''}:${p.type}`)
            .join(', ');
        prompt += `- ${algo.id}: ${algo.description} (${params})\n`;
    });

    prompt += `\nUse "selected" for user-selected elements, "result:id" for previous results.\n`;
    
    return prompt;
}

/**
 * 格式化单个算法的详细信息
 */
function formatAlgorithmForPrompt(algo: AlgorithmMetadata): string {
    let text = `#### ${algo.id}\n`;
    text += `**Description**: ${algo.description}\n\n`;
    
    // 参数列表
    if (algo.parameters.length > 0) {
        text += `**Parameters**:\n`;
        algo.parameters.forEach((param: any) => {
            const required = param.required ? ' (required)' : ' (optional)';
            const defaultVal = param.default !== undefined ? ` = ${param.default}` : '';
            text += `- \`${param.name}\` (${param.type}${defaultVal})${required}: ${param.description}\n`;
        });
        text += '\n';
    }
    
    // 返回值
    text += `**Returns**: ${algo.returns.description}\n\n`;
    
    // 示例
    if (algo.examples && algo.examples.length > 0) {
        text += `**Example**:\n\`\`\`json\n${JSON.stringify(algo.examples[0], null, 2)}\n\`\`\`\n\n`;
    }
    
    return text;
}

/**
 * 生成JSON Schema (用于支持结构化输出的LLM)
 */
export function generateAlgorithmSchema() {
    return {
        type: "object",
        properties: {
            commands: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        action: {
                            type: "string",
                            enum: Object.keys(CAD_ALGORITHM_REGISTRY)
                        },
                        params: {
                            type: "object"
                        },
                        resultId: {
                            type: "string"
                        }
                    },
                    required: ["action", "params"]
                }
            },
            explanation: {
                type: "string"
            }
        },
        required: ["commands", "explanation"]
    };
}
