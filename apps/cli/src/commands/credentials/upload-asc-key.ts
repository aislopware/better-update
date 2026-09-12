import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { uploadCredential } from "../../lib/credentials-manager";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { promptIssuerId, promptText } from "../../lib/prompts";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const uploadAscKeyCommand = Command.make(
  "upload-asc-key",
  {
    p8: Flag.String("p8").pipe(Flag.withDescription("Path to the AuthKey_XXXXXXXXXX.p8 file")),
    "key-id": Flag.String("key-id").pipe(
      Flag.withDescription("ASC key ID (10 uppercase alphanumeric)"),
      optionalFlag,
    ),
    "issuer-id": Flag.String("issuer-id").pipe(
      Flag.withDescription("ASC issuer ID (UUID) — team keys only; omit for an individual key"),
      optionalFlag,
    ),
    "apple-team-identifier": Flag.String("apple-team-identifier").pipe(
      Flag.withDescription("Apple Team identifier (optional, derived from token at first use)"),
      optionalFlag,
    ),
    name: Flag.String("name").pipe(
      Flag.withDescription("Display name (defaults to the key ID)"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const keyId = args["key-id"] ?? (yield* promptText("ASC key ID (10 uppercase alphanumeric)"));
      const issuerId = args["issuer-id"] ?? (yield* promptIssuerId());
      const name = args.name ?? keyId;
      const credential = yield* uploadCredential(api, {
        platform: "ios",
        type: "asc-api-key",
        name,
        filePath: args.p8,
        keyId,
        ...compact({ issuerId, appleTeamIdentifier: args["apple-team-identifier"] }),
      });
      yield* printHuman("ASC API key uploaded.");
      yield* printHumanKeyValue([
        ["ID", credential.id],
        ["Name", credential.name],
        ["Type", credential.type],
      ]);
      return credential;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Upload an App Store Connect API key (.p8) so the CLI can issue certificates + sync devices",
  ),
);
