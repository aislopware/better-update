import { execSync } from "node:child_process";
import path from "node:path";

import { it } from "@effect/vitest";

import { commandRegistry } from "./command-registry";

// Walk the SAME registry index.ts ships (see command-registry.ts). No duplicated
// tree here — that is the point: a new command is registered in exactly one
// place and this test sees precisely what the CLI exposes, so the
// every-command guarantee cannot drift from production.
const COMMAND_TREE: Record<string, unknown> = commandRegistry;

const GLOBAL_FLAG_ARGS = ["json", "non-interactive", "interactive"] as const;

interface CommandNode {
  readonly run?: unknown;
  readonly subCommands?: Record<string, unknown>;
  readonly args?: Record<string, unknown>;
}

interface LeafCommand {
  readonly path: string;
  readonly node: CommandNode;
}

const asNode = (value: unknown): CommandNode => value as CommandNode;

const collectLeaves = (tree: Record<string, unknown>, prefix: string[] = []): LeafCommand[] => {
  const leaves: LeafCommand[] = [];
  for (const [name, value] of Object.entries(tree)) {
    const node = asNode(value);
    const here = [...prefix, name];
    if (node.subCommands) {
      leaves.push(...collectLeaves(node.subCommands, here));
    }
    if (typeof node.run === "function") {
      leaves.push({ path: here.join(" "), node });
    }
  }
  return leaves;
};

const cliRoot = path.resolve(__dirname, "..");

// `|| true` keeps grep's exit code 0 even with no matches, so execSync never throws.
const grepFiles = (pattern: string): string[] =>
  execSync(`grep -rl --include='*.ts' ${pattern} src || true`, {
    cwd: cliRoot,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

describe("command coverage (by-construction --json / --non-interactive)", () => {
  const leaves = collectLeaves(COMMAND_TREE);

  it("the command tree contains many leaf commands", () => {
    // Sanity: the walk found the real tree, not an empty/short-circuited import.
    expect(leaves.length).toBeGreaterThan(50);
  });

  it("every leaf command is runnable (citty `run` is a function)", () => {
    // Every registered leaf has a `run` — so each is reachable under the global
    // flag injection in index.ts (which strips --json/--non-interactive/--interactive
    // before citty parses, then bakes them into OutputMode + InteractiveMode).
    const notRunnable = leaves.filter((leaf) => typeof leaf.node.run !== "function");
    expect(notRunnable.map((leaf) => leaf.path)).toStrictEqual([]);
  });

  it("no leaf command declares --json / --non-interactive / --interactive as a per-command arg", () => {
    // These flags are GLOBAL (parsed + stripped in index.ts before citty). If any
    // leaf re-declared them they would shadow the global contract and diverge.
    const offenders = leaves.filter((leaf) => {
      const args = leaf.node.args ?? {};
      return GLOBAL_FLAG_ARGS.some((flag) => flag in args);
    });
    expect(offenders.map((leaf) => leaf.path)).toStrictEqual([]);
  });

  it("every command module with a `run` body routes its success through runEffect", () => {
    // The success envelope + error envelope + exit code are emitted ONLY at the
    // runEffect boundary (citty-effect.ts). A leaf that ran an Effect itself
    // (Effect.runPromise) or self-printed success would bypass the envelope and
    // break --json for that command. Statically assert: every command source file
    // that declares a `run:` body imports/calls runEffect. This is the
    // every-command guarantee that --json output is uniform.
    const runBodyFiles = grepFiles(String.raw`-E '^[[:space:]]*run:[[:space:]]*(async|\()'`)
      .filter((file) => file.startsWith("src/commands/"))
      .filter((file) => !file.endsWith(".test.ts"));
    const offenders = runBodyFiles.filter((file) => {
      const contents = execSync(`grep -c runEffect ${JSON.stringify(file)} || true`, {
        cwd: cliRoot,
        encoding: "utf8",
      }).trim();
      return contents === "0" || contents === "";
    });
    expect(offenders).toStrictEqual([]);
  });

  it("no command/application/service file bypasses the output port with a raw Effect.runPromise", () => {
    // The boundary owns Effect.runPromise (citty-effect.ts) + the version-notifier
    // bootstrap (index.ts). A command — or any application/service it delegates to —
    // that called Effect.runPromise itself would skip the error envelope /
    // exit-code mapping. Guard the WHOLE delegation path: only the boundary files
    // run effects directly.
    const allowed = new Set(["src/lib/citty-effect.ts", "src/index.ts"]);
    const offenders = grepFiles("'Effect.runPromise'")
      .filter(
        (file) =>
          file.startsWith("src/commands/") ||
          file.startsWith("src/application/") ||
          file.startsWith("src/services/"),
      )
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) => !allowed.has(file));
    expect(offenders).toStrictEqual([]);
  });

  it("no command/application/service file writes output via raw Console.log (would pollute --json stdout)", () => {
    // In --json mode the envelope is the WHOLE stdout payload. A raw Console.log
    // ANYWHERE on a command's delegation path (commands → application use cases →
    // services) prints a human line to stdout regardless of OutputMode, breaking
    // the machine stream. Commands + the application/service layers they call must
    // use printHuman/printList/etc. (suppressed in JSON) for human chrome and
    // RETURN their machine payload for the envelope. This scans the WHOLE
    // delegation path — not just src/commands/ — so progress logging that lives
    // deep in the application layer (the flagship `update publish` patch phase,
    // `builds upload`, `build`) cannot regress the --json contract unseen.
    //
    // Allow-list (the legitimate Console boundary sites):
    // - application/command-exit.ts: the SINGLE error-emission boundary —
    //   Console.log writes the JSON error envelope, Console.error the human
    //   stderr line. This IS the contract, not a violation.
    // - the inherently-interactive wizard/login flows: every prompt is gated by
    //   ensureInteractive (lib/prompts.ts) which fails with
    //   InteractiveProhibitedError before any wizard line is reached in
    //   --json/CI mode, so their Console.log can never pollute a machine stream.
    //   Scripting an interactive credentials/login wizard is a non-goal.
    const consoleAllowList = new Set([
      "src/application/command-exit.ts",
      "src/application/login.ts",
      "src/application/update-publish-helpers.ts",
      "src/application/credentials-interactive.ts",
      "src/application/credentials-interactive-apple-id.ts",
      "src/application/credentials-interactive-ios-asc.ts",
      "src/application/credentials-rebind.ts",
      "src/application/credentials-manager.ts",
      "src/application/credentials-manager-shared.ts",
      "src/application/credentials-manager-android.ts",
      "src/application/credentials-manager-ios.ts",
      "src/application/credentials-manager-ios-asc.ts",
      "src/application/credentials-manager-ios-revoke.ts",
    ]);
    const offenders = grepFiles(String.raw`-E 'Console\.(log|error)'`)
      .filter(
        (file) =>
          file.startsWith("src/commands/") ||
          file.startsWith("src/application/") ||
          file.startsWith("src/services/"),
      )
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) => !consoleAllowList.has(file));
    expect(offenders).toStrictEqual([]);
  });

  it("no command/application/service file writes to process.stdout directly (would pollute --json stdout)", () => {
    // Console.(log|error) is not the only stdout channel: process.stdout.write
    // bypasses the OutputMode-aware helpers entirely. The native-build log tee
    // (pty-runner.ts / run-step.ts) is the canonical case — in --json mode it
    // would bury the single envelope under thousands of xcodebuild/gradle lines.
    // Those writers now route to process.stderr in JSON mode (chrome a stdout-only
    // JSON consumer ignores), so on the delegation path NOTHING writes stdout
    // outside the envelope sites. process.stderr.write is allowed everywhere
    // (stderr is chrome, never the machine stream); only stdout is guarded.
    const offenders = grepFiles(String.raw`-E 'process\.stdout\.write'`)
      .filter(
        (file) =>
          file.startsWith("src/commands/") ||
          file.startsWith("src/application/") ||
          file.startsWith("src/services/"),
      )
      .filter((file) => !file.endsWith(".test.ts"));
    expect(offenders).toStrictEqual([]);
  });

  it("only lib/prompts.ts imports @clack/prompts (every prompt is gated)", () => {
    // Static guarantee that no prompt bypasses the InteractiveMode gate. grep over
    // src/ excluding the sole allowed importer and tests.
    const offenders = grepFiles("'@clack/prompts'")
      .filter((file) => file !== "src/lib/prompts.ts")
      .filter((file) => !file.endsWith(".test.ts"));
    expect(offenders).toStrictEqual([]);
  });
});
