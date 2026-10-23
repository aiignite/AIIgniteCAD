import { afterEach, describe, expect, it, vi } from "vitest";
import { apiService } from "../services/apiService";
import { isDwgFile, isDxfFile, parseDrawingFile } from "../services/drawingImport";

const DXF = [
    "0", "SECTION", "2", "ENTITIES",
    "0", "LINE", "8", "WALLS", "10", "0", "20", "0", "11", "10", "21", "0",
    "0", "ENDSEC", "0", "EOF",
].join("\n");

const fakeFile = (name: string, text: string) =>
    ({ name, text: async () => text }) as unknown as File;

describe("图纸导入", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("按扩展名识别 DWG / DXF", () => {
        expect(isDwgFile("plan.DWG")).toBe(true);
        expect(isDwgFile("plan.dwg")).toBe(true);
        expect(isDwgFile("plan.dxf")).toBe(false);
        expect(isDxfFile("plan.DXF")).toBe(true);
    });

    it("DXF 直接在本地解析", async () => {
        const elements = await parseDrawingFile(fakeFile("plan.dxf", DXF));
        expect(elements).toHaveLength(1);
        expect(elements[0].type).toBe("LINE");
    });

    it("DWG 先调用后端转换再复用 DXF 解析", async () => {
        const convert = vi
            .spyOn(apiService, "convertDwg")
            .mockResolvedValue({ dxf: DXF, bytes: 16 });

        const elements = await parseDrawingFile(fakeFile("plan.dwg", ""));

        expect(convert).toHaveBeenCalledTimes(1);
        expect(elements).toHaveLength(1);
        expect(elements[0].layer).toBe("WALLS");
    });

    it("拒绝其它扩展名", async () => {
        await expect(parseDrawingFile(fakeFile("plan.pdf", ""))).rejects.toThrow(/dxf.*dwg/i);
    });
});
