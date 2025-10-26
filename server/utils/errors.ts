import type { Request, Response } from "express";
import { getTraceId } from "./logging.js";

/**
 * Standard error response format with trace_id
 */
export interface ErrorResponse {
  ok: false;
  error: string;
  code?: string;
  detail?: string;
  traceId: string;
}

/**
 * Send standardized error response with trace_id
 */
export function sendError(
  req: Request,
  res: Response,
  status: number,
  error: string,
  code?: string,
  detail?: string
): void {
  const traceId = getTraceId(req);
  res.status(status).json({
    ok: false,
    error,
    code,
    detail,
    traceId,
  } as ErrorResponse);
}

/**
 * Send 400 Bad Request with trace_id
 */
export function badRequest(req: Request, res: Response, error: string, code?: string, detail?: string) {
  sendError(req, res, 400, error, code, detail);
}

/**
 * Send 404 Not Found with trace_id
 */
export function notFound(req: Request, res: Response, error: string, code?: string) {
  sendError(req, res, 404, error, code);
}

/**
 * Send 409 Conflict with trace_id
 */
export function conflict(req: Request, res: Response, error: string, code?: string, detail?: string) {
  sendError(req, res, 409, error, code, detail);
}

/**
 * Send 500 Internal Server Error with trace_id
 */
export function internalError(req: Request, res: Response, error: string = "Internal server error", code?: string) {
  sendError(req, res, 500, error, code);
}
