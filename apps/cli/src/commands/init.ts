import path from "node:path";

import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { extractSlug, readExpoConfig, writeProjectId } from "../lib/expo-config";
import { InteractiveMode } from "../lib/interactive-mode";
import { printHuman } from "../lib/output";
import { promptConfirm } from "../lib/prompts";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";

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

const writeAndAnnounce = (projectRoot: string, projectId: string) =>
  Effect.gen(function* () {
    const writeResult = yield* writeProjectId(projectRoot, projectId);
    const target = writeResult.configPath
      ? path.relative(projectRoot, writeResult.configPath)
      : "your Expo config";
    yield* printHuman(`Project linked successfully. ID saved to ${target}.`);
    if (writeResult.type === "warn" && writeResult.message) {
      yield* printHuman(`Note: ${writeResult.message}`);
    }
    return { projectId, ...compact({ configPath: writeResult.configPath }) };
  });

export const initCommand = defineCommand({
  meta: { name: "init", description: "Link the local Expo project to a better-update project" },
  args: {
    id: {
      type: "string",
      description: "Link by explicit project ID (skips slug lookup / project creation)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const config = yield* readExpoConfig(projectRoot);
        const name = config.name ?? config.slug ?? "untitled";
        const api = yield* apiClient;

        // --id branch: skip slug lookup, link by explicit ID.
        if (args.id !== undefined && args.id.length > 0) {
          const project = yield* api.projects.get({ path: { id: args.id } });
          yield* printHuman(`Linking project: ${project.name} (${project.id})`);
          const linked = yield* writeAndAnnounce(projectRoot, project.id);
          return { linked: true, ...linked };
        }

        const slug = yield* extractSlug(config);
        yield* printHuman(`Linking project: ${name} (${slug})`);

        const linkState = yield* checkExistingLink(api, config, slug);
        if (linkState === "matched" || linkState === "mismatch-abort") {
          return { linked: false as const };
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

        const linked = yield* writeAndAnnounce(projectRoot, linkedProjectId);
        return { linked: true, ...linked };
      }),
      { json: "value" },
    ),
});
