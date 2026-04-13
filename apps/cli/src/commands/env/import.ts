import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { apiClient } from "../../services/api-client";

const file = Args.text({ name: "file" });
const environment = Options.text("environment").pipe(Options.withDefault("production"));

export const importCommand = Command.make(
  "import",
  { file, environment },
  ({ file, environment }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const content = yield* fs.readFileString(file);

      const projectId = yield* readProjectId;
      const api = yield* apiClient;

      const result = yield* api["env-vars"].bulkImport({
        payload: { projectId, environment, content, visibility: "plaintext" },
      });

      yield* Console.log(
        `Imported: ${String(result.created)} created, ${String(result.updated)} updated, ${String(result.skipped)} skipped`,
      );
    }),
);
