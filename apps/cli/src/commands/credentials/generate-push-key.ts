import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  createApnsKeyViaAppleId,
  defaultApnsKeyName,
} from "../../application/credentials-interactive-apple-id";
import { applePortalExitCodes } from "../../lib/command-errors";
import { uploadCredential } from "../../lib/credentials-manager";
import { CredentialValidationError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { promptSelect, promptText } from "../../lib/prompts";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

import type { ApiClient } from "../../services/api-client";

const APPLE_PUSH_KEY_PORTAL_URL = "https://developer.apple.com/account/resources/authkeys/list";
const KEY_ID_PATTERN = /^[A-Z0-9]{10}$/u;
const APPLE_TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/u;

interface PushKeyArgs {
  readonly method?: string | undefined;
  readonly "key-id"?: string | undefined;
  readonly "apple-team-id"?: string | undefined;
  readonly p8?: string | undefined;
  readonly "asc-key-id"?: string | undefined;
  readonly name?: string | undefined;
  readonly "skip-portal-hint"?: boolean | undefined;
}

type PushKeyMethod = "apple-id" | "upload";

const resolveAppleTeamFromAscKey = (api: ApiClient, ascApiKeyId: string | undefined) =>
  Effect.gen(function* () {
    if (ascApiKeyId === undefined) {
      return undefined;
    }
    const ascKeys = yield* api.ascApiKeys.list();
    const match = ascKeys.items.find((entry) => entry.id === ascApiKeyId);
    const teamId = match?.appleTeamId;
    return typeof teamId === "string" ? teamId : undefined;
  });

const validateKeyId = (value: string) =>
  KEY_ID_PATTERN.test(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new CredentialValidationError({
          message: `Push key ID "${value}" must be 10 uppercase alphanumeric characters.`,
        }),
      );

const validateAppleTeamId = (value: string) =>
  APPLE_TEAM_ID_PATTERN.test(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new CredentialValidationError({
          message: `Apple Team ID "${value}" must be 10 uppercase alphanumeric characters.`,
        }),
      );

const resolvePushKeyInput = (api: ApiClient, args: PushKeyArgs) =>
  Effect.gen(function* () {
    const derivedTeamId = yield* resolveAppleTeamFromAscKey(api, args["asc-key-id"]);

    const rawKeyId =
      args["key-id"] ?? (yield* promptText("APNs key ID (10 uppercase alphanumeric)"));
    const keyId = yield* validateKeyId(rawKeyId.trim().toUpperCase());

    const rawTeamId =
      args["apple-team-id"] ??
      derivedTeamId ??
      (yield* promptText("Apple Team identifier (10 uppercase alphanumeric)"));
    const appleTeamIdentifier = yield* validateAppleTeamId(rawTeamId.trim().toUpperCase());

    const p8Path =
      args.p8 ?? (yield* promptText("Path to the AuthKey_XXXXXXXXXX.p8 file you downloaded"));
    if (p8Path.trim().length === 0) {
      return yield* new CredentialValidationError({ message: "Missing --p8 path" });
    }

    const name = args.name ?? keyId;
    return { keyId, appleTeamIdentifier, p8Path, name };
  });

// Pick how to obtain the .p8: create a fresh key via Apple ID login (default,
// interactive) or upload one already downloaded from the portal. Passing --p8
// forces upload; non-interactive runs must use --p8 or --method=upload (Apple ID
// login needs 2FA and cannot run headless).
const resolvePushKeyMethod = (args: PushKeyArgs) =>
  Effect.gen(function* () {
    if (args.p8 !== undefined && args.p8.trim().length > 0) {
      return "upload";
    }
    if (args.method === "upload" || args.method === "apple-id") {
      return args.method;
    }
    return yield* promptSelect<PushKeyMethod>("How do you want to provide the APNs auth key?", [
      {
        value: "apple-id",
        label: "Create a new key by logging in with your Apple ID (recommended)",
      },
      { value: "upload", label: "Upload a .p8 you already downloaded from the Apple portal" },
    ]);
  });

const uploadPushKeyFromFile = (api: ApiClient, args: PushKeyArgs) =>
  Effect.gen(function* () {
    if (args["skip-portal-hint"] !== true) {
      yield* printHuman("Apple does not expose APNs key creation via the public ASC API.");
      yield* printHuman("Create the key here, download the .p8, then come back:");
      yield* printHuman(`  ${APPLE_PUSH_KEY_PORTAL_URL}`);
      yield* printHuman("");
    }
    const resolved = yield* resolvePushKeyInput(api, args);
    yield* printHuman("Uploading APNs auth key...");
    const credential = yield* uploadCredential(api, {
      platform: "ios",
      type: "push-key",
      name: resolved.name,
      filePath: resolved.p8Path,
      keyId: resolved.keyId,
      appleTeamIdentifier: resolved.appleTeamIdentifier,
    });
    yield* printHuman("APNs push key registered.");
    yield* printHumanKeyValue([
      ["ID", credential.id],
      ["Key ID", resolved.keyId],
      ["Apple team", resolved.appleTeamIdentifier],
    ]);
    return credential;
  });

export const pushKeyCommand = Command.make(
  "push-key",
  {
    method: Flag.Literals("method", ["apple-id", "upload"]).pipe(
      Flag.withDescription(
        "How to obtain the key: 'apple-id' (create via login) or 'upload' (provide --p8)",
      ),
      optionalFlag,
    ),
    "key-id": Flag.String("key-id").pipe(
      Flag.withDescription("APNs key ID — upload only (10 uppercase alphanumeric)"),
      optionalFlag,
    ),
    "apple-team-id": Flag.String("apple-team-id").pipe(
      Flag.withDescription("Apple Team identifier — upload only"),
      optionalFlag,
    ),
    p8: Flag.String("p8").pipe(
      Flag.withDescription("Path to the AuthKey_XXXXXXXXXX.p8 file (forces upload)"),
      optionalFlag,
    ),
    "asc-key-id": Flag.String("asc-key-id").pipe(
      Flag.withDescription("ASC API key ID to derive --apple-team-id automatically (upload only)"),
      optionalFlag,
    ),
    name: Flag.String("name").pipe(
      Flag.withDescription("Display name (Apple ID: key name; upload: defaults to key ID)"),
      optionalFlag,
    ),
    "skip-portal-hint": Flag.Boolean("skip-portal-hint").pipe(
      Flag.withDescription("Skip the Apple Developer portal URL hint (upload only)"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const method = yield* resolvePushKeyMethod(args);
      if (method === "upload") {
        return yield* uploadPushKeyFromFile(api, args);
      }
      yield* printHuman("Creating an APNs auth key via your Apple ID...");
      const created = yield* createApnsKeyViaAppleId(api, args.name ?? defaultApnsKeyName());
      yield* printHuman("APNs push key created and registered.");
      yield* printHumanKeyValue([
        ["ID", created.id],
        ["Key ID", created.keyId],
        ["Apple team", created.appleTeamIdentifier],
        ["Name", created.name],
      ]);
      return created;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Create an APNs auth key (.p8) by logging in with your Apple ID, or upload one you downloaded; the key is end-to-end encrypted before upload",
  ),
  Command.provide(applePortalExitCodes),
);
