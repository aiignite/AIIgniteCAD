/**
 * tools.ts — CAD Function Calling 工具定义与流式拼装
 *
 * 工具名必须与前端 `lib/aiTools.ts` 的转换逻辑保持一致。
 * 本模块只包含纯数据与纯函数，便于单元测试。
 */

export interface ToolParameterSchema {
  type: "object" | "string" | "number" | "boolean" | "array";
  description?: string;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  items?: ToolParameterSchema;
  enum?: string[];
}

export interface CadToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

export interface ToolCallPayload {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

const pointProperties = {
  x: { type: "number" as const, description: "X coordinate (increases right)" },
  y: { type: "number" as const, description: "Y coordinate (increases down)" },
};

/** 未提供 ids 时，工具作用于当前选择集 */
const idsParameter: ToolParameterSchema = {
  type: "array",
  description: "Element ids to target. Omit to use the user's current selection.",
  items: { type: "string" },
};

/** 只读工具：不修改画布，只回报查询/测量/检查结果 */
export const READ_ONLY_TOOL_NAMES = [
  "get_canvas_info",
  "query_elements",
  "measure_geometry",
  "check_drawing",
  "list_blocks",
] as const;

/** 计划模式专用控制工具；不属于 CAD 画布工具 */
export const PLAN_TOOL_NAME = "propose_plan";
export const PROPOSE_VARIANTS_TOOL_NAME = "propose_variants";

export const PLAN_TOOL_DEFINITION: CadToolDefinition = {
  name: PLAN_TOOL_NAME,
  description:
    "Propose an executable plan instead of modifying the drawing directly. Include concrete tool names and arguments for every write step. The user reviews and may edit the plan before it runs.",
  parameters: {
    type: "object",
    properties: {
      goal: { type: "string", description: "One-sentence goal in the user's language" },
      assumptions: {
        type: "array",
        description: "Assumptions made because the request was underspecified",
        items: { type: "string" },
      },
      steps: {
        type: "array",
        description: "Ordered execution steps, 1-12 items",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short step title" },
            detail: { type: "string", description: "What this step does and why" },
            tool: {
              type: "string",
              description: "CAD tool name for this step; omit for informational steps",
            },
            arguments: {
              type: "object",
              description: "Concrete arguments for the tool, using real coordinates and ids",
            },
          },
          required: ["title"],
        },
      },
      checks: {
        type: "array",
        description: "Conditions to verify after execution",
        items: { type: "string" },
      },
      risks: {
        type: "array",
        description: "Risks or trade-offs the user should know about",
        items: { type: "string" },
      },
    },
    required: ["goal", "steps"],
  },
};

export const PROPOSE_VARIANTS_TOOL_DEFINITION: CadToolDefinition = {
  name: PROPOSE_VARIANTS_TOOL_NAME,
  description:
    "Propose 2-3 alternative design variants for user comparison. Each variant must contain concrete CAD tool calls and arguments. Do not modify the drawing in the same turn.",
  parameters: {
    type: "object",
    properties: {
      goal: { type: "string", description: "One-sentence design goal in the user's language" },
      variants: {
        type: "array",
        description: "2-3 alternatives, each with a name, trade-off summary and executable steps",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short variant name" },
            summary: { type: "string", description: "Key trade-off or difference from other variants" },
            steps: {
              type: "array",
              description: "Ordered execution steps, 1-12 items",
              items: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Short step title" },
                  detail: { type: "string", description: "What this step does" },
                  tool: {
                    type: "string",
                    description: "CAD tool name; omit for informational steps",
                  },
                  arguments: {
                    type: "object",
                    description: "Concrete arguments using real coordinates and ids",
                  },
                },
                required: ["title"],
              },
            },
          },
          required: ["name", "steps"],
        },
      },
    },
    required: ["goal", "variants"],
  },
};

export const CAD_TOOL_DEFINITIONS: CadToolDefinition[] = [
  {
    name: "draw_line",
    description: "Draw a straight line between two points on the 2D canvas.",
    parameters: {
      type: "object",
      properties: {
        x1: { type: "number", description: "Start X coordinate" },
        y1: { type: "number", description: "Start Y coordinate" },
        x2: { type: "number", description: "End X coordinate" },
        y2: { type: "number", description: "End Y coordinate" },
      },
      required: ["x1", "y1", "x2", "y2"],
    },
  },
  {
    name: "draw_polyline",
    description: "Draw a connected polyline through two or more points.",
    parameters: {
      type: "object",
      properties: {
        points: {
          type: "array",
          description: "Ordered vertices of the polyline",
          items: { type: "object", properties: pointProperties, required: ["x", "y"] },
        },
        closed: { type: "boolean", description: "Close the polyline back to its first point" },
      },
      required: ["points"],
    },
  },
  {
    name: "draw_rectangle",
    description: "Draw an axis-aligned rectangle. x/y is the top-left corner in canvas coordinates.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number", description: "Top-left X coordinate" },
        y: { type: "number", description: "Top-left Y coordinate" },
        width: { type: "number", description: "Rectangle width" },
        height: { type: "number", description: "Rectangle height" },
      },
      required: ["x", "y", "width", "height"],
    },
  },
  {
    name: "draw_circle",
    description: "Draw a circle by center and radius.",
    parameters: {
      type: "object",
      properties: {
        cx: { type: "number", description: "Center X coordinate" },
        cy: { type: "number", description: "Center Y coordinate" },
        radius: { type: "number", description: "Radius, must be greater than 0" },
      },
      required: ["cx", "cy", "radius"],
    },
  },
  {
    name: "draw_text",
    description: "Place a text label at a position on the canvas.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number", description: "Text anchor X coordinate" },
        y: { type: "number", description: "Text anchor Y coordinate" },
        text: { type: "string", description: "Text content" },
        fontSize: { type: "number", description: "Text height in drawing units, default 12" },
      },
      required: ["x", "y", "text"],
    },
  },
  {
    name: "clear_canvas",
    description: "Delete every element on the canvas. Use only when the user explicitly asks to clear everything.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "delete_last",
    description: "Delete the most recently added element.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "move_elements",
    description: "Move existing elements by a relative offset.",
    parameters: {
      type: "object",
      properties: {
        ids: idsParameter,
        dx: { type: "number", description: "Horizontal offset (positive = right)" },
        dy: { type: "number", description: "Vertical offset (positive = down)" },
      },
      required: ["dx", "dy"],
    },
  },
  {
    name: "rotate_elements",
    description: "Rotate existing elements around a center point. Positive angles rotate clockwise on screen.",
    parameters: {
      type: "object",
      properties: {
        ids: idsParameter,
        angle: { type: "number", description: "Rotation angle in degrees" },
        center: { type: "object", properties: pointProperties, description: "Rotation center; defaults to the elements' centroid" },
      },
      required: ["angle"],
    },
  },
  {
    name: "copy_elements",
    description: "Copy existing elements by a relative offset.",
    parameters: {
      type: "object",
      properties: {
        ids: idsParameter,
        dx: { type: "number", description: "Horizontal offset (positive = right)" },
        dy: { type: "number", description: "Vertical offset (positive = down)" },
      },
      required: ["dx", "dy"],
    },
  },
  {
    name: "mirror_elements",
    description: "Mirror existing elements across the line defined by two points.",
    parameters: {
      type: "object",
      properties: {
        ids: idsParameter,
        p1: { type: "object", properties: pointProperties, description: "First point of the mirror line" },
        p2: { type: "object", properties: pointProperties, description: "Second point of the mirror line" },
      },
      required: ["p1", "p2"],
    },
  },
  {
    name: "draw_arc",
    description: "Draw a circular arc. Angles are degrees measured from the +X axis, clockwise on screen.",
    parameters: {
      type: "object",
      properties: {
        cx: { type: "number", description: "Center X coordinate" },
        cy: { type: "number", description: "Center Y coordinate" },
        radius: { type: "number", description: "Radius, must be greater than 0" },
        startAngle: { type: "number", description: "Start angle in degrees" },
        endAngle: { type: "number", description: "End angle in degrees" },
      },
      required: ["cx", "cy", "radius", "startAngle", "endAngle"],
    },
  },
  {
    name: "draw_dimension",
    description: "Add a linear dimension between two measurement points.",
    parameters: {
      type: "object",
      properties: {
        x1: { type: "number", description: "First measurement point X" },
        y1: { type: "number", description: "First measurement point Y" },
        x2: { type: "number", description: "Second measurement point X" },
        y2: { type: "number", description: "Second measurement point Y" },
        textOffset: {
          type: "number",
          description: "Distance from the measurement line to the dimension line, default 40",
        },
      },
      required: ["x1", "y1", "x2", "y2"],
    },
  },
  {
    name: "scale_elements",
    description: "Scale existing elements uniformly around a center point.",
    parameters: {
      type: "object",
      properties: {
        ids: idsParameter,
        factor: { type: "number", description: "Scale factor; 2 doubles size, 0.5 halves it" },
        center: {
          type: "object",
          properties: pointProperties,
          description: "Scale anchor; defaults to the elements' centroid",
        },
      },
      required: ["factor"],
    },
  },
  {
    name: "offset_elements",
    description: "Create parallel copies of existing elements at a fixed distance.",
    parameters: {
      type: "object",
      properties: {
        ids: idsParameter,
        distance: { type: "number", description: "Offset distance; sign chooses the side" },
      },
      required: ["distance"],
    },
  },
  {
    name: "array_elements",
    description: "Create a rectangular array of existing elements.",
    parameters: {
      type: "object",
      properties: {
        ids: idsParameter,
        rows: { type: "number", description: "Number of rows, 1-50" },
        columns: { type: "number", description: "Number of columns, 1-50" },
        rowSpacing: { type: "number", description: "Distance between rows" },
        columnSpacing: { type: "number", description: "Distance between columns" },
      },
      required: ["rows", "columns", "rowSpacing", "columnSpacing"],
    },
  },
  {
    name: "align_elements",
    description:
      "Align two or more elements to the group's left/right/top/bottom edge or center. Read-only measurement is not needed; this changes positions only.",
    parameters: {
      type: "object",
      properties: {
        ids: idsParameter,
        mode: {
          type: "string",
          enum: ["left", "right", "top", "bottom", "centerX", "centerY"],
          description: "Alignment edge or center line",
        },
      },
      required: ["mode"],
    },
  },
  {
    name: "distribute_elements",
    description:
      "Distribute three or more elements so the gaps between their bounding boxes are equal. The first and last elements stay fixed.",
    parameters: {
      type: "object",
      properties: {
        ids: idsParameter,
        axis: {
          type: "string",
          enum: ["horizontal", "vertical"],
          description: "Axis along which gaps are equalized",
        },
      },
      required: ["axis"],
    },
  },
  {
    name: "dimension_chain",
    description:
      "Add consecutive linear dimensions between an ordered list of points. Use it for a run of wall segments or a sequence of holes.",
    parameters: {
      type: "object",
      properties: {
        points: {
          type: "array",
          description: "Ordered measurement points, 2-20 items",
          items: { type: "object", properties: pointProperties, required: ["x", "y"] },
        },
        textOffset: {
          type: "number",
          description: "Distance from the measurement line to the dimension line, default 40",
        },
      },
      required: ["points"],
    },
  },
  {
    name: "assign_layer",
    description: "Move existing elements to a named layer without changing their geometry.",
    parameters: {
      type: "object",
      properties: {
        ids: idsParameter,
        layer: { type: "string", description: "Target layer name, 1-64 characters" },
      },
      required: ["layer"],
    },
  },
  {
    name: "delete_elements",
    description:
      "Delete specific elements by id (or the current selection). Use only when the user explicitly asks to remove those elements.",
    parameters: {
      type: "object",
      properties: {
        ids: idsParameter,
      },
    },
  },
  {
    name: "get_canvas_info",
    description:
      "Read the current canvas: element counts by type, bounding box and the active selection. Read-only; use it to verify your own result before answering.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "zoom_to_selection",
    description:
      "Zoom the view to the given elements, or to the current selection when ids are omitted. Changes only the viewport, never the drawing.",
    parameters: {
      type: "object",
      properties: {
        ids: idsParameter,
      },
    },
  },
  {
    name: "query_elements",
    description:
      "Read-only: find elements by type, layer, text or bounding-box intersection. Returns ids with a short geometry summary. Use it before editing when you do not know the target ids.",
    parameters: {
      type: "object",
      properties: {
        types: {
          type: "array",
          description: "Element types to match, e.g. LINE, CIRCLE, TEXT. Empty means any type.",
          items: { type: "string" },
        },
        layers: {
          type: "array",
          description: "Layer names to match (case-insensitive). Empty means any layer.",
          items: { type: "string" },
        },
        bounds: {
          type: "object",
          description: "Keep elements whose bounding box intersects this rectangle.",
          properties: {
            minX: { type: "number", description: "Minimum X" },
            minY: { type: "number", description: "Minimum Y" },
            maxX: { type: "number", description: "Maximum X" },
            maxY: { type: "number", description: "Maximum Y" },
          },
          required: ["minX", "minY", "maxX", "maxY"],
        },
        text: {
          type: "string",
          description: "Substring matched against text content and element id.",
        },
        limit: { type: "number", description: "Maximum number of matches, 1-50, default 8" },
      },
    },
  },
  {
    name: "measure_geometry",
    description:
      "Read-only: measure distance, length, area or bounding box from the real drawing. Use it for any question about size or spacing instead of guessing from coordinates.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["distance", "length", "area", "bbox"],
          description:
            "distance = between two points or two elements; length = total curve length; area = enclosed area; bbox = overall extents",
        },
        ids: {
          type: "array",
          description: "Elements to measure. Empty uses the current selection, then the whole drawing.",
          items: { type: "string" },
        },
        p1: {
          type: "object",
          properties: pointProperties,
          description: "First point for kind=distance",
        },
        p2: {
          type: "object",
          properties: pointProperties,
          description: "Second point for kind=distance",
        },
      },
      required: ["kind"],
    },
  },
  {
    name: "check_drawing",
    description:
      "Read-only: run deterministic drawing checks (zero-length lines, invalid circles, degenerate rectangles, duplicates, near-closed contours, missing dimensions) and return a sorted issue list.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_blocks",
    description:
      "Read-only: list reusable blocks/symbols from the project and global block library. Returns block ids, names, categories, bounding size and element counts. Always call it before insert_block when you do not already have an exact blockId.",
    parameters: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "Substring matched against block name, category, description and id.",
        },
        limit: { type: "number", description: "Maximum number of blocks to return, 1-50, default 8" },
      },
    },
  },
  {
    name: "insert_block",
    description:
      "Insert a reusable block from the block library at the given insertion point. The block is expanded into its constituent elements, so it joins the normal preview and single-undo pipeline. Use list_blocks first to obtain a valid blockId.",
    parameters: {
      type: "object",
      properties: {
        blockId: {
          type: "string",
          description: "Block definition id returned by list_blocks.",
        },
        x: { type: "number", description: "Insertion point X (the block base point lands here)" },
        y: { type: "number", description: "Insertion point Y (the block base point lands here)" },
        scale: {
          type: "number",
          description: "Uniform scale factor, 0.01-100, default 1",
        },
        rotation: {
          type: "number",
          description: "Rotation in degrees around the insertion point, default 0",
        },
      },
      required: ["blockId", "x", "y"],
    },
  },
];

const ALL_DEFINITIONS = [
  ...CAD_TOOL_DEFINITIONS,
  PLAN_TOOL_DEFINITION,
  PROPOSE_VARIANTS_TOOL_DEFINITION,
];

/* ─── 工具集划分与计划速查表 ─────────────────────────────────── */

/** 视图类工具：只改视口，不改图纸 */
export const VIEW_TOOL_NAMES = ["zoom_to_selection"] as const;

/**
 * 计划与多方案步骤可以「引用」的写工具。
 * 引用不等于本轮可调用：写工具在计划模式下不进 allowedTools，
 * 用户在预览里确认计划后才真正执行，因此需要单独下发给提示词。
 */
export const WRITE_TOOL_NAMES: string[] = (() => {
  const excluded = new Set<string>([...READ_ONLY_TOOL_NAMES, ...VIEW_TOOL_NAMES]);
  return CAD_TOOL_DEFINITIONS.filter((tool) => !excluded.has(tool.name)).map((tool) => tool.name);
})();

/**
 * 由工具定义本身生成「工具名(必填参数, [可选参数]): 语义」速查表。
 * 顺序沿用 CAD_TOOL_DEFINITIONS，避免在提示词里手写第二份清单导致漂移。
 */
export function formatToolReference(names: readonly string[]): string {
  const wanted = new Set(names);
  return CAD_TOOL_DEFINITIONS.filter((tool) => wanted.has(tool.name))
    .map((tool) => {
      const required = tool.parameters.required ?? [];
      const optional = Object.keys(tool.parameters.properties ?? {}).filter(
        (key) => !required.includes(key),
      );
      const signature = [...required, ...optional.map((key) => `[${key}]`)].join(", ");
      return `- ${tool.name}(${signature}): ${tool.description}`;
    })
    .join("\n");
}

/* ─── Provider 格式转换 ─────────────────────────────────────── */

/** 按本轮允许的工具名裁剪定义，保持原有顺序 */
export function selectToolDefinitions(
  allowedNames: readonly string[] | null | undefined,
): CadToolDefinition[] {
  if (!allowedNames || allowedNames.length === 0) return [];
  const allowed = new Set(allowedNames);
  return ALL_DEFINITIONS.filter((tool) => allowed.has(tool.name));
}

export function toOpenAITools(definitions: CadToolDefinition[] = CAD_TOOL_DEFINITIONS) {
  return definitions.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function toAnthropicTools(definitions: CadToolDefinition[] = CAD_TOOL_DEFINITIONS) {
  return definitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

/** Gemini 的 FunctionDeclaration 使用大写 OpenAPI 类型 */
export function toGoogleSchema(schema: ToolParameterSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: schema.type.toUpperCase(),
  };
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.items) result.items = toGoogleSchema(schema.items);
  if (schema.properties) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, toGoogleSchema(value)]),
    );
  }
  if (schema.required) result.required = schema.required;
  return result;
}

export function toGoogleTools(definitions: CadToolDefinition[] = CAD_TOOL_DEFINITIONS) {
  return [
    {
      functionDeclarations: definitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: toGoogleSchema(tool.parameters),
      })),
    },
  ];
}

/** Ollama 使用与 OpenAI 相同的 tools 结构 */
export const toOllamaTools = toOpenAITools;

/* ─── 参数解析与流式拼装 ───────────────────────────────────── */

export function parseToolArguments(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

export interface ToolCallDraft {
  id?: string;
  name?: string;
  argumentsJson: string;
}

export type ToolCallDraftMap = Map<number, ToolCallDraft>;

export interface ToolCallDelta {
  index?: number;
  id?: string;
  name?: string;
  /** JSON 片段（OpenAI / Anthropic 流式增量） */
  arguments?: string;
}

export function applyToolCallDelta(accumulator: ToolCallDraftMap, delta: ToolCallDelta): void {
  const index = Number.isInteger(delta.index) && (delta.index as number) >= 0
    ? (delta.index as number)
    : 0;
  const draft = accumulator.get(index) ?? { argumentsJson: "" };
  if (delta.id && !draft.id) draft.id = delta.id;
  if (delta.name) draft.name = (draft.name ?? "") + delta.name;
  if (delta.arguments) draft.argumentsJson += delta.arguments;
  accumulator.set(index, draft);
}

export function finalizeToolCalls(accumulator: ToolCallDraftMap): ToolCallPayload[] {
  return [...accumulator.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([index, draft]) => {
      if (!draft.name) return [];
      const args = parseToolArguments(draft.argumentsJson || "{}");
      if (!args) return [];
      return [{
        id: draft.id || `call_${index}`,
        name: draft.name,
        arguments: args,
      }];
    });
}
