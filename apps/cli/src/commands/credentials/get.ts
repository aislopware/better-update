import { Args, Command } from "@effect/cli";
import { Effect } from "effect";

import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

const id = Args.text({ name: "id" });

export const getCommand = Command.make("get", { id }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const credential = yield* api.credentials.get({ path: { id: opts.id } });
    yield* printKeyValue([
      ["ID", credential.id],
      ["Name", credential.name],
      ["Platform", credential.platform],
      ["Type", credential.type],
      ["Distribution", credential.distribution ?? "-"],
      ["Active", credential.isActive ? "yes" : "no"],
      ["Expires", credential.expiresAt ?? "-"],
      ["Created", credential.createdAt],
    ]);
  }),
);
