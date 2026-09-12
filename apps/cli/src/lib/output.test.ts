import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { CommandName } from "./command-output";
import { printJson, printKeyValue, printList, printTable } from "./output";
import { makeOutputModeLayer } from "./output-mode";

const captureStdout = async (effect: Effect.Effect<void>): Promise<string[]> => {
  const calls: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((value: unknown) => {
    calls.push(String(value));
  });
  try {
    await Effect.runPromise(effect);
  } finally {
    spy.mockRestore();
  }
  return calls;
};

// The envelope `command` field comes from the CommandName service, resolved
// once per CLI run from argv (lib/command-output.ts); tests inject it directly.
const commandName = Layer.succeed(CommandName, "devices.list");
const jsonMode = Layer.mergeAll(makeOutputModeLayer(true), commandName);
const humanMode = Layer.mergeAll(makeOutputModeLayer(false), commandName);

describe("output helpers in --json mode emit exactly one success envelope", () => {
  it("printJson wraps the payload in the success envelope", async () => {
    const lines = await captureStdout(
      printJson({ id: "d1", name: "iPhone" }).pipe(Effect.provide(jsonMode)),
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toStrictEqual({
      schemaVersion: 1,
      ok: true,
      command: "devices.list",
      data: { id: "d1", name: "iPhone" },
    });
  });

  it("printTable envelopes rows as data.items", async () => {
    const lines = await captureStdout(
      printTable(["ID", "Name"], [["d1", "iPhone"]]).pipe(Effect.provide(jsonMode)),
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toStrictEqual({
      schemaVersion: 1,
      ok: true,
      command: "devices.list",
      data: { items: [{ ID: "d1", Name: "iPhone" }] },
    });
  });

  it("printKeyValue envelopes pairs as a flat data object", async () => {
    const lines = await captureStdout(
      printKeyValue([
        ["ID", "d1"],
        ["Name", "iPhone"],
      ]).pipe(Effect.provide(jsonMode)),
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      ok: true,
      data: { ID: "d1", Name: "iPhone" },
    });
  });

  it("printList emits an empty-items envelope rather than a plain-text message", async () => {
    const lines = await captureStdout(
      printList(["ID"], [], "No devices.").pipe(Effect.provide(jsonMode)),
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ ok: true, data: { items: [] } });
  });
});

describe("output helpers in human mode do not emit an envelope", () => {
  it("printJson pretty-prints the bare payload (multi-line, no schemaVersion)", async () => {
    const lines = await captureStdout(printJson({ id: "d1" }).pipe(Effect.provide(humanMode)));
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(parsed).toStrictEqual({ id: "d1" });
    expect("schemaVersion" in parsed).toBe(false);
  });

  it("printKeyValue prints aligned columns, not JSON", async () => {
    const lines = await captureStdout(
      printKeyValue([["ID", "d1"]]).pipe(Effect.provide(humanMode)),
    );
    expect(lines).toStrictEqual(["ID  d1"]);
  });
});
