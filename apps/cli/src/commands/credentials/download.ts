import { Args, Command } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import { apiClient } from "../../services/api-client";

const id = Args.text({ name: "id" });

export const downloadCommand = Command.make("download", { id }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const result = yield* api.credentials.download({ path: { id: opts.id } });
    const fs = yield* FileSystem.FileSystem;
    const bytes = new Uint8Array(Buffer.from(result.blob, "base64"));
    yield* fs.writeFile(result.filename, bytes);
    yield* Console.log(`Credential downloaded to "${result.filename}".`);
  }),
);
