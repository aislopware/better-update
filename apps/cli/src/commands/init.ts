import path from "node:path";

import { compact, isRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect, Option } from "effect";

import { writeBetterUpdateConfig } from "../lib/better-update-config";
import { runEffect } from "../lib/citty-effect";
import { ProjectNotLinkedError } from "../lib/exit-codes";
import { extractSlug, writeProjectId } from "../lib/expo-config";
import { InteractiveMode } from "../lib/interactive-mode";
import { printHuman } from "../lib/output";
import { readExpoConfigOptional } from "../lib/project-link";
import { promptConfirm } from "../lib/prompts";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";

import type { ExpoConfig } from "../lib/expo-config";
import type { ApiClient } from "../services/api-client";

const checkExistingLink = (
  api: ApiClient,
  config: { readonly extra?: { readonly betterUpdate?: { readonly projectId?: unknown } } },
  localSlug: string,
) =>
  Effect.gen(function* () {
    const existingId = config.extra?.betterUpdate?.projectId;
    if (typeof existingId !== "string" || existingId.length === 0) {
      return "no-link" as const;
    }

    const project = yield* api.projects
      .get({ path: { id: existingId } })
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    if (project === undefined) {
      yield* printHuman(
        `Existing projectId "${existingId}" not found on server. Re-linking by local slug "${localSlug}".`,
      );
      return "stale" as const;
    }
    if (project.slug === localSlug) {
      yield* printHuman(`Already linked to "${project.name}" (${project.id}). Nothing to do.`);
      return "matched" as const;
    }
    yield* printHuman(
      `Linked projectId "${existingId}" points to slug "${project.slug}" but local slug is "${localSlug}".`,
    );
    const mode = yield* InteractiveMode;
    if (!mode.allow) {
      yield* printHuman("Re-running in interactive mode would prompt to overwrite. Aborting.");
      return "mismatch-abort" as const;
    }
    const overwrite = yield* promptConfirm("Overwrite local projectId with a fresh link by slug?", {
      initialValue: false,
    });
    return overwrite ? ("mismatch-overwrite" as const) : ("mismatch-abort" as const);
  });

/** kebab-case a project name into a default slug (lowercase, non-alnum → `-`). */
const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

/** Best-effort `name` from the local package.json, or undefined when absent. */
const readPackageJsonName = (
  projectRoot: string,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs
      .readFileString(path.join(projectRoot, "package.json"))
      .pipe(Effect.catchAll(() => Effect.succeed("")));
    if (content.length === 0) {
      return undefined;
    }
    const parsed = yield* Effect.try((): unknown => JSON.parse(content)).pipe(
      Effect.catchAll(() => Effect.succeed(undefined)),
    );
    const name = isRecord(parsed) ? parsed["name"] : undefined;
    return typeof name === "string" && name.length > 0 ? name : undefined;
  });

/**
 * Resolve the project `name` + `slug` used to create/find the server project.
 * Expo projects derive both from the Expo config (slug is required, matching the
 * prior behavior); build-system-neutral projects derive from
 * `--name`/`--slug` > package.json `name` > directory name.
 */
const resolveNameAndSlug = (
  args: { readonly name?: string | undefined; readonly slug?: string | undefined },
  projectRoot: string,
  expoConfig: Option.Option<ExpoConfig>,
): Effect.Effect<
  { readonly name: string; readonly slug: string },
  ProjectNotLinkedError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    if (Option.isSome(expoConfig)) {
      const config = expoConfig.value;
      const slug = yield* extractSlug(config);
      return { name: config.name ?? config.slug ?? slug, slug };
    }
    const pkgName = yield* readPackageJsonName(projectRoot);
    const name = args.name ?? pkgName ?? path.basename(projectRoot);
    const slug = args.slug ?? slugify(name);
    if (slug.length === 0) {
      return yield* new ProjectNotLinkedError({
        message: "Could not derive a project slug. Pass --slug to link this project.",
      });
    }
    return { name, slug };
  });

/**
 * Persist the resolved project id: into the Expo config (`extra.betterUpdate`)
 * when an Expo project is present, otherwise into `better-update.json`.
 */
const persistLink = (projectRoot: string, projectId: string, hasExpoConfig: boolean) =>
  Effect.gen(function* () {
    if (hasExpoConfig) {
      const writeResult = yield* writeProjectId(projectRoot, projectId);
      const target = writeResult.configPath
        ? path.relative(projectRoot, writeResult.configPath)
        : "your Expo config";
      yield* printHuman(`Project linked successfully. ID saved to ${target}.`);
      if (writeResult.type === "warn" && writeResult.message) {
        yield* printHuman(`Note: ${writeResult.message}`);
      }
      return { projectId, ...compact({ configPath: writeResult.configPath }) };
    }
    const filePath = yield* writeBetterUpdateConfig(projectRoot, { projectId });
    yield* printHuman(
      `Project linked successfully. ID saved to ${path.relative(projectRoot, filePath)}.`,
    );
    return { projectId, configPath: filePath };
  });

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Link the local project to a better-update project (Expo or any build system)",
  },
  args: {
    id: {
      type: "string",
      description: "Link by explicit project ID (skips slug lookup / project creation)",
    },
    name: {
      type: "string",
      description:
        "Project name (non-Expo projects; defaults to package.json name or directory name)",
    },
    slug: {
      type: "string",
      description: "Project slug (non-Expo projects; defaults to a kebab-case of the name)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const api = yield* apiClient;
        const expoConfig = yield* readExpoConfigOptional(projectRoot);
        const hasExpoConfig = Option.isSome(expoConfig);

        // --id branch: skip slug lookup, link by explicit ID; name comes from the server.
        if (args.id !== undefined && args.id.length > 0) {
          const project = yield* api.projects.get({ path: { id: args.id } });
          yield* printHuman(`Linking project: ${project.name} (${project.id})`);
          const linked = yield* persistLink(projectRoot, project.id, hasExpoConfig);
          return { linked: true, ...linked };
        }

        const { name, slug } = yield* resolveNameAndSlug(args, projectRoot, expoConfig);
        yield* printHuman(`Linking project: ${name} (${slug})`);

        // Only an Expo config can carry a prior extra.betterUpdate.projectId link.
        if (Option.isSome(expoConfig)) {
          const linkState = yield* checkExistingLink(api, expoConfig.value, slug);
          if (linkState === "matched" || linkState === "mismatch-abort") {
            return { linked: false as const };
          }
        }

        const { items } = yield* api.projects.list({ urlParams: { page: 1, limit: 100 } });
        const existing = items.find((project) => project.slug === slug);
        const linkedProjectId = yield* Effect.gen(function* () {
          if (existing) {
            yield* printHuman(`Found existing project: ${existing.name} (${existing.id})`);
            return existing.id;
          }
          yield* printHuman("No existing project found. Creating new project...");
          const created = yield* api.projects.create({ payload: { name, slug } });
          yield* printHuman(`Created project: ${created.name} (${created.id})`);
          return created.id;
        });

        const linked = yield* persistLink(projectRoot, linkedProjectId, hasExpoConfig);
        return { linked: true, ...linked };
      }),
      { json: "value" },
    ),
});
