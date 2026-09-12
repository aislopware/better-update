import { Command } from "effect/unstable/cli";

import { buildKnownCommandTree, resolveCommandName } from "./command-output";

const leaf = (name: string) => Command.make(name);
const group = (name: string, children: readonly Command.Command.Any[]) =>
  Command.make(name).pipe(Command.withSubcommands(children));

const root = group("better-update", [
  leaf("whoami"),
  group("branches", [leaf("view"), leaf("list")]),
  group("update", [leaf("view"), leaf("publish"), group("rollout", [leaf("set")])]),
]);

describe(buildKnownCommandTree, () => {
  it("flattens the command tree into a name → children tree", () => {
    expect(buildKnownCommandTree(root)).toStrictEqual({
      whoami: {},
      branches: { view: {}, list: {} },
      update: { view: {}, publish: {}, rollout: { set: {} } },
    });
  });
});

describe("command-name resolution with the command tree (drops trailing positionals)", () => {
  const known = buildKnownCommandTree(root);

  it("drops a trailing id positional — `branches view bch_123` → branches.view", () => {
    // Without the tree this would fold `bch_123` into the command path (and
    // into logs). With the tree it stops at the deepest registered subcommand.
    expect(resolveCommandName(["branches", "view", "bch_123"], known)).toBe("branches.view");
  });

  it("drops `update view <id>` to update.view", () => {
    expect(resolveCommandName(["update", "view", "upd_abc"], known)).toBe("update.view");
  });

  it("resolves a deep registered path fully", () => {
    expect(resolveCommandName(["update", "rollout", "set", "upd_1", "50"], known)).toBe(
      "update.rollout.set",
    );
  });

  it("stops at the first non-global flag", () => {
    expect(resolveCommandName(["branches", "list", "--page", "2"], known)).toBe("branches.list");
  });

  it("skips global flags wherever they appear", () => {
    expect(resolveCommandName(["--json", "branches", "--non-interactive", "list"], known)).toBe(
      "branches.list",
    );
  });

  it("skips global-flag values too — `--json true`, `--json=true`, `--log-level debug`", () => {
    expect(resolveCommandName(["--json", "true", "branches", "list"], known)).toBe("branches.list");
    expect(resolveCommandName(["--json=true", "branches", "list"], known)).toBe("branches.list");
    expect(resolveCommandName(["branches", "--json", "false", "list"], known)).toBe(
      "branches.list",
    );
    expect(resolveCommandName(["--log-level", "debug", "branches", "list"], known)).toBe(
      "branches.list",
    );
    expect(resolveCommandName(["--log-level=debug", "branches", "list"], known)).toBe(
      "branches.list",
    );
  });

  it("resolves a top-level leaf with no subcommands", () => {
    expect(resolveCommandName(["whoami"], known)).toBe("whoami");
  });

  it("falls back to 'unknown' for an unregistered first token or no token", () => {
    expect(resolveCommandName(["bogus", "thing"], known)).toBe("unknown");
    expect(resolveCommandName([], known)).toBe("unknown");
    expect(resolveCommandName(["--json"], known)).toBe("unknown");
  });
});
