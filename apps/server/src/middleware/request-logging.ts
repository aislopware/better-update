import { HttpServerRequest } from "@effect/platform";
import { Effect, Logger } from "effect";

import type { HttpApp } from "@effect/platform";

/** Structured JSON logger layer for Effect runtime — replaces default text logger */
export const JsonLoggerLayer = Logger.json;

/** Structured JSON log for imperative shell (non-Effect) code */
export const structuredLog = (
  level: "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>,
): void => {
  const json = JSON.stringify({
    timestamp: new Date().toISOString(),
    logLevel: level.toUpperCase(),
    message,
    ...data,
  });
  if (level === "error") {
    // eslint-disable-next-line no-console -- structured log sink for Workers Logpush
    console.error(json);
  } else if (level === "warn") {
    // eslint-disable-next-line no-console -- structured log sink for Workers Logpush
    console.warn(json);
  } else {
    // eslint-disable-next-line no-console -- structured log sink for Workers Logpush
    console.log(json);
  }
};

/** Wrap a Workers fetch handler to emit a canonical JSON request log line */
export const withRequestLogging = async (
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> => {
  const startTime = Date.now();
  const url = new URL(request.url);
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const logAndReturn = (response: Response): Response => {
    structuredLog("info", "Request completed", {
      requestId,
      method: request.method,
      path: url.pathname,
      status: response.status,
      duration: Date.now() - startTime,
    });
    return response;
  };

  // eslint-disable-next-line functional/no-try-statements -- imperative shell error boundary
  try {
    return logAndReturn(await handler());
  } catch (error) {
    structuredLog("error", "Unhandled request error", {
      requestId,
      method: request.method,
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    });
    return logAndReturn(
      Response.json(
        { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" },
        { status: 500 },
      ),
    );
  }
};

/** Effect HttpApp middleware — annotates all nested Effect.log calls with request context */
export const requestAnnotationMiddleware = (httpApp: HttpApp.Default): HttpApp.Default =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const requestId = request.headers["x-request-id"] ?? crypto.randomUUID();

    return yield* httpApp.pipe(
      Effect.annotateLogs({
        requestId,
        method: request.method,
        url: request.url,
      }),
    );
  });
