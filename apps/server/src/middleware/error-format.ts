import { safeJsonParse } from "@better-update/safe-json";
import { HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";

import type { HttpApp } from "@effect/platform";

/** Convert PascalCase to UPPER_SNAKE_CASE: "OrgRequired" → "ORG_REQUIRED" */
export const pascalToUpperSnake = (str: string): string =>
  str.replaceAll(/([a-z0-9])([A-Z])/gu, "$1_$2").toUpperCase();

const isTaggedObject = (value: unknown): value is Record<string, unknown> & { _tag: string } =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  typeof value["_tag"] === "string";

const toUnifiedBody = (obj: Record<string, unknown>): Record<string, unknown> => {
  const tag = String(obj["_tag"]);
  const code = tag === "HttpApiDecodeError" ? "VALIDATION_ERROR" : pascalToUpperSnake(tag);
  const body: Record<string, unknown> = { code, message: obj["message"] ?? "An error occurred" };
  if (tag === "HttpApiDecodeError" && Array.isArray(obj["issues"])) {
    body["issues"] = obj["issues"];
  }
  return body;
};

/**
 * Rewrite a single error response from `{ _tag, message, ... }` to
 * `{ code, message }`. Returns the original response unchanged when
 * status < 400 or body is not a tagged Effect error.
 */
export const rewriteErrorResponse = (
  response: HttpServerResponse.HttpServerResponse,
): Effect.Effect<HttpServerResponse.HttpServerResponse> => {
  if (response.status < 400) {
    return Effect.succeed(response);
  }
  if (response.body._tag !== "Uint8Array") {
    return Effect.succeed(response);
  }

  const parsed = safeJsonParse(new TextDecoder().decode(response.body.body));
  if (!isTaggedObject(parsed)) {
    return Effect.succeed(response);
  }

  return HttpServerResponse.json(toUnifiedBody(parsed), { status: response.status }).pipe(
    Effect.orDie,
  );
};

/**
 * Middleware that rewrites Effect HttpApi error responses — matching the format
 * Better Auth already uses natively.
 */
export const errorFormatMiddleware = (httpApp: HttpApp.Default): HttpApp.Default =>
  httpApp.pipe(Effect.flatMap(rewriteErrorResponse));
