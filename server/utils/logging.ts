import type { Request } from "express";

/**
 * Get trace_id from request
 */
export function getTraceId(req: Request): string {
  return (req as any).traceId || 'unknown';
}

/**
 * Format log message with trace_id prefix
 */
export function logWithTrace(req: Request, level: string, message: string, ...args: any[]) {
  const traceId = getTraceId(req);
  const prefix = `[${level}] trace_id=${traceId}`;
  console.log(prefix, message, ...args);
}

/**
 * Log error with trace_id
 */
export function logError(req: Request, message: string, error?: any) {
  const traceId = getTraceId(req);
  if (error) {
    console.error(`[error] trace_id=${traceId}`, message, error.message || error);
  } else {
    console.error(`[error] trace_id=${traceId}`, message);
  }
}

/**
 * Log info with trace_id
 */
export function logInfo(req: Request, message: string, ...args: any[]) {
  const traceId = getTraceId(req);
  console.log(`[info] trace_id=${traceId}`, message, ...args);
}

/**
 * Log warning with trace_id
 */
export function logWarn(req: Request, message: string, ...args: any[]) {
  const traceId = getTraceId(req);
  console.warn(`[warn] trace_id=${traceId}`, message, ...args);
}
