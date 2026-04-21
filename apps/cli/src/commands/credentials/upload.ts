import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

import { uploadCredential } from "../../lib/credentials-manager";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

import type { CliCredentialType } from "../../lib/credentials-manager";

const platform = Options.choice("platform", ["ios", "android"] as const);
const type = Options.choice("type", [
  "distribution-certificate",
  "provisioning-profile",
  "push-key",
  "asc-api-key",
  "keystore",
  "google-service-account-key",
] as const);
const name = Options.text("name");
const file = Options.text("file");

const password = Options.text("password").pipe(Options.optional);
const keyAlias = Options.text("key-alias").pipe(Options.optional);
const keyPassword = Options.text("key-password").pipe(Options.optional);
const keyId = Options.text("key-id").pipe(Options.optional);
const issuerId = Options.text("issuer-id").pipe(Options.optional);
const appleTeamIdentifier = Options.text("apple-team-identifier").pipe(Options.optional);

export const uploadCommand = Command.make(
  "upload",
  {
    platform,
    type,
    name,
    file,
    password,
    keyAlias,
    keyPassword,
    keyId,
    issuerId,
    appleTeamIdentifier,
  },
  (opts) =>
    Effect.gen(function* () {
      const api = yield* apiClient;

      const passwordOpt = Option.getOrUndefined(opts.password);
      const keyAliasOpt = Option.getOrUndefined(opts.keyAlias);
      const keyPasswordOpt = Option.getOrUndefined(opts.keyPassword);
      const keyIdOpt = Option.getOrUndefined(opts.keyId);
      const issuerIdOpt = Option.getOrUndefined(opts.issuerId);
      const appleTeamIdentifierOpt = Option.getOrUndefined(opts.appleTeamIdentifier);

      const input: {
        readonly platform: typeof opts.platform;
        readonly type: CliCredentialType;
        readonly name: string;
        readonly filePath: string;
        readonly password?: string;
        readonly keyAlias?: string;
        readonly keyPassword?: string;
        readonly keyId?: string;
        readonly issuerId?: string;
        readonly appleTeamIdentifier?: string;
      } = {
        platform: opts.platform,
        type: opts.type,
        name: opts.name,
        filePath: opts.file,
        ...(passwordOpt === undefined ? {} : { password: passwordOpt }),
        ...(keyAliasOpt === undefined ? {} : { keyAlias: keyAliasOpt }),
        ...(keyPasswordOpt === undefined ? {} : { keyPassword: keyPasswordOpt }),
        ...(keyIdOpt === undefined ? {} : { keyId: keyIdOpt }),
        ...(issuerIdOpt === undefined ? {} : { issuerId: issuerIdOpt }),
        ...(appleTeamIdentifierOpt === undefined
          ? {}
          : { appleTeamIdentifier: appleTeamIdentifierOpt }),
      };

      const credential = yield* uploadCredential(api, input);

      yield* Console.log("Credential uploaded successfully.");
      yield* Console.log("");
      yield* printKeyValue([
        ["ID", credential.id],
        ["Name", credential.name],
        ["Platform", credential.platform],
        ["Type", credential.type],
      ]);
    }),
);
