import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { deleteCredential } from "../../lib/credentials-manager";
import { apiClient } from "../../services/api-client";

const id = Args.text({ name: "id" });
const platform = Options.choice("platform", ["ios", "android"] as const);
const type = Options.choice("type", [
  "distribution-certificate",
  "provisioning-profile",
  "push-key",
  "asc-api-key",
  "keystore",
  "google-service-account-key",
] as const);

export const deleteCommand = Command.make("delete", { id, platform, type }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    yield* deleteCredential(api, { id: opts.id, platform: opts.platform, type: opts.type });
    yield* Console.log(`Credential ${opts.id} deleted.`);
  }),
);
