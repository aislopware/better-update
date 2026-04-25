import { asRecord, isRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { ProjectNotLinkedError } from "./exit-codes";
import { formatCause } from "./format-error";

export const readAppJson = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const content = yield* fs
    .readFileString("./app.json")
    .pipe(
      Effect.mapError(
        () => new ProjectNotLinkedError({ message: "app.json not found in current directory" }),
      ),
    );
  const parsed = yield* Effect.try({
    try: (): unknown => JSON.parse(content),
    catch: () => new ProjectNotLinkedError({ message: "app.json contains malformed JSON" }),
  });
  if (!isRecord(parsed)) {
    return yield* new ProjectNotLinkedError({ message: "app.json must be a JSON object" });
  }
  return parsed;
});

export const readProjectId = Effect.gen(function* () {
  const appJson = yield* readAppJson;
  const expo = asRecord(appJson["expo"]);
  const extra = asRecord(expo?.["extra"]);
  const betterUpdate = asRecord(extra?.["betterUpdate"]);
  const projectId = betterUpdate?.["projectId"];

  if (typeof projectId !== "string") {
    return yield* new ProjectNotLinkedError({
      message:
        "Project not linked. Run `better-update link` to connect this project, or set expo.extra.betterUpdate.projectId in app.json.",
    });
  }

  return projectId;
});

export const readSlug = Effect.gen(function* () {
  const appJson = yield* readAppJson;
  const expo = asRecord(appJson["expo"]);
  const slug = expo?.["slug"];

  if (typeof slug !== "string") {
    return yield* new ProjectNotLinkedError({
      message: "Missing expo.slug in app.json. Required to identify the project.",
    });
  }

  return slug;
});

export const writeProjectId = (id: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const appJson = yield* readAppJson;

    const expo = asRecord(appJson["expo"]) ?? {};
    const extra = asRecord(expo["extra"]) ?? {};
    const betterUpdate = asRecord(extra["betterUpdate"]) ?? {};

    betterUpdate["projectId"] = id;
    extra["betterUpdate"] = betterUpdate;
    expo["extra"] = extra;
    appJson["expo"] = expo;

    yield* fs.writeFileString("./app.json", `${JSON.stringify(appJson, null, 2)}\n`);
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof ProjectNotLinkedError
        ? cause
        : new ProjectNotLinkedError({
            message: `Failed to write project ID to app.json: ${formatCause(cause)}`,
          }),
    ),
  );
