import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { deleteCredential } from "../../lib/credentials-manager";
import { printHuman } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

const CREDENTIAL_TYPES = [
  "distribution-certificate",
  "macos-certificate",
  "provisioning-profile",
  "push-key",
  "push-certificate",
  "apple-pay-certificate",
  "pass-type-certificate",
  "asc-api-key",
  "keystore",
  "google-service-account-key",
] as const;

export const deleteCommand = Command.make(
  "delete",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Credential ID")),
    platform: Flag.Literals("platform", ["ios", "android", "macos"]),
    type: Flag.Literals("type", [...CREDENTIAL_TYPES]),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      yield* deleteCredential(api, {
        id: args.id,
        platform: args.platform,
        type: args.type,
      });
      yield* printHuman(`Credential ${args.id} deleted.`);
      return { id: args.id, platform: args.platform, type: args.type, deleted: true };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Delete a credential"));
