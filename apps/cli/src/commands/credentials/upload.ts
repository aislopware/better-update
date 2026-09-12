import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { uploadCredential } from "../../lib/credentials-manager";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
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

export const uploadCommand = Command.make(
  "upload",
  {
    platform: Flag.Literals("platform", ["ios", "android", "macos"]),
    type: Flag.Literals("type", [...CREDENTIAL_TYPES]),
    name: Flag.String("name").pipe(Flag.withDescription("Display name")),
    file: Flag.String("file").pipe(Flag.withDescription("Path to credential file")),
    password: Flag.String("password").pipe(
      Flag.withDescription("File password (keystore/p12)"),
      optionalFlag,
    ),
    "key-alias": Flag.String("key-alias").pipe(
      Flag.withDescription("Keystore alias"),
      optionalFlag,
    ),
    "key-password": Flag.String("key-password").pipe(
      Flag.withDescription("Keystore key password"),
      optionalFlag,
    ),
    "key-id": Flag.String("key-id").pipe(Flag.withDescription("ASC API key ID"), optionalFlag),
    "issuer-id": Flag.String("issuer-id").pipe(
      Flag.withDescription("ASC API issuer ID (team keys only)"),
      optionalFlag,
    ),
    "apple-team-identifier": Flag.String("apple-team-identifier").pipe(
      Flag.withDescription("Apple Team ID"),
      optionalFlag,
    ),
    "bundle-identifier": Flag.String("bundle-identifier").pipe(
      Flag.withDescription("App ID for a push certificate (else derived from the cert CN)"),
      optionalFlag,
    ),
    "merchant-identifier": Flag.String("merchant-identifier").pipe(
      Flag.withDescription("Merchant ID (merchant.*) for an Apple Pay certificate"),
      optionalFlag,
    ),
    "pass-type-identifier": Flag.String("pass-type-identifier").pipe(
      Flag.withDescription("Pass Type ID (pass.*) for a Pass Type ID certificate"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;

      const input = {
        platform: args.platform,
        type: args.type,
        name: args.name,
        filePath: args.file,
        ...compact({
          password: args.password,
          keyAlias: args["key-alias"],
          keyPassword: args["key-password"],
          keyId: args["key-id"],
          issuerId: args["issuer-id"],
          appleTeamIdentifier: args["apple-team-identifier"],
          bundleIdentifier: args["bundle-identifier"],
          merchantIdentifier: args["merchant-identifier"],
          passTypeIdentifier: args["pass-type-identifier"],
        }),
      };

      const credential = yield* uploadCredential(api, input);

      yield* printHuman("Credential uploaded successfully.");
      yield* printHuman("");
      yield* printHumanKeyValue([
        ["ID", credential.id],
        ["Name", credential.name],
        ["Platform", credential.platform],
        ["Type", credential.type],
      ]);
      return credential;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Upload a credential"));
