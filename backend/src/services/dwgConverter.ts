/**
 * dwgConverter.ts — 调用 LibreDWG sidecar 把 DWG 转成 ASCII DXF
 *
 * 转换器是独立容器（见 dwg-converter/），后端只通过内网 HTTP 传字节流，
 * 不把 GPL 代码链接进 Node 进程。未配置 DWG_CONVERTER_URL 时该能力关闭，
 * 其余功能不受影响。
 */

export type DwgConversionErrorCode =
  | "INVALID_DWG"
  | "DWG_TOO_LARGE"
  | "DWG_CONVERTER_UNAVAILABLE"
  | "DWG_CONVERSION_FAILED";

export class DwgConversionError extends Error {
  readonly code: DwgConversionErrorCode;
  readonly status: number;

  constructor(code: DwgConversionErrorCode, message: string, status: number) {
    super(message);
    this.name = "DwgConversionError";
    this.code = code;
    this.status = status;
  }
}

const MAX_DXF_BYTES = Math.max(
  1,
  Number.parseInt(process.env.DWG_MAX_DXF_MB ?? "100", 10) || 100,
) * 1024 * 1024;

const converterUrl = (): string =>
  (process.env.DWG_CONVERTER_URL ?? "").trim().replace(/\/+$/, "");

const timeoutMs = (): number =>
  Math.max(5_000, Number.parseInt(process.env.DWG_CONVERT_TIMEOUT_MS ?? "60000", 10) || 60_000);

/** DWG 头固定为 AC10xx（R13–R2018） */
export const isDwgBuffer = (buffer: Buffer): boolean =>
  buffer.length >= 6 && /^AC10\d\d$/.test(buffer.subarray(0, 6).toString("ascii"));

export async function convertDwgToDxf(input: Buffer): Promise<string> {
  if (!isDwgBuffer(input)) {
    throw new DwgConversionError("INVALID_DWG", "文件不是有效的 DWG（缺少 AC10xx 文件头）", 400);
  }

  const baseUrl = converterUrl();
  if (!baseUrl) {
    throw new DwgConversionError(
      "DWG_CONVERTER_UNAVAILABLE",
      "服务端未配置 DWG 转换服务，请设置 DWG_CONVERTER_URL",
      503,
    );
  }

  let response: globalThis.Response;
  try {
    response = await fetch(`${baseUrl}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(input),
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new DwgConversionError(
      "DWG_CONVERTER_UNAVAILABLE",
      timedOut ? "DWG 转换超时，请稍后重试" : "无法连接 DWG 转换服务",
      503,
    );
  }

  if (!response.ok) {
    if (response.status === 413) {
      throw new DwgConversionError("DWG_TOO_LARGE", "DWG 文件或转换结果过大", 413);
    }
    throw new DwgConversionError("DWG_CONVERSION_FAILED", "DWG 转换失败", 422);
  }

  const dxf = await response.text();
  if (!dxf.trim()) {
    throw new DwgConversionError("DWG_CONVERSION_FAILED", "DWG 转换结果为空", 422);
  }
  if (Buffer.byteLength(dxf, "utf8") > MAX_DXF_BYTES) {
    throw new DwgConversionError("DWG_TOO_LARGE", "转换后的 DXF 超过大小上限", 413);
  }
  return dxf;
}
