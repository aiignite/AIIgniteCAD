/**
 * dwg-converter — LibreDWG dwg2dxf sidecar
 *
 * 只接收 DWG 字节流并返回 ASCII DXF；不解析、不落库。转换器与业务后端
 * 隔离在独立容器里，既避免 GPL 代码链接进 Node 进程，也方便以后换成
 * ODA 实现而不用改后端。
 */

const http = require("node:http");
const { execFile } = require("node:child_process");
const { mkdtemp, writeFile, readFile, rm, stat } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const PORT = Number.parseInt(process.env.PORT ?? "3310", 10) || 3310;
const MAX_FILE_MB = Math.max(1, Number.parseInt(process.env.MAX_FILE_MB ?? "50", 10) || 50);
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const MAX_OUTPUT_MB = Math.max(1, Number.parseInt(process.env.MAX_OUTPUT_MB ?? "200", 10) || 200);
const MAX_OUTPUT_BYTES = MAX_OUTPUT_MB * 1024 * 1024;
const TIMEOUT_MS = Math.max(5_000, Number.parseInt(process.env.CONVERT_TIMEOUT_MS ?? "60000", 10) || 60_000);
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.CONVERT_CONCURRENCY ?? "2", 10) || 2);

let active = 0;
const waiters = [];

const acquire = async () => {
  if (active >= CONCURRENCY) {
    await new Promise((resolve) => waiters.push(resolve));
  }
  active += 1;
};

const release = () => {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** 读取完整请求体；超限时继续排空但不再缓存，避免把连接提前掐断 */
const readBody = (req) =>
  new Promise((resolve, reject) => {
    if (req.destroyed) {
      reject(httpError(400, "request aborted"));
      return;
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    let finished = false;

    req.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_FILE_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      finished = true;
      if (tooLarge) reject(httpError(413, "file too large"));
      else resolve(Buffer.concat(chunks));
    });
    req.on("aborted", () => {
      if (!finished) reject(httpError(400, "request aborted"));
    });
    req.on("error", reject);
  });

/** DWG 头固定为 AC10xx（R13–R2018），先拦掉明显不是 DWG 的请求 */
const isDwgBuffer = (buffer) =>
  buffer.length >= 6 && /^AC10\d\d$/.test(buffer.subarray(0, 6).toString("ascii"));

const convert = async (input) => {
  if (!isDwgBuffer(input)) throw httpError(400, "invalid dwg");

  const dir = await mkdtemp(join(tmpdir(), "dwg-"));
  try {
    const inputPath = join(dir, "input.dwg");
    const outputPath = join(dir, "output.dxf");
    await writeFile(inputPath, input);
    await execFileAsync("dwg2dxf", ["-y", "-o", outputPath, inputPath], {
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });

    const info = await stat(outputPath);
    if (info.size > MAX_OUTPUT_BYTES) throw httpError(413, "output too large");
    return await readFile(outputPath, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { status: "ok", engine: "libredwg" });
    return;
  }
  if (req.method !== "POST" || req.url !== "/convert") {
    sendJson(res, 404, { error: "NOT_FOUND" });
    return;
  }

  await acquire();
  try {
    // 排队期间客户端可能已经断开，避免继续占用转换名额
    if (req.destroyed) return;
    const body = await readBody(req);
    const dxf = await convert(body);
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": Buffer.byteLength(dxf),
    });
    res.end(dxf);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 422;
    const message =
      status === 413 ? "file too large" : status === 400 ? "invalid dwg" : "conversion failed";
    if (status === 422) {
      console.error("[dwg-converter] conversion failed:", error?.message ?? error);
    }
    sendJson(res, status, { error: message });
  } finally {
    release();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[dwg-converter] listening on :${PORT} (max ${MAX_FILE_MB}MB, concurrency ${CONCURRENCY})`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
