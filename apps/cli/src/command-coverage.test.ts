import { execSync } from "node:child_process";
import path from "node:path";

import type { Command } from "effect/unstable/cli";

import { commandRegistry } from "./command-registry";

// Walk the SAME registry index.ts mounts on the root command (see
// command-registry.ts). No duplicated tree here — that is the point: a new
// command is registered in exactly one place and this test sees precisely what
// the CLI exposes, so the every-command guarantee cannot drift from production.

interface LeafCommand {
  readonly path: string;
  readonly command: Command.Command.Any;
}

const children = (command: Command.Command.Any): readonly Command.Command.Any[] =>
  command.subcommands.flatMap((group) => group.commands);

const collectLeaves = (
  commands: readonly Command.Command.Any[],
  prefix: string[] = [],
): LeafCommand[] =>
  commands.flatMap((command) => {
    const here = [...prefix, command.name];
    const nested = children(command);
    return nested.length === 0 ? [{ path: here.join(" "), command }] : collectLeaves(nested, here);
  });

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

const onDelegationPath = (file: string): boolean =>
  (file.startsWith("src/commands/") ||
    file.startsWith("src/application/") ||
    file.startsWith("src/services/")) &&
  !file.endsWith(".test.ts");

describe("command coverage (by-construction --json / --non-interactive)", () => {
  const leaves = collectLeaves(commandRegistry);

  it("the command tree contains many leaf commands", () => {
    // Sanity: the walk found the real tree, not an empty/short-circuited import.
    expect(leaves.length).toBeGreaterThan(50);
  });

  it("every command name is unique among its siblings", () => {
    const check = (commands: readonly Command.Command.Any[], prefix: string): void => {
      const names = commands.map((command) => command.name);
      expect(new Set(names).size, `duplicate names under "${prefix}"`).toBe(names.length);
      for (const command of commands) {
        check(children(command), `${prefix} ${command.name}`);
      }
    };
    check(commandRegistry, "better-update");
  });

  it("no command declares --json / --non-interactive / --interactive as a per-command flag", () => {
    // These flags are GLOBAL (declared once on the root command via
    // Command.withGlobalFlags). A leaf re-declaring one would shadow the global
    // contract and diverge; the parser also rejects the duplicate at runtime.
    const offenders = grepFiles(
      String.raw`-E 'Flag\.(Boolean|String)\("(json|non-interactive|interactive)"\)'`,
    ).filter((file) => file.startsWith("src/commands/"));
    expect(offenders).toStrictEqual([]);
  });

  it("every command module with a handler routes its success through runCommand", () => {
    // The success envelope + error envelope + exit code are emitted ONLY at the
    // runCommand boundary (lib/run-command.ts). A handler that self-printed
    // success or mapped its own errors would bypass the envelope and break
    // --json for that command. Statically assert: every command source file
    // that declares a handler body (a generator yielding effects) calls
    // runCommand. This is the every-command guarantee that --json output is
    // uniform. Handlers are `Effect.fn` bodies; group files (`Command.make(name)`
    // + withSubcommands) carry none and are exempt.
    const handlerFiles = grepFiles("'Effect.fn('")
      .filter((file) => file.startsWith("src/commands/"))
      .filter((file) => !file.endsWith(".test.ts"));
    const usesRunCommand = new Set(grepFiles("'runCommand('"));
    const offenders = handlerFiles.filter((file) => !usesRunCommand.has(file));
    expect(offenders).toStrictEqual([]);
  });

  it("no command/application/service file runs an effect itself (Effect.runPromise / runSync)", () => {
    // The entrypoint owns the runtime (NodeRuntime.runMain in index.ts). A
    // command — or any application/service it delegates to — that ran effects
    // itself would skip the error envelope / exit-code mapping and the global
    // flag layers. Guard the WHOLE delegation path.
    const offenders = grepFiles(String.raw`-E 'Effect\.run(Promise|Sync|Fork)'`).filter(
      onDelegationPath,
    );
    expect(offenders).toStrictEqual([]);
  });

  it("no command/application/service file writes output via raw Console.log (would pollute --json stdout)", () => {
    // In --json mode the envelope is the WHOLE stdout payload. A raw Console.log
    // ANYWHERE on a command's delegation path (commands → application use cases →
    // services) prints a human line to stdout regardless of OutputMode, breaking
    // the machine stream. Commands + the application/service layers they call must
    // use printHuman/printList/etc. (suppressed in JSON) for human chrome and
    // RETURN their machine payload for the envelope.
    //
    // Allow-list (the legitimate Console boundary sites):
    // - application/command-exit.ts: the SINGLE error-emission boundary —
    //   Console.log writes the JSON error envelope, Console.error the human
    //   stderr line. This IS the contract, not a violation.
    // - the inherently-interactive wizard/login flows: every prompt is gated by
    //   ensureInteractive (lib/prompts.ts) which fails with
    //   InteractiveProhibitedError before any wizard line is reached in
    //   --json/CI mode, so their Console.log can never pollute a machine stream.
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
      "src/application/credentials-manager-macos.ts",
    ]);
    const offenders = grepFiles(String.raw`-E 'Console\.(log|error)'`)
      .filter(onDelegationPath)
      .filter((file) => !consoleAllowList.has(file));
    expect(offenders).toStrictEqual([]);
  });

  it("no command/application/service file writes to process.stdout directly (would pollute --json stdout)", () => {
    // Console.(log|error) is not the only stdout channel: process.stdout.write
    // bypasses the OutputMode-aware helpers entirely. The native-build log tee
    // (pty-runner.ts / run-step.ts) is the canonical case — in --json mode it
    // would bury the single envelope under thousands of xcodebuild/gradle lines.
    // Those writers route to process.stderr in JSON mode; on the delegation
    // path NOTHING writes stdout outside the envelope sites.
    const offenders = grepFiles(String.raw`-E 'process\.stdout\.write'`).filter(onDelegationPath);
    expect(offenders).toStrictEqual([]);
  });

  it("only lib/prompts.ts runs terminal prompts (every prompt is gated)", () => {
    // Static guarantee that no prompt bypasses the InteractiveMode gate: the
    // Prompt module from effect/unstable/cli is imported in exactly one place.
    const offenders = grepFiles(
      String.raw`-E 'Prompt\.(run|String|Password|Select|MultiSelect|AutoComplete|Confirm|Toggle|List)\('`,
    )
      .filter((file) => file !== "src/lib/prompts.ts")
      .filter((file) => !file.endsWith(".test.ts"));
    expect(offenders).toStrictEqual([]);
  });
});
