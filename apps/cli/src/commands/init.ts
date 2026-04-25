import { asRecord } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { readAppJson, readSlug, writeProjectId } from "../lib/app-json";
import { asString } from "../lib/build-profile";
import { runEffect } from "../lib/citty-effect";
import { apiClient } from "../services/api-client";

export const initCommand = defineCommand({
  meta: { name: "init", description: "Link the local Expo project to a better-update project" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const appJson = yield* readAppJson;
        const expo = asRecord(appJson["expo"]);
        const name = asString(expo?.["name"]) ?? asString(expo?.["slug"]) ?? "untitled";
        const slug = yield* readSlug;

        yield* Console.log(`Linking project: ${name} (${slug})`);

        const api = yield* apiClient;
        const { items } = yield* api.projects.list({ urlParams: { page: 1, limit: 100 } });

        const existing = items.find((project) => project.slug === slug);

        if (existing) {
          yield* Console.log(`Found existing project: ${existing.name} (${existing.id})`);
          yield* writeProjectId(existing.id);
        } else {
          yield* Console.log("No existing project found. Creating new project...");
          const project = yield* api.projects.create({ payload: { name, slug } });
          yield* Console.log(`Created project: ${project.name} (${project.id})`);
          yield* writeProjectId(project.id);
        }

        yield* Console.log("Project linked successfully. ID saved to app.json.");
      }),
    ),
});
