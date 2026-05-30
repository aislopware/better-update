import { it } from "@effect/vitest";
import { Data, Effect } from "effect";

import { CliLive, makeCliLive } from "../app-layer";
import { runEffect, setActiveCliLayer } from "./citty-effect";
import { printHumanKeyValue, printHumanTable } from "./output";

class WidgetError extends Data.TaggedError("WidgetError")<{ readonly message: string }> {}

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.argv = ["node", "cli.js", "widgets", "view"];
  // --json + non-interactive: the boundary serializes envelopes to stdout.
  setActiveCliLayer(makeCliLive({ json: true, interactive: false }));
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  setActiveCliLayer(CliLive);
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
});

describe("runEffect return-value JSON path", () => {
  it("emits exactly one success envelope wrapping the returned value", async () => {
    await runEffect(Effect.succeed({ id: "w1", name: "Gizmo" }), { json: "value" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(parsed).toStrictEqual({
      schemaVersion: 1,
      ok: true,
      command: "widgets.view",
      data: { id: "w1", name: "Gizmo" },
    });
  });

  it("projects the returned value through a json mapper function", async () => {
    await runEffect(Effect.succeed({ id: "w1", secret: "x" }), {
      json: (value) => ({ id: value.id }),
    });
    const parsed = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as { data: unknown };
    expect(parsed.data).toStrictEqual({ id: "w1" });
  });

  it("emits exactly one error envelope (no spurious success) on unmapped failure + sets exit code", async () => {
    // No extras and not in BASE_TAG_MAP → catchAll fallback: tag "Unknown", code 1.
    await runEffect(Effect.fail(new WidgetError({ message: "boom" })), { json: "value" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
      ok: boolean;
      error: { code: number; tag: string; message: string };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatchObject({ code: 1, tag: "Unknown", message: "boom" });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("the canonical command shape emits EXACTLY ONE envelope (no divergence)", () => {
  // This is the by-construction unification every migrated command follows:
  // render the human view via the human-ONLY helpers (suppressed in JSON) and
  // RETURN the machine payload. In --json mode the boundary must emit one success
  // envelope — not one-per-helper and not a duplicate alongside the return value.
  it("a view command (human key/value + returned payload) emits one envelope", async () => {
    const program = Effect.gen(function* () {
      yield* printHumanKeyValue([
        ["ID", "w1"],
        ["Name", "Gizmo"],
      ]);
      return { id: "w1", name: "Gizmo" };
    });
    await runEffect(program, { json: "value" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toStrictEqual({
      schemaVersion: 1,
      ok: true,
      command: "widgets.view",
      data: { id: "w1", name: "Gizmo" },
    });
  });

  it("a list command (human table + richer returned payload) emits one envelope with the full payload", async () => {
    const program = Effect.gen(function* () {
      yield* printHumanTable(["ID"], [["w1"], ["w2"]]);
      return { items: [{ id: "w1" }, { id: "w2" }], total: 2, page: 1, limit: 20 };
    });
    await runEffect(program, { json: "value" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as { data: unknown };
    // The returned payload (with total/page/limit) wins — NOT the table's bare {items}.
    expect(parsed.data).toStrictEqual({
      items: [{ id: "w1" }, { id: "w2" }],
      total: 2,
      page: 1,
      limit: 20,
    });
  });
});

describe("runEffect backward-compat with a bare ExtraExitMap", () => {
  it("treats a legacy 2nd-arg map as exit codes and maps the tag", async () => {
    await runEffect(Effect.fail(new WidgetError({ message: "boom" })), { WidgetError: 7 });
    const parsed = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as { error: { code: number } };
    expect(parsed.error.code).toBe(7);
    expect(process.exitCode).toBe(7);
  });
});
