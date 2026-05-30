import { it } from "@effect/vitest";

import { buildKnownCommandTree, resolveCommandName } from "./command-output";

const argv = (...rest: string[]): readonly string[] => ["node", "/path/cli.js", ...rest];

describe("command-name resolution (legacy heuristic, no known tree)", () => {
  it("joins leading non-flag tokens with dots", () => {
    expect(resolveCommandName(argv("devices", "list"))).toBe("devices.list");
  });

  it("handles a single top-level command", () => {
    expect(resolveCommandName(argv("whoami"))).toBe("whoami");
  });

  it("stops at the first flag", () => {
    expect(resolveCommandName(argv("devices", "list", "--page", "2"))).toBe("devices.list");
  });

  it("caps at maxSegments (default 3) for deep trees", () => {
    expect(resolveCommandName(argv("update", "view", "abc123", "extra"))).toBe(
      "update.view.abc123",
    );
  });

  it("respects an explicit maxSegments to drop a trailing positional", () => {
    expect(resolveCommandName(argv("devices", "view", "d-123"), { maxSegments: 2 })).toBe(
      "devices.view",
    );
  });

  it("falls back to 'unknown' with no command token", () => {
    expect(resolveCommandName(argv())).toBe("unknown");
    expect(resolveCommandName(argv("--json"))).toBe("unknown");
  });
});

describe(buildKnownCommandTree, () => {
  it("flattens a citty-style registry into a name → children tree", () => {
    const registry = {
      whoami: {},
      branches: { subCommands: { view: {}, list: {} } },
      channels: { subCommands: { rollout: { subCommands: { create: {}, revert: {} } } } },
    };
    expect(buildKnownCommandTree(registry)).toStrictEqual({
      whoami: {},
      branches: { view: {}, list: {} },
      channels: { rollout: { create: {}, revert: {} } },
    });
  });
});

describe("command-name resolution with the registry tree (drops trailing positionals)", () => {
  const knownCommands = buildKnownCommandTree({
    whoami: {},
    branches: { subCommands: { view: {}, list: {} } },
    update: { subCommands: { view: {}, publish: {}, rollout: { subCommands: { set: {} } } } },
  });

  it("drops a trailing id positional — `branches view bch_123` → branches.view", () => {
    // The P3 leak: without the tree this folded `bch_123` into the command path
    // (and into logs). With the tree it stops at the deepest registered subcommand.
    expect(resolveCommandName(argv("branches", "view", "bch_123"), { knownCommands })).toBe(
      "branches.view",
    );
  });

  it("drops `update view <id>` to update.view", () => {
    expect(resolveCommandName(argv("update", "view", "upd_abc"), { knownCommands })).toBe(
      "update.view",
    );
  });

  it("resolves a deep registered path fully", () => {
    expect(
      resolveCommandName(argv("update", "rollout", "set", "upd_1", "50"), { knownCommands }),
    ).toBe("update.rollout.set");
  });

  it("stops at the first flag", () => {
    expect(resolveCommandName(argv("branches", "list", "--page", "2"), { knownCommands })).toBe(
      "branches.list",
    );
  });

  it("resolves a top-level leaf with no subcommands", () => {
    expect(resolveCommandName(argv("whoami"), { knownCommands })).toBe("whoami");
  });

  it("falls back to 'unknown' for an unregistered first token", () => {
    expect(resolveCommandName(argv("bogus", "thing"), { knownCommands })).toBe("unknown");
  });
});
