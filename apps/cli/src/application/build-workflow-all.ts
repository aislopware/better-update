import { Effect, Either } from "effect";

import { clearBuildCaches } from "../lib/clear-cache";
import { InvalidArgumentError } from "../lib/exit-codes";
import { platformLogPrefix, withLogPrefix } from "../lib/log-prefix";
import { printHuman } from "../lib/output";
import { OutputMode } from "../lib/output-mode";
import { ensureRepoClean } from "../lib/repo-clean";
import { resolveProfileName } from "../lib/resolve-profile-name";
import { CliRuntime } from "../services/cli-runtime";
import { runBuildWorkflow } from "./build-workflow";

import type { Platform } from "../lib/build-profile";
import type { RunBuildWorkflowOptions } from "./build-workflow";

export type RunBuildWorkflowAllOptions = Omit<RunBuildWorkflowOptions, "platform" | "mutex">;

/**
 * `build --platform all`: run the iOS and Android builds IN PARALLEL, each as
 * a full {@link runBuildWorkflow} fiber tagged with a `[ios]` / `[android]`
 * output prefix. Shared preflight (dirty-tree gate, profile pick, cache clear)
 * runs once up front; a mutex serializes the sections the two fibers must not
 * enter together (app.json autoIncrement, interactive credential setup,
 * auto-submit). Both builds always run to completion — a failure on one
 * platform is reported at the end instead of interrupting the other.
 */
export const runBuildWorkflowAll = (options: RunBuildWorkflowAllOptions) =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    if (mode.json) {
      return yield* new InvalidArgumentError({
        message:
          "--platform all runs two builds and cannot emit a single JSON envelope. Run --platform ios and --platform android separately with --json.",
      });
    }
    if (options.output !== undefined) {
      return yield* new InvalidArgumentError({
        message:
          "--output targets a single artifact but --platform all produces two. Run per-platform builds to export artifacts.",
      });
    }

    const runtime = yield* CliRuntime;
    const userCwd = yield* runtime.cwd;

    // Gate the REAL working tree once, up front. The per-platform runs get
    // allowDirty: the first platform's autoIncrement legitimately dirties
    // app.json before the second platform's gate would run.
    yield* ensureRepoClean({
      projectRoot: userCwd,
      allowDirty: options.allowDirty ?? false,
      label: "build",
    });

    // Resolve the profile once so an interactive picker prompts once, not twice.
    const profileName = yield* resolveProfileName(userCwd, options.profileName);

    // Clear caches once — the per-platform runs skip their own pass.
    if (options.clearCache) {
      yield* clearBuildCaches(userCwd);
    }

    const mutex = yield* Effect.makeSemaphore(1);
    const runPlatform = (platform: Platform) =>
      runBuildWorkflow({
        ...options,
        platform,
        profileName,
        allowDirty: true,
        clearCache: false,
        mutex,
      }).pipe(withLogPrefix(platformLogPrefix(platform)), Effect.either);

    yield* printHuman(`Building ios and android in parallel (profile "${profileName}")…`);
    const [iosOutcome, androidOutcome] = yield* Effect.all(
      [runPlatform("ios"), runPlatform("android")],
      { concurrency: 2 },
    );

    const failures = [
      { platform: "ios" as const, outcome: iosOutcome },
      { platform: "android" as const, outcome: androidOutcome },
    ].flatMap((entry) =>
      Either.isLeft(entry.outcome) ? [{ platform: entry.platform, error: entry.outcome.left }] : [],
    );
    const [firstFailure] = failures;
    yield* printHuman("");
    if (firstFailure !== undefined) {
      yield* printHuman(`Build failed for: ${failures.map((entry) => entry.platform).join(", ")}`);
      return yield* Effect.fail(firstFailure.error);
    }
    yield* printHuman("Both platform builds completed.");
  });
