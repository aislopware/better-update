import { Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { readProjectId } from "../lib/app-json";
import { printKeyValue } from "../lib/output";
import { apiClient } from "../services/api-client";

export const statusCommand = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const { project, credentials, builds } = yield* Effect.all(
      {
        project: api.projects.get({ path: { id: projectId } }),
        credentials: api.credentials.list({ urlParams: { projectId } }),
        builds: api.builds.list({ urlParams: { projectId } }),
      },
      { concurrency: "unbounded" },
    );

    yield* Console.log("Project");
    yield* Console.log("-------");
    yield* printKeyValue([
      ["Name", project.name],
      ["ID", project.id],
      ["Scope Key", project.scopeKey],
      ["Created", project.createdAt],
    ]);

    yield* Console.log("");
    yield* Console.log("Credentials");
    yield* Console.log("-----------");
    const iosCreds = credentials.items.filter((c) => c.platform === "ios").length;
    const androidCreds = credentials.items.filter((c) => c.platform === "android").length;
    yield* printKeyValue([
      ["iOS", String(iosCreds)],
      ["Android", String(androidCreds)],
      ["Total", String(credentials.total)],
    ]);

    yield* Console.log("");
    yield* Console.log("Builds");
    yield* Console.log("------");
    yield* printKeyValue([["Total", String(builds.total)]]);
  }),
);
