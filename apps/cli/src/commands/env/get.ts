import { Args, Command } from "@effect/cli";
import { Effect } from "effect";

import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleEnvCommandErrors } from "./helpers";

const id = Args.text({ name: "id" });

export const getCommand = Command.make("get", { id }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const envVar = yield* api["env-vars"].get({ path: { id: opts.id } });
    yield* printKeyValue([
      ["ID", envVar.id],
      ["Key", envVar.key],
      ["Environment", envVar.environment],
      ["Visibility", envVar.visibility],
      ["Value", envVar.visibility === "plaintext" ? (envVar.value ?? "") : "******"],
      ["Created", envVar.createdAt],
      ["Updated", envVar.updatedAt],
    ]);
  }).pipe(handleEnvCommandErrors),
);
