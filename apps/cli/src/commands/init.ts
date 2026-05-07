import path from "node:path";

import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { extractSlug, readExpoConfig, writeProjectId } from "../lib/expo-config";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";

export const initCommand = defineCommand({
  meta: { name: "init", description: "Link the local Expo project to a better-update project" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const config = yield* readExpoConfig(projectRoot);
        const name = config.name ?? config.slug ?? "untitled";
        const slug = yield* extractSlug(config);

        yield* Console.log(`Linking project: ${name} (${slug})`);

        const api = yield* apiClient;
        const { items } = yield* api.projects.list({ urlParams: { page: 1, limit: 100 } });

        const existing = items.find((project) => project.slug === slug);
        const resolveLinkedProjectId = Effect.gen(function* () {
          if (existing) {
            yield* Console.log(`Found existing project: ${existing.name} (${existing.id})`);
            return existing.id;
          }
          yield* Console.log("No existing project found. Creating new project...");
          const created = yield* api.projects.create({ payload: { name, slug } });
          yield* Console.log(`Created project: ${created.name} (${created.id})`);
          return created.id;
        });
        const linkedProjectId = yield* resolveLinkedProjectId;

        const writeResult = yield* writeProjectId(projectRoot, linkedProjectId);
        const target = writeResult.configPath
          ? path.relative(projectRoot, writeResult.configPath)
          : "your Expo config";
        yield* Console.log(`Project linked successfully. ID saved to ${target}.`);
        if (writeResult.type === "warn" && writeResult.message) {
          yield* Console.log(`Note: ${writeResult.message}`);
        }
      }),
    ),
});
