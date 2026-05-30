import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { listAllCredentials } from "../lib/credentials-manager";
import { printHuman, printHumanKeyValue } from "../lib/output";
import { readProjectId } from "../lib/project-link";
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

        yield* printHuman("Project");
        yield* printHuman("-------");
        yield* printHumanKeyValue([
          ["Name", project.name],
          ["ID", project.id],
          ["Slug", project.slug],
          ["Created", project.createdAt],
        ]);

        yield* printHuman("");
        yield* printHuman("Credentials");
        yield* printHuman("-----------");
        const iosCreds = credentials.filter((cred) => cred.platform === "ios").length;
        const androidCreds = credentials.filter((cred) => cred.platform === "android").length;
        yield* printHumanKeyValue([
          ["iOS", String(iosCreds)],
          ["Android", String(androidCreds)],
          ["Total", String(credentials.length)],
        ]);

        yield* printHuman("");
        yield* printHuman("Builds");
        yield* printHuman("------");
        const moreSuffix = builds.items.length < builds.total ? "+" : "";
        yield* printHumanKeyValue([
          ["Recent", `${String(builds.items.length)}${moreSuffix}`],
          ["Total", String(builds.total)],
        ]);

        return {
          project: { id: project.id, name: project.name, slug: project.slug },
          credentials: { ios: iosCreds, android: androidCreds, total: credentials.length },
          builds: { recent: builds.items.length, total: builds.total },
        };
      }),
      { json: "value" },
    ),
});
