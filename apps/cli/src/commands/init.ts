import { Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { readAppJson, readSlug, writeProjectId } from "../lib/app-json";
import { asString } from "../lib/build-profile";
import { apiClient } from "../services/api-client";

export const initCommand = Command.make("init", {}, () =>
  Effect.gen(function* () {
    const appJson = yield* readAppJson;
    const expo = appJson["expo"] as Record<string, unknown> | undefined;
    const name = asString(expo?.["name"]) ?? asString(expo?.["slug"]) ?? "untitled";
    const slug = yield* readSlug;

    yield* Console.log(`Linking project: ${name} (${slug})`);

    const api = yield* apiClient;
    const { items } = yield* api.projects.list({ urlParams: { page: 1, limit: 100 } });

    const existing = items.find((p) => p.slug === slug);

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
);
