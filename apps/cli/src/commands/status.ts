import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { readProjectId } from "../lib/app-json";
import { runEffect } from "../lib/citty-effect";
import { listAllCredentials } from "../lib/credentials-manager";
import { printKeyValue } from "../lib/output";
import { apiClient } from "../services/api-client";

export const statusCommand = defineCommand({
  meta: { name: "status", description: "Show project status (credentials, builds)" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const { project, credentials, builds } = yield* Effect.all(
          {
            project: api.projects.get({ path: { id: projectId } }),
            credentials: listAllCredentials(api),
            builds: api.builds.list({ urlParams: { projectId } }),
          },
          { concurrency: "unbounded" },
        );

        yield* Console.log("Project");
        yield* Console.log("-------");
        yield* printKeyValue([
          ["Name", project.name],
          ["ID", project.id],
          ["Slug", project.slug],
          ["Created", project.createdAt],
        ]);

        yield* Console.log("");
        yield* Console.log("Credentials");
        yield* Console.log("-----------");
        const iosCreds = credentials.filter((cred) => cred.platform === "ios").length;
        const androidCreds = credentials.filter((cred) => cred.platform === "android").length;
        yield* printKeyValue([
          ["iOS", String(iosCreds)],
          ["Android", String(androidCreds)],
          ["Total", String(credentials.length)],
        ]);

        yield* Console.log("");
        yield* Console.log("Builds");
        yield* Console.log("------");
        const moreSuffix = builds.items.length < builds.total ? "+" : "";
        yield* printKeyValue([
          ["Recent", `${String(builds.items.length)}${moreSuffix}`],
          ["Total", String(builds.total)],
        ]);
      }),
    ),
});
