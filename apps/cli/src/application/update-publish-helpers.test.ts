import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { UpdatePublishError } from "../lib/exit-codes";
import { makeInteractiveModeLayer } from "../lib/interactive-mode";
import { makeOutputModeLayer } from "../lib/output-mode";
import { failureError } from "../lib/test-utils";
import {
  describePublishTarget,
  formatPublishTarget,
  resolveBranchAndMessage,
  warnOnSlugDivergence,
} from "./update-publish-helpers";

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
  ({ query }: { query: { page?: number; limit: number } }) => {
    const page = query.page ?? 1;
    return Effect.succeed({
      items: all.slice((page - 1) * query.limit, page * query.limit),
      total: all.length,
      page,
      limit: query.limit,
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

// The publish target used to be resolved from the Expo slug, which Expo infers
// from the app `name` when unset — so an app could publish into a SIBLING
// project that happened to own that slug, and report success. The projectId is
// now authoritative; these tests pin the two things that make the divergence
// visible instead of silent: the target is named, and a slug pointing elsewhere
// is called out by name.

const projectApi = (
  get: (options: { params: { id: string } }) => Effect.Effect<unknown, unknown>,
): ApiClient => ({ projects: { get } }) as unknown as ApiClient;

const captureStdout = async (effect: Effect.Effect<void>): Promise<string[]> => {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((value: unknown) => {
    lines.push(String(value));
  });
  try {
    await Effect.runPromise(effect);
  } finally {
    spy.mockRestore();
  }
  return lines;
};

describe(describePublishTarget, () => {
  it.effect("names the project behind the linked id", () =>
    Effect.gen(function* () {
      const target = yield* describePublishTarget(
        projectApi(({ params }) =>
          Effect.succeed({ id: params.id, name: "Acme Store", slug: "acme-store" }),
        ),
        "proj_1",
      );
      expect(target).toStrictEqual({ projectId: "proj_1", name: "Acme Store", slug: "acme-store" });
    }),
  );

  it.effect("degrades to the bare id when the lookup is denied, rather than failing", () =>
    Effect.gen(function* () {
      // A CI robot may hold `update:create` without `project:read`. Publishing
      // must not start depending on a read grant it never needed before.
      const target = yield* describePublishTarget(
        projectApi(() => Effect.fail(new Error("Insufficient permission: project:read"))),
        "proj_1",
      );
      expect(target).toStrictEqual({ projectId: "proj_1", name: undefined, slug: undefined });
      expect(formatPublishTarget(target)).toBe("proj_1");
    }),
  );
});

describe(warnOnSlugDivergence, () => {
  it("names both slugs and both is-not-the-target facts when the config slug points elsewhere", async () => {
    const lines = await captureStdout(
      warnOnSlugDivergence({
        target: { projectId: "proj_acme-store", name: "acme-store", slug: "acme-store" },
        localSlug: "jmango360",
      }).pipe(Effect.provide(makeOutputModeLayer(false))),
    );
    const output = lines.join("\n");
    expect(output).toContain('slug "jmango360"');
    expect(output).toContain('slug "acme-store"');
    expect(output).toContain("proj_acme-store");
    // The word the old failure never printed — without it the user had no thread
    // to pull on, which is what made the cross-tenant publish take hours to find.
    expect(output).toContain("slug");
  });

  it("stays quiet when the config slug matches the project", async () => {
    const lines = await captureStdout(
      warnOnSlugDivergence({
        target: { projectId: "proj_acme-store", name: "acme-store", slug: "acme-store" },
        localSlug: "acme-store",
      }).pipe(Effect.provide(makeOutputModeLayer(false))),
    );
    expect(lines).toStrictEqual([]);
  });

  it("stays quiet when the project lookup was denied (no slug to compare)", async () => {
    const lines = await captureStdout(
      warnOnSlugDivergence({
        target: { projectId: "proj_1", name: undefined, slug: undefined },
        localSlug: "jmango360",
      }).pipe(Effect.provide(makeOutputModeLayer(false))),
    );
    expect(lines).toStrictEqual([]);
  });
});
