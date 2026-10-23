/**
 * imports.ts — 文件导入辅助接口
 *
 * 目前只有 DWG → DXF：前端把原始字节流 POST 上来，服务端交给 LibreDWG
 * sidecar 转换后返回 DXF 文本，解析与预览仍在前端复用现有 DXF 链路。
 */

import express, { ErrorRequestHandler, Router } from "express";
import { AuthRequest, authenticate } from "../middleware/auth";
import { importRateLimit } from "../middleware/rateLimit";
import { convertDwgToDxf, DwgConversionError } from "../services/dwgConverter";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";

const router = Router();

router.use(authenticate);

const maxFileMb = Math.max(
  1,
  Number.parseInt(process.env.DWG_MAX_FILE_MB ?? "50", 10) || 50,
);

router.post(
  "/dwg",
  importRateLimit(),
  express.raw({
    type: ["application/octet-stream", "application/acad", "application/x-acad"],
    limit: `${maxFileMb}mb`,
  }),
  async (req: AuthRequest, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({
        error: "INVALID_DWG",
        code: "INVALID_DWG",
        message: "请上传 DWG 文件内容",
        requestId: req.requestId,
      });
    }

    const startedAt = Date.now();
    try {
      const dxf = await convertDwgToDxf(req.body);
      const durationMs = Date.now() - startedAt;
      metrics.increment("dwg.convert_success");
      metrics.observe("dwg.convert_ms", durationMs);
      logger.info("DWG converted", {
        requestId: req.requestId,
        userId: req.user?.id,
        bytes: req.body.length,
        dxfBytes: Buffer.byteLength(dxf, "utf8"),
        durationMs,
      });
      res.json({ dxf, bytes: req.body.length });
    } catch (error) {
      metrics.increment("dwg.convert_failure");
      if (error instanceof DwgConversionError) {
        logger.warn("DWG conversion rejected", {
          requestId: req.requestId,
          userId: req.user?.id,
          code: error.code,
          status: error.status,
          bytes: req.body.length,
        });
        return res.status(error.status).json({
          error: error.code,
          code: error.code,
          message: error.message,
          requestId: req.requestId,
        });
      }
      logger.error("DWG conversion failed unexpectedly", {
        requestId: req.requestId,
        error,
      });
      res.status(500).json({
        error: "DWG_CONVERSION_FAILED",
        code: "DWG_CONVERSION_FAILED",
        message: "DWG 转换失败",
        requestId: req.requestId,
      });
    }
  },
);

/** body-parser 的体积超限需要转成 413，否则会落到全局 500 */
const rawBodyErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  const status = (err as { status?: number }).status;
  if (status === 413 || (err as { type?: string }).type === "entity.too.large") {
    res.status(413).json({
      error: "DWG_TOO_LARGE",
      code: "DWG_TOO_LARGE",
      message: `DWG 文件超过 ${maxFileMb} MB 上限`,
    });
    return;
  }
  next(err);
};

router.use(rawBodyErrorHandler);

export default router;
