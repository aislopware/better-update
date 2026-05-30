import { it } from "@effect/vitest";
import { Effect } from "effect";

import { printHuman, printHumanKeyValue, printHumanList, printHumanTable } from "./output";
import { makeOutputModeLayer } from "./output-mode";

// The human-only helpers are the divergence-prevention half of the by-construction
// JSON mechanism: commands that RETURN their machine payload (runEffect({ json }))
// must emit NOTHING extra on stdout in JSON mode, so the boundary's single success
// envelope is the whole stdout payload. These assert the helpers stay silent in
// JSON mode and render the same human layout as their dual-mode counterparts.

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

const jsonMode = makeOutputModeLayer(true);
const humanMode = makeOutputModeLayer(false);

describe("human-only output helpers emit nothing in JSON mode", () => {
  it("printHuman is silent in JSON mode", async () => {
    const lines = await captureStdout(printHuman("hello").pipe(Effect.provide(jsonMode)));
    expect(lines).toStrictEqual([]);
  });

  it("printHumanTable is silent in JSON mode", async () => {
    const lines = await captureStdout(
      printHumanTable(["ID"], [["d1"]]).pipe(Effect.provide(jsonMode)),
    );
    expect(lines).toStrictEqual([]);
  });

  it("printHumanKeyValue is silent in JSON mode", async () => {
    const lines = await captureStdout(
      printHumanKeyValue([["ID", "d1"]]).pipe(Effect.provide(jsonMode)),
    );
    expect(lines).toStrictEqual([]);
  });

  it("printHumanList is silent in JSON mode (even when empty)", async () => {
    const lines = await captureStdout(
      printHumanList(["ID"], [], "No items.").pipe(Effect.provide(jsonMode)),
    );
    expect(lines).toStrictEqual([]);
  });
});

describe("human-only output helpers render the human layout in human mode", () => {
  it("printHumanTable prints aligned columns (no envelope)", async () => {
    const lines = await captureStdout(
      printHumanTable(["ID", "Name"], [["d1", "iPhone"]]).pipe(Effect.provide(humanMode)),
    );
    // header + separator + one row, none of them JSON.
    expect(lines).toHaveLength(3);
    expect(lines.some((line) => line.includes("schemaVersion"))).toBe(false);
  });

  it("printHumanKeyValue prints aligned pairs", async () => {
    const lines = await captureStdout(
      printHumanKeyValue([["ID", "d1"]]).pipe(Effect.provide(humanMode)),
    );
    expect(lines).toStrictEqual(["ID  d1"]);
  });

  it("printHumanList prints the empty message when there are no rows", async () => {
    const lines = await captureStdout(
      printHumanList(["ID"], [], "No items.").pipe(Effect.provide(humanMode)),
    );
    expect(lines).toStrictEqual(["No items."]);
  });
});
