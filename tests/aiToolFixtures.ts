import { AIActionResponse, AIToolCall, CADElement } from "../types";
import type { BlockCatalogEntry } from "../lib/blockCatalog";

/** 评测用固定画布，保证 fixture 结果可复现 */
export const FIXTURE_ELEMENTS: CADElement[] = [
    {
        id: "line-1",
        type: "LINE",
        start: { x: 100, y: 100 },
        end: { x: 300, y: 100 },
        layer: "0",
        color: "#e6edf3",
    },
    {
        id: "circle-1",
        type: "CIRCLE",
        center: { x: 400, y: 300 },
        radius: 50,
        layer: "0",
        color: "#e6edf3",
    },
    {
        id: "text-1",
        type: "TEXT",
        start: { x: 50, y: 50 },
        text: "A",
        fontSize: 12,
        layer: "0",
        color: "#e6edf3",
    },
];

/** 评测用固定选择集：省略 ids 的目标工具只能落到它，不再回退到全部图元 */
export const FIXTURE_SELECTION = ["line-1", "text-1"];

/** 评测用固定块库：一个 200×100 的门洞符号，基准点取原点 */
export const FIXTURE_BLOCK_CATALOG: BlockCatalogEntry[] = [
    {
        id: "block-door",
        name: "标准门洞",
        description: "200×100 双线门洞符号",
        category: "建筑符号",
        elementCount: 2,
        width: 200,
        height: 100,
        basePoint: { x: 0, y: 0 },
        elements: [
            {
                id: "door-rect",
                type: "RECTANGLE",
                start: { x: 0, y: 0 },
                width: 200,
                height: 100,
                layer: "DOOR",
                color: "#e6edf3",
            },
            {
                id: "door-line",
                type: "LINE",
                start: { x: 0, y: 50 },
                end: { x: 200, y: 50 },
                layer: "DOOR",
                color: "#e6edf3",
            },
        ],
    },
];

export interface ToolFixtureExpectation {
    operation: NonNullable<AIActionResponse["operation"]>;
    elementTypes?: CADElement["type"][];
    targetIds?: string[];
    /** 只校验列出的参数键 */
    params?: Record<string, unknown>;
    /** 只读工具由 Agent 循环直接计算结果，不产生画布动作 */
    nullAction?: boolean;
}

export interface ToolFixture {
    id: string;
    /** 真实用户指令，用于评测报告可读性 */
    instruction: string;
    /** 被测模型在确定性录制中的工具调用输出 */
    call: AIToolCall;
    expectation: ToolFixtureExpectation;
    /** 块工具的执行依赖目录；缺省使用固定块库 */
    blockCatalog?: BlockCatalogEntry[];
}

const call = (
    name: string,
    args: Record<string, unknown>,
    index = 0,
): AIToolCall => ({
    id: `fixture-${name}-${index}`,
    name,
    arguments: args,
});

export const TOOL_FIXTURES: ToolFixture[] = [
    // draw_line
    {
        id: "line-basic",
        instruction: "Draw a line from (100, 100) to (300, 100)",
        call: call("draw_line", { x1: 100, y1: 100, x2: 300, y2: 100 }),
        expectation: { operation: "ADD", elementTypes: ["LINE"] },
    },
    {
        id: "line-negative",
        instruction: "Draw a line from (-50, -20) to (40, 10)",
        call: call("draw_line", { x1: -50, y1: -20, x2: 40, y2: 10 }),
        expectation: { operation: "ADD", elementTypes: ["LINE"] },
    },
    {
        id: "line-vertical",
        instruction: "Draw a vertical line at x=250 from y=80 to y=480",
        call: call("draw_line", { x1: 250, y1: 80, x2: 250, y2: 480 }),
        expectation: { operation: "ADD", elementTypes: ["LINE"] },
    },
    {
        id: "line-numeric-strings",
        instruction: "Connect point 10,20 with point 30,40",
        call: call("draw_line", { x1: "10", y1: "20", x2: "30", y2: "40" }),
        expectation: { operation: "ADD", elementTypes: ["LINE"] },
    },

    // draw_polyline
    {
        id: "polyline-three-points",
        instruction: "Draw a polyline through (100,100), (200,150), (300,100)",
        call: call("draw_polyline", {
            points: [{ x: 100, y: 100 }, { x: 200, y: 150 }, { x: 300, y: 100 }],
        }),
        expectation: { operation: "ADD", elementTypes: ["LWPOLYLINE"] },
    },
    {
        id: "polyline-closed",
        instruction: "Draw a closed triangle outline at (100,100), (200,100), (150,180)",
        call: call("draw_polyline", {
            points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 180 }],
            closed: true,
        }),
        expectation: { operation: "ADD", elementTypes: ["LWPOLYLINE"] },
    },
    {
        id: "polyline-array-points",
        instruction: "Draw a zigzag line through four points",
        call: call("draw_polyline", {
            points: [[0, 0], [50, 30], [100, 0], [150, 30]],
        }),
        expectation: { operation: "ADD", elementTypes: ["LWPOLYLINE"] },
    },

    // draw_rectangle
    {
        id: "rect-basic",
        instruction: "Draw a 200x120 rectangle with top-left corner at (50, 60)",
        call: call("draw_rectangle", { x: 50, y: 60, width: 200, height: 120 }),
        expectation: { operation: "ADD", elementTypes: ["RECTANGLE"] },
    },
    {
        id: "rect-decimal",
        instruction: "Draw a 12.5 by 8.5 rectangle at (10, 20)",
        call: call("draw_rectangle", { x: 10, y: 20, width: 12.5, height: 8.5 }),
        expectation: { operation: "ADD", elementTypes: ["RECTANGLE"] },
    },
    {
        id: "rect-large",
        instruction: "Draw a 760x560 border rectangle starting at (20, 20)",
        call: call("draw_rectangle", { x: 20, y: 20, width: 760, height: 560 }),
        expectation: { operation: "ADD", elementTypes: ["RECTANGLE"] },
    },

    // draw_circle
    {
        id: "circle-basic",
        instruction: "Draw a circle centered at (400, 300) with radius 50",
        call: call("draw_circle", { cx: 400, cy: 300, radius: 50 }),
        expectation: { operation: "ADD", elementTypes: ["CIRCLE"] },
    },
    {
        id: "circle-decimal",
        instruction: "Draw a small circle at (120.5, 80.5) radius 7.5",
        call: call("draw_circle", { cx: 120.5, cy: 80.5, radius: 7.5 }),
        expectation: { operation: "ADD", elementTypes: ["CIRCLE"] },
    },
    {
        id: "circle-large",
        instruction: "Draw a large circle at the canvas center radius 280",
        call: call("draw_circle", { cx: 400, cy: 300, radius: 280 }),
        expectation: { operation: "ADD", elementTypes: ["CIRCLE"] },
    },

    // draw_text
    {
        id: "text-basic",
        instruction: "Write 'Living Room' at (100, 80)",
        call: call("draw_text", { x: 100, y: 80, text: "Living Room" }),
        expectation: { operation: "ADD", elementTypes: ["TEXT"] },
    },
    {
        id: "text-size",
        instruction: "Add a title 'FLOOR PLAN' at (40, 40) with font size 24",
        call: call("draw_text", { x: 40, y: 40, text: "FLOOR PLAN", fontSize: 24 }),
        expectation: { operation: "ADD", elementTypes: ["TEXT"] },
    },
    {
        id: "text-unicode",
        instruction: "在 (200, 200) 标注“客厅”",
        call: call("draw_text", { x: 200, y: 200, text: "客厅" }),
        expectation: { operation: "ADD", elementTypes: ["TEXT"] },
    },

    // clear / delete
    {
        id: "clear-canvas",
        instruction: "Clear the whole drawing",
        call: call("clear_canvas", {}),
        expectation: { operation: "CLEAR" },
    },
    {
        id: "delete-last",
        instruction: "Remove the last thing I drew",
        call: call("delete_last", {}),
        expectation: { operation: "DELETE_LAST" },
    },

    // move
    {
        id: "move-by-id",
        instruction: "Move the first line 40 units right and 25 down",
        call: call("move_elements", { ids: ["line-1"], dx: 40, dy: 25 }),
        expectation: { operation: "MOVE", targetIds: ["line-1"], params: { dx: 40, dy: 25 } },
    },
    {
        id: "move-selection",
        instruction: "Move the selected objects 10 units left",
        call: call("move_elements", { dx: -10, dy: 0 }),
        expectation: {
            operation: "MOVE",
            targetIds: FIXTURE_SELECTION,
            params: { dx: -10, dy: 0 },
        },
    },
    {
        id: "move-multiple",
        instruction: "Move the line and the circle up by 60",
        call: call("move_elements", { ids: ["line-1", "circle-1"], dx: 0, dy: -60 }),
        expectation: {
            operation: "MOVE",
            targetIds: ["line-1", "circle-1"],
            params: { dx: 0, dy: -60 },
        },
    },

    // rotate
    {
        id: "rotate-by-id",
        instruction: "Rotate the selected circle 45 degrees",
        call: call("rotate_elements", { ids: ["circle-1"], angle: 45 }),
        expectation: { operation: "ROTATE", targetIds: ["circle-1"], params: { angle: 45 } },
    },
    {
        id: "rotate-center",
        instruction: "Rotate the line 90 degrees around (400, 300)",
        call: call("rotate_elements", {
            ids: ["line-1"],
            angle: 90,
            center: { x: 400, y: 300 },
        }),
        expectation: {
            operation: "ROTATE",
            targetIds: ["line-1"],
            params: { angle: 90, center: { x: 400, y: 300 } },
        },
    },
    {
        id: "rotate-selection-negative",
        instruction: "Rotate the selection -30 degrees",
        call: call("rotate_elements", { angle: -30 }),
        expectation: {
            operation: "ROTATE",
            targetIds: FIXTURE_SELECTION,
            params: { angle: -30 },
        },
    },

    // copy
    {
        id: "copy-by-id",
        instruction: "Copy the circle 100 units to the right",
        call: call("copy_elements", { ids: ["circle-1"], dx: 100, dy: 0 }),
        expectation: { operation: "COPY", targetIds: ["circle-1"], params: { dx: 100, dy: 0 } },
    },
    {
        id: "copy-selection",
        instruction: "Duplicate the selection 20 units down and 20 right",
        call: call("copy_elements", { dx: 20, dy: 20 }),
        expectation: {
            operation: "COPY",
            targetIds: FIXTURE_SELECTION,
            params: { dx: 20, dy: 20 },
        },
    },
    {
        id: "copy-multiple",
        instruction: "Copy the line and the text 15 units left",
        call: call("copy_elements", { ids: ["line-1", "text-1"], dx: -15, dy: 0 }),
        expectation: {
            operation: "COPY",
            targetIds: ["line-1", "text-1"],
            params: { dx: -15, dy: 0 },
        },
    },

    // mirror
    {
        id: "mirror-line",
        instruction: "Mirror the line across the vertical line x=400",
        call: call("mirror_elements", {
            ids: ["line-1"],
            p1: { x: 400, y: 0 },
            p2: { x: 400, y: 600 },
        }),
        expectation: {
            operation: "MIRROR",
            targetIds: ["line-1"],
            params: { p1: { x: 400, y: 0 }, p2: { x: 400, y: 600 } },
        },
    },
    {
        id: "mirror-circle",
        instruction: "Mirror the circle across the horizontal axis y=300",
        call: call("mirror_elements", {
            ids: ["circle-1"],
            p1: { x: 0, y: 300 },
            p2: { x: 800, y: 300 },
        }),
        expectation: {
            operation: "MIRROR",
            targetIds: ["circle-1"],
            params: { p1: { x: 0, y: 300 }, p2: { x: 800, y: 300 } },
        },
    },
    {
        id: "mirror-diagonal",
        instruction: "Mirror the text across the diagonal from (0,0) to (800,600)",
        call: call("mirror_elements", {
            ids: ["text-1"],
            p1: { x: 0, y: 0 },
            p2: { x: 800, y: 600 },
        }),
        expectation: {
            operation: "MIRROR",
            targetIds: ["text-1"],
            params: { p1: { x: 0, y: 0 }, p2: { x: 800, y: 600 } },
        },
    },

    // draw_arc
    {
        id: "arc-quarter",
        instruction: "Draw a quarter arc radius 100 at (300, 300) from 0 to 90 degrees",
        call: call("draw_arc", { cx: 300, cy: 300, radius: 100, startAngle: 0, endAngle: 90 }),
        expectation: { operation: "ADD", elementTypes: ["ARC"] },
    },
    {
        id: "arc-reflex",
        instruction: "Draw a 270 degree fillet arc radius 25 at (120, 80)",
        call: call("draw_arc", { cx: 120, cy: 80, radius: 25, startAngle: 30, endAngle: 300 }),
        expectation: { operation: "ADD", elementTypes: ["ARC"] },
    },

    // draw_dimension
    {
        id: "dimension-horizontal",
        instruction: "Dimension the wall from (100, 100) to (500, 100)",
        call: call("draw_dimension", { x1: 100, y1: 100, x2: 500, y2: 100 }),
        expectation: { operation: "ADD", elementTypes: ["DIMENSION"] },
    },
    {
        id: "dimension-offset",
        instruction: "Dimension (0, 0) to (0, 240) with the text 60 units away",
        call: call("draw_dimension", { x1: 0, y1: 0, x2: 0, y2: 240, textOffset: 60 }),
        expectation: { operation: "ADD", elementTypes: ["DIMENSION"] },
    },

    // scale / offset / array
    {
        id: "scale-by-id",
        instruction: "Scale the circle by 1.5 around its center",
        call: call("scale_elements", {
            ids: ["circle-1"],
            factor: 1.5,
            center: { x: 400, y: 300 },
        }),
        expectation: {
            operation: "SCALE",
            targetIds: ["circle-1"],
            params: { factor: 1.5, center: { x: 400, y: 300 } },
        },
    },
    {
        id: "scale-selection",
        instruction: "Double the size of the selection",
        call: call("scale_elements", { factor: 2 }),
        expectation: { operation: "SCALE", targetIds: FIXTURE_SELECTION, params: { factor: 2 } },
    },
    {
        id: "offset-rectangle",
        instruction: "Offset the line 20 units outward",
        call: call("offset_elements", { ids: ["line-1"], distance: 20 }),
        expectation: { operation: "OFFSET", targetIds: ["line-1"], params: { distance: 20 } },
    },
    {
        id: "array-rectangular",
        instruction: "Array the circle 2 rows by 3 columns with 80 units spacing",
        call: call("array_elements", {
            ids: ["circle-1"],
            rows: 2,
            columns: 3,
            rowSpacing: 80,
            columnSpacing: 80,
        }),
        expectation: {
            operation: "ARRAY",
            targetIds: ["circle-1"],
            params: { rows: 2, columns: 3, rowSpacing: 80, columnSpacing: 80 },
        },
    },

    // align / distribute / dimension chain / layer / delete
    {
        id: "align-left",
        instruction: "把这三条线左对齐",
        call: call("align_elements", {
            ids: ["line-1", "circle-1", "text-1"],
            mode: "left",
        }),
        expectation: {
            operation: "ALIGN",
            targetIds: ["line-1", "circle-1", "text-1"],
            params: { mode: "left" },
        },
    },
    {
        id: "distribute-horizontal",
        instruction: "把这三个图元水平等距分布",
        call: call("distribute_elements", {
            ids: ["line-1", "circle-1", "text-1"],
            axis: "horizontal",
        }),
        expectation: {
            operation: "DISTRIBUTE",
            targetIds: ["line-1", "circle-1", "text-1"],
            params: { axis: "horizontal" },
        },
    },
    {
        id: "dimension-chain",
        instruction: "给这三个孔位加连续标注",
        call: call("dimension_chain", {
            points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 250, y: 0 },
            ],
            textOffset: 30,
        }),
        expectation: {
            operation: "ADD",
            elementTypes: ["DIMENSION", "DIMENSION"],
        },
    },
    {
        id: "assign-layer",
        instruction: "把这条线放到 WALLS 图层",
        call: call("assign_layer", { ids: ["line-1"], layer: "WALLS" }),
        expectation: {
            operation: "SET_LAYER",
            targetIds: ["line-1"],
            params: { layer: "WALLS" },
        },
    },
    {
        id: "delete-elements",
        instruction: "删掉这条线和这个圆",
        call: call("delete_elements", { ids: ["line-1", "circle-1"] }),
        expectation: {
            operation: "DELETE",
            targetIds: ["line-1", "circle-1"],
        },
    },

    // get_canvas_info
    {
        id: "canvas-info",
        instruction: "What is on the canvas right now?",
        call: call("get_canvas_info", {}),
        expectation: { operation: "NONE", nullAction: true },
    },

    // zoom_to_selection
    {
        id: "zoom-to-selection",
        instruction: "Zoom in on what I have selected",
        call: call("zoom_to_selection", {}),
        expectation: { operation: "NONE", nullAction: true },
    },
    {
        id: "zoom-to-ids",
        instruction: "Zoom to the circle",
        call: call("zoom_to_selection", { ids: ["circle-1"] }),
        expectation: { operation: "NONE", nullAction: true },
    },

    // read-only design tools
    {
        id: "query-elements-layer",
        instruction: "哪些线在 0 图层上？",
        call: call("query_elements", { types: ["LINE"], layers: ["0"], limit: 10 }),
        expectation: { operation: "NONE", nullAction: true },
    },
    {
        id: "measure-distance",
        instruction: "圆心到文字起点有多远？",
        call: call("measure_geometry", {
            kind: "distance",
            ids: ["circle-1", "text-1"],
        }),
        expectation: { operation: "NONE", nullAction: true },
    },
    {
        id: "check-drawing",
        instruction: "帮我检查这张图有没有明显问题",
        call: call("check_drawing", {}),
        expectation: { operation: "NONE", nullAction: true },
    },

    // block library
    {
        id: "list-blocks-keyword",
        instruction: "块库里有哪些门洞符号？",
        call: call("list_blocks", { keyword: "门", limit: 5 }),
        expectation: { operation: "NONE", nullAction: true },
    },
    {
        id: "insert-block-basic",
        instruction: "在 (500, 400) 插入一个标准门洞",
        call: call("insert_block", { blockId: "block-door", x: 500, y: 400 }),
        expectation: { operation: "ADD", elementTypes: ["RECTANGLE", "LINE"] },
        blockCatalog: FIXTURE_BLOCK_CATALOG,
    },
    {
        id: "insert-block-rotated-scaled",
        instruction: "把门洞放大两倍、旋转 90 度放到 (300, 200)",
        call: call("insert_block", {
            blockId: "block-door",
            x: 300,
            y: 200,
            scale: 2,
            rotation: 90,
        }),
        expectation: { operation: "ADD", elementTypes: ["LWPOLYLINE", "LINE"] },
        blockCatalog: FIXTURE_BLOCK_CATALOG,
    },
    {
        id: "insert-block-missing",
        instruction: "插入刚才那个不存在的块",
        call: call("insert_block", { blockId: "block-missing", x: 10, y: 10 }),
        expectation: { operation: "NONE", nullAction: true },
        blockCatalog: FIXTURE_BLOCK_CATALOG,
    },
];
