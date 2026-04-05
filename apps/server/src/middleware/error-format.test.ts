import { HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";

import { pascalToUpperSnake, rewriteErrorResponse } from "./error-format";

// ── pascalToUpperSnake ────────────────────────────────────────────

describe(pascalToUpperSnake, () => {
  test.each([
    ["Unauthorized", "UNAUTHORIZED"],
    ["Forbidden", "FORBIDDEN"],
    ["NotFound", "NOT_FOUND"],
    ["OrgRequired", "ORG_REQUIRED"],
    ["Conflict", "CONFLICT"],
    ["HttpApiDecodeError", "HTTP_API_DECODE_ERROR"],
  ])("%s → %s", (input, expected) => {
    expect(pascalToUpperSnake(input)).toBe(expected);
  });
});

// ── helpers ───────────────────────────────────────────────────────

const run = async (response: HttpServerResponse.HttpServerResponse) =>
  Effect.runPromise(rewriteErrorResponse(response));

const parseBody = (response: HttpServerResponse.HttpServerResponse) => {
  if (response.body._tag !== "Uint8Array") {
    return null;
  }
  return JSON.parse(new TextDecoder().decode(response.body.body)) as Record<string, unknown>;
};

// ── rewriteErrorResponse ──────────────────────────────────────────

describe(rewriteErrorResponse, () => {
  test("passes through success responses untouched", async () => {
    const original = HttpServerResponse.unsafeJson({ data: "ok" }, { status: 200 });
    const result = await run(original);
    expect(result.status).toBe(200);
    expect(parseBody(result)).toEqual({ data: "ok" });
  });

  test("transforms TaggedError to { code, message }", async () => {
    const original = HttpServerResponse.unsafeJson(
      { _tag: "Unauthorized", message: "Invalid session" },
      { status: 401 },
    );
    const result = await run(original);
    expect(result.status).toBe(401);
    expect(parseBody(result)).toEqual({ code: "UNAUTHORIZED", message: "Invalid session" });
  });

  test("transforms multi-word PascalCase tag", async () => {
    const original = HttpServerResponse.unsafeJson(
      { _tag: "OrgRequired", message: "No active organization" },
      { status: 400 },
    );
    const result = await run(original);
    expect(parseBody(result)).toEqual({ code: "ORG_REQUIRED", message: "No active organization" });
  });

  test("transforms HttpApiDecodeError to VALIDATION_ERROR with issues", async () => {
    const issues = [{ _tag: "Missing", path: ["name"], message: "is required" }];
    const original = HttpServerResponse.unsafeJson(
      { _tag: "HttpApiDecodeError", message: "Validation failed", issues },
      { status: 400 },
    );
    const result = await run(original);
    expect(parseBody(result)).toEqual({
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      issues,
    });
  });

  test("passes through error responses without _tag", async () => {
    const original = HttpServerResponse.unsafeJson(
      { error: "something went wrong" },
      { status: 500 },
    );
    const result = await run(original);
    expect(parseBody(result)).toEqual({ error: "something went wrong" });
  });

  test("provides default message when missing", async () => {
    const original = HttpServerResponse.unsafeJson({ _tag: "NotFound" }, { status: 404 });
    const result = await run(original);
    expect(parseBody(result)).toEqual({ code: "NOT_FOUND", message: "An error occurred" });
  });
});
