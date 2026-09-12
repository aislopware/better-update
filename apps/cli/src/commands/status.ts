import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { listAllCredentials } from "../lib/credentials-manager";
import { printHuman, printHumanKeyValue } from "../lib/output";
import { readProjectId } from "../lib/project-link";
import { runCommand } from "../lib/run-command";
import { apiClient } from "../services/api-client";

export const statusCommand = Command.make(
  "status",
  {},
  Effect.fn(
    function* () {
      const projectId = yield* readProjectId;
      const api = yield* apiClient;

      const { project, credentials, builds } = yield* Effect.all(
        {
          project: api.projects.get({ params: { id: projectId } }),
          credentials: listAllCredentials(api),
          builds: api.builds.list({ query: { projectId } }),
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show project status (credentials, builds)"));
