import path from "node:path";

import { compact } from "@better-update/type-guards";
import { FileSystem, Console, Effect } from "effect";

import { drainPages } from "../lib/drain-cursor";
import { UpdatePublishError } from "../lib/exit-codes";
import { formatCause } from "../lib/format-error";
import { InteractiveMode } from "../lib/interactive-mode";
import { printHuman } from "../lib/output";
import { promptConfirm, promptSelect, promptText } from "../lib/prompts";

import type { Platform } from "../lib/build-profile";
import type { GitContext } from "../lib/git-context";
import type { OutputMode } from "../lib/output-mode";
import type { apiClient } from "../services/api-client";

export interface PublishedPlatformMetadata {
  readonly platform: Platform;
  readonly updateId: string;
  readonly runtimeVersion: string;
}

export const resolveChannelToBranch = (
  client: Effect.Success<typeof apiClient>,
  projectId: string,
  channelName: string,
) =>
  Effect.gen(function* () {
    const channels = yield* drainPages((page) =>
      client.channels.list({ query: { projectId, limit: 100, page } }),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({
            message: `Failed to list channels: ${formatCause(cause)}`,
          }),
      ),
    );
    const match = channels.find((channel) => channel.name === channelName);
    if (!match) {
      // EAS parity: a missing channel is provisioned on first publish. Falling
      // through with the channel's name lets the server create a branch of the
      // same name and link the channel to it atomically.
      yield* Console.log(
        `Channel "${channelName}" does not exist yet; it will be created and linked to a new branch "${channelName}".`,
      );
      return channelName;
    }
    const branches = yield* drainPages((page) =>
      client.branches.list({ query: { projectId, limit: 100, page } }),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({
            message: `Failed to list branches: ${formatCause(cause)}`,
          }),
      ),
    );
    const branch = branches.find((entry) => entry.id === match.branchId);
    if (!branch) {
      return yield* new UpdatePublishError({
        message: `Channel "${channelName}" maps to a branch (${match.branchId}) not in the project's branch list.`,
      });
    }
    return branch.name;
  });

const CREATE_NEW_BRANCH_SENTINEL = "__better_update_create_new_branch__";

const promptBranchName = Effect.gen(function* () {
  const name = yield* promptText("Branch name to create", {
    placeholder: "e.g. main, staging, release",
  });
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return yield* new UpdatePublishError({ message: "Branch name cannot be empty." });
  }
  return trimmed;
});

/**
 * Interactive branch picker: lists existing branches with a "+ Create new..."
 * Sentinel option. When the user picks the sentinel (or there are no
 * Existing branches), prompts for a new branch name.
 */
export const promptForBranch = (client: Effect.Success<typeof apiClient>, projectId: string) =>
  Effect.gen(function* () {
    const branches = yield* drainPages((page) =>
      client.branches.list({ query: { projectId, limit: 100, page } }),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({
            message: `Failed to list branches: ${formatCause(cause)}`,
          }),
      ),
    );

    if (branches.length === 0) {
      return yield* promptBranchName;
    }

    const choice = yield* promptSelect<string>("Which branch to publish to?", [
      ...branches.map((branch) => ({ value: branch.name, label: branch.name })),
      { value: CREATE_NEW_BRANCH_SENTINEL, label: "+ Create new branch..." },
    ]);

    if (choice === CREATE_NEW_BRANCH_SENTINEL) {
      return yield* promptBranchName;
    }
    return choice;
  });

/**
 * Interactive message prompt with the git commit subject as default.
 * Returns `undefined` if the user entered an empty value, so the caller
 * Can fall back to its own default.
 */
export const promptForMessage = (commitMessage: string | undefined) =>
  Effect.gen(function* () {
    const fallback = commitMessage ?? "Publish via better-update CLI";
    const entered = yield* promptText("Update message", {
      placeholder: fallback,
      defaultValue: fallback,
    });
    const trimmed = entered.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

export interface ResolveBranchAndMessageInput {
  readonly client: Effect.Success<typeof apiClient>;
  readonly projectId: string;
  readonly branchArg: string | undefined;
  readonly messageArg: string | undefined;
  readonly channelArg: string | undefined;
  readonly auto: boolean;
  readonly gitCtx: GitContext;
  readonly envBranch: string | undefined;
}

export interface ResolvedBranchAndMessage {
  readonly branch: string;
  readonly message: string | undefined;
}

/**
 * Apply the full branch/message resolution chain in priority order:
 * Explicit args → git context (when --auto) → channel lookup → env fallback →
 * Interactive picker. Returns the final values or fails with a helpful error
 * When everything is exhausted in non-interactive mode.
 */
export const resolveBranchAndMessage = (input: ResolveBranchAndMessageInput) =>
  Effect.gen(function* () {
    let branch = input.branchArg;
    let message = input.messageArg;

    if (input.auto) {
      if (branch === undefined && input.gitCtx.ref !== undefined) {
        branch = input.gitCtx.ref;
      }
      if (message === undefined && input.gitCtx.commitMessage !== undefined) {
        message = input.gitCtx.commitMessage;
      }
    }

    if (branch === undefined && input.channelArg !== undefined) {
      branch = yield* resolveChannelToBranch(input.client, input.projectId, input.channelArg);
    }

    if (branch === undefined && input.envBranch !== undefined && input.envBranch.length > 0) {
      branch = input.envBranch;
    }

    const interactive = yield* InteractiveMode;

    if (branch === undefined) {
      if (!interactive.allow) {
        return yield* new UpdatePublishError({
          message:
            "Missing --branch or --channel. Provide one explicitly, set BETTER_UPDATE_BRANCH, use --auto to infer from git, or run interactively.",
        });
      }
      branch = yield* promptForBranch(input.client, input.projectId);
    }

    if (message === undefined && interactive.allow && !input.auto) {
      message = yield* promptForMessage(input.gitCtx.commitMessage);
    }

    return { branch, message } as const satisfies ResolvedBranchAndMessage;
  });

/** The project a publish will land in, as far as the CLI could resolve it. */
export interface PublishTarget {
  readonly projectId: string;
  /** Server-side name/slug; absent when the lookup was not permitted or failed. */
  readonly name: string | undefined;
  readonly slug: string | undefined;
}

/**
 * Look up the destination project so the publish can name it. Best-effort by
 * design: a robot granted `update:create` but not `project:read` must still be
 * able to publish, so a failed lookup degrades to the bare id rather than
 * aborting.
 */
export const describePublishTarget = (
  client: Effect.Success<typeof apiClient>,
  projectId: string,
): Effect.Effect<PublishTarget> =>
  client.projects.get({ params: { id: projectId } }).pipe(
    Effect.map(
      (project) =>
        ({ projectId, name: project.name, slug: project.slug }) as const satisfies PublishTarget,
    ),
    Effect.orElseSucceed(
      () => ({ projectId, name: undefined, slug: undefined }) as const satisfies PublishTarget,
    ),
  );

/** `name (slug) · id`, degrading to the bare id when the lookup was denied. */
export const formatPublishTarget = (target: PublishTarget): string =>
  target.name === undefined
    ? target.projectId
    : `${target.name} (${target.slug ?? "?"}) · ${target.projectId}`;

/**
 * Warn when the Expo config's slug names a DIFFERENT project than the linked
 * projectId. The slug no longer decides where an update lands, but the mismatch
 * still means `expo export` and better-update disagree about this app's
 * identity, and it is the exact shape that used to publish into another
 * tenant's project. Printed unconditionally — `--auto` (CI) is where it matters
 * most and there is no prompt there to catch it.
 */
export const warnOnSlugDivergence = (params: {
  readonly target: PublishTarget;
  readonly localSlug: string;
}): Effect.Effect<void, never, OutputMode> =>
  Effect.gen(function* () {
    if (params.target.slug === undefined || params.target.slug === params.localSlug) {
      return;
    }
    yield* printHuman(
      `Warning: your Expo config resolves slug "${params.localSlug}", but project ` +
        `${formatPublishTarget(params.target)} has slug "${params.target.slug}". ` +
        "Publishing by projectId (the slug is ignored). Expo infers slug from the app " +
        `\`name\` when it is unset — set "slug": "${params.target.slug}" in app.json to align them.`,
    );
  });

/**
 * Show a pre-publish preview and ask for confirmation. Returns `false`
 * If the user declines so the caller can abort gracefully.
 */
export const confirmPublishPreview = (preview: {
  readonly target: PublishTarget;
  readonly branch: string;
  readonly platforms: readonly Platform[];
  readonly message: string;
  readonly environment: string;
}) =>
  Effect.gen(function* () {
    yield* Console.log("");
    // Project first: it is the one field a wrong link silently changes, and the
    // only one the user can check against the dashboard at a glance.
    yield* Console.log(`Project:     ${formatPublishTarget(preview.target)}`);
    yield* Console.log(`Branch:      ${preview.branch}`);
    yield* Console.log(`Platforms:   ${[...preview.platforms].join(", ")}`);
    yield* Console.log(`Environment: ${preview.environment}`);
    yield* Console.log(`Message:     ${preview.message}`);
    yield* Console.log("");
    return yield* promptConfirm("Proceed with publish?", { initialValue: true });
  });

export const emitMetadataFile = (input: {
  readonly dir: string;
  readonly groupId: string;
  readonly branch: string;
  readonly channel: string | undefined;
  readonly message: string;
  readonly results: readonly PublishedPlatformMetadata[];
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(input.dir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({
            message: `Failed to prepare metadata directory: ${formatCause(cause)}`,
          }),
      ),
    );
    const metadata = {
      groupId: input.groupId,
      branch: input.branch,
      message: input.message,
      updates: input.results.map((entry) => ({
        platform: entry.platform,
        updateId: entry.updateId,
        runtimeVersion: entry.runtimeVersion,
      })),
      ...compact({ channel: input.channel }),
    };
    const filePath = path.join(input.dir, "eas-update-metadata.json");
    yield* fs.writeFileString(filePath, `${JSON.stringify(metadata, null, 2)}\n`).pipe(
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({
            message: `Failed to write ${filePath}: ${formatCause(cause)}`,
          }),
      ),
    );
  });
