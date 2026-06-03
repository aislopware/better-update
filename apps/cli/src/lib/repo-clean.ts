import { Command } from "@effect/platform";
import { Console, Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

import { DirtyRepoError } from "./exit-codes";
import { InteractiveMode } from "./interactive-mode";
import { promptConfirm } from "./prompts";

import type { InteractiveProhibitedError } from "./exit-codes";

const MAX_FILES_SHOWN = 10;

const readPorcelain = (
  projectRoot: string,
): Effect.Effect<readonly string[], never, CommandExecutor.CommandExecutor> =>
  Command.make("git", "status", "--porcelain").pipe(
    Command.workingDirectory(projectRoot),
    Command.string,
    Effect.map((output) =>
      output
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
    Effect.orElseSucceed((): readonly string[] => []),
  );

export interface EnsureRepoCleanOptions {
  readonly projectRoot: string;
  readonly allowDirty: boolean;
  /** Label inserted into messages (e.g. "build", "update publish"). */
  readonly label: string;
}

/**
 * Refuse to proceed when the working tree has uncommitted changes. Skipped when
 * `allowDirty` is true. In interactive mode, prompts the user to confirm; in
 * non-interactive mode, fails with `DirtyRepoError`.
 */
export const ensureRepoClean = ({
  projectRoot,
  allowDirty,
  label,
}: EnsureRepoCleanOptions): Effect.Effect<
  void,
  DirtyRepoError | InteractiveProhibitedError,
  CommandExecutor.CommandExecutor | InteractiveMode
> =>
  Effect.gen(function* () {
    if (allowDirty) {
      return;
    }
    const dirty = yield* readPorcelain(projectRoot);
    if (dirty.length === 0) {
      return;
    }

    const preview = dirty.slice(0, MAX_FILES_SHOWN).join("\n  ");
    const overflow =
      dirty.length > MAX_FILES_SHOWN
        ? `\n  ... and ${String(dirty.length - MAX_FILES_SHOWN)} more`
        : "";
    yield* Console.error(
      `Uncommitted changes (${String(dirty.length)} file(s)):\n  ${preview}${overflow}`,
    );

    const mode = yield* InteractiveMode;
    if (!mode.allow) {
      return yield* new DirtyRepoError({
        message: `Refusing to ${label} with a dirty working tree. Commit your changes or pass --allow-dirty.`,
      });
    }
    const ok = yield* promptConfirm(`Continue ${label} with uncommitted changes?`, {
      initialValue: false,
    });
    if (!ok) {
      return yield* new DirtyRepoError({
        message: `${label} cancelled by user.`,
      });
    }
  });
