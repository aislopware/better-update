import { Logger } from "effect";

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
