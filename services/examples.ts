/**
 * examples.ts — 内置示例图纸
 *
 * DXF 源码位于 examples/，通过 Vite 的 ?raw 内联进构建产物，
 * 新用户无需准备文件即可一键打开。文件由 scripts/generate-examples.mjs 生成。
 */

import gearDxf from "../examples/gear.dxf?raw";
import springDxf from "../examples/spring.dxf?raw";
import floorPlanDxf from "../examples/floor-plan.dxf?raw";

export interface ExampleDrawing {
    id: string;
    name: string;
    description: string;
    icon: string;
    dxf: string;
}

export const EXAMPLE_DRAWINGS: ExampleDrawing[] = [
    {
        id: "gear",
        name: "齿轮",
        description: "20 齿外轮廓 + 中心孔与减重孔",
        icon: "settings",
        dxf: gearDxf,
    },
    {
        id: "spring",
        name: "压缩弹簧",
        description: "12 圈螺旋的二维投影",
        icon: "toys",
        dxf: springDxf,
    },
    {
        id: "floor-plan",
        name: "建筑平面",
        description: "两室户型：墙体、门窗与家具示意",
        icon: "architecture",
        dxf: floorPlanDxf,
    },
];

export function getExampleDrawing(id: string): ExampleDrawing | undefined {
    return EXAMPLE_DRAWINGS.find((example) => example.id === id);
}
