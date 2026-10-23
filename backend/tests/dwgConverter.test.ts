import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DwgConversionError,
  convertDwgToDxf,
  isDwgBuffer,
} from "../src/services/dwgConverter";

const DWG_HEADER = Buffer.from("AC1027\x00\x00\x00\x00binary", "binary");

describe("DWG 转换客户端", () => {
  const originalUrl = process.env.DWG_CONVERTER_URL;

  beforeEach(() => {
    process.env.DWG_CONVERTER_URL = "http://dwg-converter:3310";
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.DWG_CONVERTER_URL;
    else process.env.DWG_CONVERTER_URL = originalUrl;
    vi.unstubAllGlobals();
  });

  it("按 AC10xx 文件头识别 DWG", () => {
    expect(isDwgBuffer(DWG_HEADER)).toBe(true);
    expect(isDwgBuffer(Buffer.from("AC1032"))).toBe(true);
    expect(isDwgBuffer(Buffer.from("ACAD"))).toBe(false);
    expect(isDwgBuffer(Buffer.from("0\nSECTION"))).toBe(false);
    expect(isDwgBuffer(Buffer.alloc(0))).toBe(false);
  });

  it("把 DWG 字节流转发到 sidecar 并返回 DXF 文本", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF"));
    vi.stubGlobal("fetch", fetchMock);

    const dxf = await convertDwgToDxf(DWG_HEADER);

    expect(dxf).toContain("ENTITIES");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://dwg-converter:3310/convert",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
  });

  it("非法文件头不会调用 sidecar", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(convertDwgToDxf(Buffer.from("not a dwg"))).rejects.toMatchObject({
      code: "INVALID_DWG",
      status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("未配置转换服务时返回 503", async () => {
    delete process.env.DWG_CONVERTER_URL;

    await expect(convertDwgToDxf(DWG_HEADER)).rejects.toMatchObject({
      code: "DWG_CONVERTER_UNAVAILABLE",
      status: 503,
    });
  });

  it("映射 sidecar 的 413 与 422", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("too large", { status: 413 })));
    await expect(convertDwgToDxf(DWG_HEADER)).rejects.toMatchObject({
      code: "DWG_TOO_LARGE",
      status: 413,
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad dwg", { status: 422 })));
    await expect(convertDwgToDxf(DWG_HEADER)).rejects.toMatchObject({
      code: "DWG_CONVERSION_FAILED",
      status: 422,
    });
  });

  it("网络失败与空结果都给出明确错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(convertDwgToDxf(DWG_HEADER)).rejects.toMatchObject({
      code: "DWG_CONVERTER_UNAVAILABLE",
      status: 503,
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("   ")));
    await expect(convertDwgToDxf(DWG_HEADER)).rejects.toBeInstanceOf(DwgConversionError);
  });
});
