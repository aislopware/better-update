import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  createApnsKeyViaAppleId,
  defaultApnsKeyName,
} from "../../application/credentials-interactive-apple-id";
import { runEffect } from "../../lib/citty-effect";
import { uploadCredential } from "../../lib/credentials-manager";
import { CredentialValidationError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { promptSelect, promptText } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";

import type { ApiClient } from "../../services/api-client";

const PUSH_KEY_EXIT_EXTRAS = {
  CredentialValidationError: 2,
  AppleIdGenerateFailedError: 6,
  ApnsKeyLimitError: 6,
  AppleAuthError: 4,
  InteractiveProhibitedError: 4,
} as const;

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
      return "upload" as PushKeyMethod;
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

export const pushKeyCommand = defineCommand({
  meta: {
    name: "push-key",
    description:
      "Create an APNs auth key (.p8) by logging in with your Apple ID, or upload one you downloaded; the key is end-to-end encrypted before upload",
  },
  args: {
    method: {
      type: "enum",
      options: ["apple-id", "upload"],
      description:
        "How to obtain the key: 'apple-id' (create via login) or 'upload' (provide --p8)",
    },
    "key-id": {
      type: "string",
      description: "APNs key ID — upload only (10 uppercase alphanumeric)",
    },
    "apple-team-id": { type: "string", description: "Apple Team identifier — upload only" },
    p8: { type: "string", description: "Path to the AuthKey_XXXXXXXXXX.p8 file (forces upload)" },
    "asc-key-id": {
      type: "string",
      description: "ASC API key ID to derive --apple-team-id automatically (upload only)",
    },
    name: {
      type: "string",
      description: "Display name (Apple ID: key name; upload: defaults to key ID)",
    },
    "skip-portal-hint": {
      type: "boolean",
      description: "Skip the Apple Developer portal URL hint (upload only)",
    },
  },
  run: async ({ args }: { readonly args: PushKeyArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: PUSH_KEY_EXIT_EXTRAS, json: "value" },
    ),
});
