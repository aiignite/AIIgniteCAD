/**
 * httpValidation.ts — express-validator 结果转统一 400 响应
 */

import { Request, Response } from "express";
import { validationResult } from "express-validator";

/** 存在校验错误时发送 400 并返回 true，调用方据此提前 return */
export function hasValidationError(req: Request, res: Response): boolean {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({
    error: "Validation Error",
    message: errors.array()[0].msg,
    code: "VALIDATION",
    requestId: req.requestId,
  });
  return true;
}
