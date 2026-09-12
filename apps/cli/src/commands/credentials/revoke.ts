import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { applePortalExitCodes } from "../../lib/command-errors";
import { makeAppleTeamLabeler, pushKeyChoice } from "../../lib/credential-choices";
import { revokeLocalApnsKey } from "../../lib/credentials-generator-apns";
import { revokeLocalDistributionCertificate } from "../../lib/credentials-generator-apple";
import { revokeLocalAscApiKey } from "../../lib/credentials-generator-asc-key";
import { CredentialValidationError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { promptSelect } from "../../lib/prompts";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { AppleAuth } from "../../services/apple-auth";

import type { ApiClient } from "../../services/api-client";

const resolveAscKeyId = (api: ApiClient, raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw !== undefined && raw.length > 0) {
      return raw;
    }
    const keys = yield* api.ascApiKeys.list();
    if (keys.items.length === 0) {
      return yield* new CredentialValidationError({
        message: "No ASC API keys available. Upload one with `credentials upload-asc-key` first.",
      });
    }
    if (keys.items.length === 1) {
      const [only] = keys.items;
      if (only !== undefined) {
        return only.id;
      }
    }
    return yield* promptSelect<string>(
      "Select an ASC API key to revoke with",
      keys.items.map((key) => ({ value: key.id, label: `${key.name} (${key.keyId})` })),
    );
  });

const distributionCertificateCommand = Command.make(
  "distribution-certificate",
  {
    id: Flag.String("id").pipe(Flag.withDescription("Local distribution certificate ID")),
    "asc-key-id": Flag.String("asc-key-id").pipe(
      Flag.withDescription("ASC API key ID (prompts if omitted and multiple keys exist)"),
      optionalFlag,
    ),
    "keep-local": Flag.Boolean("keep-local").pipe(
      Flag.withDescription("Revoke on Apple but keep the credential in this account"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const ascApiKeyId = yield* resolveAscKeyId(api, args["asc-key-id"]);
      const result = yield* revokeLocalDistributionCertificate(api, {
        ascApiKeyId,
        distributionCertificateId: args.id,
        keepLocal: args["keep-local"],
      });
      yield* printHuman("Distribution certificate revoke complete.");
      yield* printHumanKeyValue([
        ["Local ID", result.localId],
        ["Serial", result.serialNumber],
        ["Revoked on Apple", result.revokedOnApple ? "yes" : "no (not present on portal)"],
        ["Deleted locally", result.deletedLocally ? "yes" : "no (--keep-local)"],
      ]);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Revoke an iOS distribution certificate on the Apple Developer Portal and delete it from this account",
  ),
);

const resolvePushKeyTarget = (api: ApiClient, idArg: string | undefined) =>
  Effect.gen(function* () {
    const { items } = yield* api.applePushKeys.list();
    if (items.length === 0) {
      return yield* new CredentialValidationError({
        message: "No APNs push keys stored. Nothing to revoke.",
      });
    }
    if (idArg !== undefined && idArg.length > 0) {
      const match = items.find((entry) => entry.id === idArg);
      if (match === undefined) {
        return yield* new CredentialValidationError({ message: `Push key ${idArg} not found.` });
      }
      return match;
    }
    if (items.length === 1) {
      const [only] = items;
      if (only !== undefined) {
        return only;
      }
    }
    const teamLabel = makeAppleTeamLabeler((yield* api.appleTeams.list()).items);
    const chosen = yield* promptSelect<string>(
      "Select a push key to revoke",
      items.map((key) => pushKeyChoice(key, teamLabel(key.appleTeamId))),
    );
    const match = items.find((entry) => entry.id === chosen);
    if (match === undefined) {
      return yield* new CredentialValidationError({
        message: `Selected push key ${chosen} not found after listing.`,
      });
    }
    return match;
  });

const pushKeyCommand = Command.make(
  "push-key",
  {
    id: Flag.String("id").pipe(
      Flag.withDescription("Local push key ID (prompts if omitted)"),
      optionalFlag,
    ),
    "keep-local": Flag.Boolean("keep-local").pipe(
      Flag.withDescription("Revoke on Apple but keep the credential in this account"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const target = yield* resolvePushKeyTarget(api, args.id);
      const auth = yield* AppleAuth;
      const session = yield* auth.ensureLoggedIn();
      const result = yield* revokeLocalApnsKey(api, {
        context: auth.buildRequestContext(session),
        pushKeyId: target.id,
        keyId: target.keyId,
        keepLocal: args["keep-local"],
      });
      yield* printHuman("APNs push key revoke complete.");
      yield* printHumanKeyValue([
        ["Local ID", result.localId],
        ["Key ID", result.keyId],
        ["Revoked on Apple", result.revokedOnApple ? "yes" : "no (not present on portal)"],
        ["Deleted locally", result.deletedLocally ? "yes" : "no (--keep-local)"],
      ]);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Revoke an APNs auth key on the Apple Developer Portal (via Apple ID login) and delete it from this account",
  ),
);

const ascKeyCommand = Command.make(
  "asc-key",
  {
    id: Flag.String("id").pipe(
      Flag.withDescription("Local ASC API key ID (prompts if omitted)"),
      optionalFlag,
    ),
    "keep-local": Flag.Boolean("keep-local").pipe(
      Flag.withDescription("Revoke on Apple but keep the credential in this account"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const ascApiKeyId = yield* resolveAscKeyId(api, args.id);
      const auth = yield* AppleAuth;
      const session = yield* auth.ensureLoggedIn();
      const result = yield* revokeLocalAscApiKey(api, {
        context: auth.buildRequestContext(session),
        ascApiKeyId,
        keepLocal: args["keep-local"],
      });
      yield* printHuman("App Store Connect API key revoke complete.");
      yield* printHumanKeyValue([
        ["Local ID", result.localId],
        ["Key ID", result.keyId],
        ["Revoked on Apple", result.revokedOnApple ? "yes" : "no (not present on Apple)"],
        ["Deleted locally", result.deletedLocally ? "yes" : "no (--keep-local)"],
      ]);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Revoke an App Store Connect API key on Apple (via Apple ID login) and delete it from this account",
  ),
);

export const revokeCommand = Command.make("revoke").pipe(
  Command.withDescription("Revoke credentials on the upstream provider"),
  Command.withSubcommands([distributionCertificateCommand, pushKeyCommand, ascKeyCommand]),
  Command.provide(applePortalExitCodes),
);
