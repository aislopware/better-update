import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { UpdatePublishError } from "../lib/exit-codes";
import { makeInteractiveModeLayer } from "../lib/interactive-mode";
import { failureError } from "../lib/test-utils";
import { resolveBranchAndMessage } from "./update-publish-helpers";

import type { GitContext } from "../lib/git-context";
import type { ApiClient } from "../services/api-client";
import type { ResolveBranchAndMessageInput } from "./update-publish-helpers";

// resolveBranchAndMessage is the heart of the --auto derivation: under --auto it
// pulls the branch from the current git branch (gitCtx.ref) and the update
// message from the latest commit subject (gitCtx.commitMessage), but explicit
// --branch/--message always win, and git is NEVER consulted without --auto. The
// full priority chain is: explicit arg > git (--auto only) > channel lookup >
// BETTER_UPDATE_BRANCH > interactive picker. These tests pin that contract so a
// regression in the chain (message no longer derived, branchArg no longer
// winning, git leaking in without --auto) can't pass silently.

const git = (overrides: Partial<GitContext> = {}): GitContext => ({
  ref: undefined,
  commit: undefined,
  commitMessage: undefined,
  dirty: false,
  ...overrides,
});

// A stub client whose channel/branch lists let resolveChannelToBranch resolve a
// channel name to a branch. The git-derivation tests never reach it (branch is
// already set), so an unconfigured channel just yields an empty list. Lists are
// served page-by-page so the drainPages-based resolution is exercised for real.
const paged =
  <Item>(all: readonly Item[]) =>
  ({ urlParams }: { urlParams: { page?: number; limit: number } }) => {
    const page = urlParams.page ?? 1;
    return Effect.succeed({
      items: all.slice((page - 1) * urlParams.limit, page * urlParams.limit),
      total: all.length,
      page,
      limit: urlParams.limit,
    });
  };

const makeApi = (
  channels: readonly { name: string; branchId: string }[] = [],
  branches: readonly { id: string; name: string }[] = [],
): ApiClient =>
  ({
    channels: { list: paged(channels) },
    branches: { list: paged(branches) },
  }) as unknown as ApiClient;

const baseInput = (
  overrides: Partial<ResolveBranchAndMessageInput> = {},
): ResolveBranchAndMessageInput => ({
  client: makeApi(),
  projectId: "proj_1",
  branchArg: undefined,
  messageArg: undefined,
  channelArg: undefined,
  auto: false,
  gitCtx: git(),
  envBranch: undefined,
  ...overrides,
});

const resolve = (input: ResolveBranchAndMessageInput, allowInteractive = false) =>
  resolveBranchAndMessage(input).pipe(Effect.provide(makeInteractiveModeLayer(allowInteractive)));

describe(resolveBranchAndMessage, () => {
  it.effect("--auto derives branch from git ref and message from the latest commit subject", () =>
    Effect.gen(function* () {
      const resolved = yield* resolve(
        baseInput({
          auto: true,
          gitCtx: git({ ref: "feature/x", commitMessage: "fix: y" }),
        }),
      );
      expect(resolved.branch).toBe("feature/x");
      expect(resolved.message).toBe("fix: y");
    }),
  );

  it.effect("explicit --branch and --message override the git-derived values under --auto", () =>
    Effect.gen(function* () {
      const resolved = yield* resolve(
        baseInput({
          auto: true,
          branchArg: "release",
          messageArg: "chore: explicit",
          gitCtx: git({ ref: "feature/x", commitMessage: "fix: y" }),
        }),
      );
      expect(resolved.branch).toBe("release");
      expect(resolved.message).toBe("chore: explicit");
    }),
  );

  it.effect(
    "--auto with a detached HEAD (no git ref) and no --branch/--channel/env fails with the helpful non-interactive error",
    () =>
      Effect.gen(function* () {
        // Detached HEAD: symbolic-ref failed so gitCtx.ref is undefined. There is
        // nothing to derive a branch from, so rather than inventing a bad branch
        // the resolver must fail with the actionable message.
        const exit = yield* resolve(
          baseInput({ auto: true, gitCtx: git({ ref: undefined, commitMessage: "fix: y" }) }),
        ).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        const err = failureError(exit);
        expect(err).toBeInstanceOf(UpdatePublishError);
        expect((err as UpdatePublishError).message).toContain("Missing --branch or --channel");
      }),
  );

  it.effect("without --auto, the git ref is NOT used as the branch", () =>
    Effect.gen(function* () {
      // git resolved a real branch + commit, but --auto is off. The resolver must
      // ignore git entirely and (here, non-interactive with no other source) fail
      // — proving the ref never leaked into the branch.
      const exit = yield* resolve(
        baseInput({
          auto: false,
          gitCtx: git({ ref: "feature/x", commitMessage: "fix: y" }),
        }),
      ).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      const err = failureError(exit);
      expect(err).toBeInstanceOf(UpdatePublishError);
      expect((err as UpdatePublishError).message).toContain("Missing --branch or --channel");
    }),
  );

  it.effect("falls through to the channel mapping when no branch arg and not --auto", () =>
    Effect.gen(function* () {
      // Channel resolution sits below git in the chain; with --auto off and a real
      // git ref present, the channel-derived branch must still win (git ignored).
      const resolved = yield* resolve(
        baseInput({
          channelArg: "production",
          client: makeApi(
            [{ name: "production", branchId: "br_1" }],
            [{ id: "br_1", name: "main" }],
          ),
          gitCtx: git({ ref: "feature/x" }),
        }),
      );
      expect(resolved.branch).toBe("main");
    }),
  );

  it.effect("resolves a channel whose rows sit beyond the first list page", () =>
    Effect.gen(function* () {
      // Regression: the channel→branch lookup used a single limit:100 page, so a
      // channel or branch past row 100 was reported as missing. Both lists must
      // be drained.
      const channels = [
        ...Array.from({ length: 150 }, (_, index) => ({
          name: `filler-channel-${index}`,
          branchId: `br_filler_${index}`,
        })),
        { name: "production", branchId: "br_real" },
      ];
      const branches = [
        ...Array.from({ length: 150 }, (_, index) => ({
          id: `br_filler_${index}`,
          name: `filler-branch-${index}`,
        })),
        { id: "br_real", name: "main" },
      ];
      const resolved = yield* resolve(
        baseInput({ channelArg: "production", client: makeApi(channels, branches) }),
      );
      expect(resolved.branch).toBe("main");
    }),
  );

  it.effect("a missing channel falls through to a branch of the same name (EAS parity)", () =>
    Effect.gen(function* () {
      // eas-cli auto-provisions a branch named after a nonexistent --channel and
      // links them on first publish; our server does the same via
      // ensureBranchChannel when it sees the branch name. The resolver must pass
      // the channel name through instead of failing.
      const resolved = yield* resolve(baseInput({ channelArg: "canary", client: makeApi() }));
      expect(resolved.branch).toBe("canary");
    }),
  );

  it.effect("still fails when an existing channel points at a branch missing from the list", () =>
    Effect.gen(function* () {
      const exit = yield* resolve(
        baseInput({
          channelArg: "production",
          client: makeApi([{ name: "production", branchId: "br_ghost" }], []),
        }),
      ).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      const err = failureError(exit);
      expect(err).toBeInstanceOf(UpdatePublishError);
      expect((err as UpdatePublishError).message).toContain("maps to a branch");
    }),
  );
});
