import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { ProjectNotLinkedError } from "./exit-codes";

export const readAppJson = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const content = yield* fs
    .readFileString("./app.json")
    .pipe(
      Effect.mapError(
        () => new ProjectNotLinkedError({ message: "app.json not found in current directory" }),
      ),
    );
  return yield* Effect.try({
    try: () => JSON.parse(content) as Record<string, unknown>,
    catch: () => new ProjectNotLinkedError({ message: "app.json contains malformed JSON" }),
  });
});

export const readProjectId = Effect.gen(function* () {
  const appJson = yield* readAppJson;
  const expo = appJson["expo"] as Record<string, unknown> | undefined;
  const extra = expo?.["extra"] as Record<string, unknown> | undefined;
  const betterUpdate = extra?.["betterUpdate"] as Record<string, unknown> | undefined;
  const projectId = betterUpdate?.["projectId"];

  if (typeof projectId !== "string") {
    return yield* new ProjectNotLinkedError({
      message:
        "Project not linked. Run `better-update link` to connect this project, or set expo.extra.betterUpdate.projectId in app.json.",
    });
  }

  return projectId;
});

export const readScopeKey = Effect.gen(function* () {
  const appJson = yield* readAppJson;
  const expo = appJson["expo"] as Record<string, unknown> | undefined;
  const owner = expo?.["owner"];
  const slug = expo?.["slug"];

  if (typeof owner !== "string" || typeof slug !== "string") {
    return yield* new ProjectNotLinkedError({
      message:
        "Missing expo.owner or expo.slug in app.json. Both are required to compute the scope key.",
    });
  }

  return `@${owner}/${slug}`;
});

export const writeProjectId = (id: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const appJson = yield* readAppJson;

    const expo = (appJson["expo"] ?? {}) as Record<string, unknown>;
    const extra = (expo["extra"] ?? {}) as Record<string, unknown>;
    const betterUpdate = (extra["betterUpdate"] ?? {}) as Record<string, unknown>;

    betterUpdate["projectId"] = id;
    extra["betterUpdate"] = betterUpdate;
    expo["extra"] = extra;
    appJson["expo"] = expo;

    yield* fs.writeFileString("./app.json", `${JSON.stringify(appJson, null, 2)}\n`);
  }).pipe(Effect.orDie);
