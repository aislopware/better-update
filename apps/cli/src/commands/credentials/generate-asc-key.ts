import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import {
  defaultAscApiKeyNickname,
  generateAndUploadAscApiKeyViaAppleId,
} from "../../lib/credentials-generator-asc-key";
import { CredentialValidationError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { AppleAuth } from "../../services/apple-auth";

import type { AscApiKeyRole } from "../../lib/credentials-generator-asc-key";

const ASC_KEY_EXIT_EXTRAS = {
  CredentialValidationError: 2,
  AppleIdGenerateFailedError: 6,
  AppleAuthError: 4,
  InteractiveProhibitedError: 4,
} as const;

const normalizeRole = (
  raw: string | undefined,
): Effect.Effect<AscApiKeyRole, CredentialValidationError> => {
  if (raw === undefined) {
    return Effect.succeed("ADMIN");
  }
  const upper = raw.trim().toUpperCase();
  if (upper === "ADMIN" || upper === "APP_MANAGER") {
    return Effect.succeed(upper);
  }
  return Effect.fail(
    new CredentialValidationError({
      message: `Unknown ASC API key role "${raw}". Use ADMIN or APP_MANAGER.`,
    }),
  );
};

interface AscKeyArgs {
  readonly role?: string | undefined;
  readonly name?: string | undefined;
  readonly nickname?: string | undefined;
}

export const ascKeyCommand = defineCommand({
  meta: {
    name: "asc-key",
    description:
      "Create an App Store Connect API key (.p8) directly from your Apple ID login — no manual download. Stored encrypted in your vault, it can issue certificates, sync devices, and upload builds. Requires the Account Holder to have agreed to the API Terms once under Users and Access → Integrations.",
  },
  args: {
    role: { type: "string", description: "ADMIN (default) or APP_MANAGER (least privilege)" },
    name: {
      type: "string",
      description: "Display name for the stored key (defaults to the key ID)",
    },
    nickname: {
      type: "string",
      description:
        "Nickname shown in App Store Connect (defaults to a timestamped name; Apple caps it at 30 chars, longer values are truncated)",
    },
  },
  run: async ({ args }: { readonly args: AscKeyArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const role = yield* normalizeRole(args.role);
        const api = yield* apiClient;
        const auth = yield* AppleAuth;
        const session = yield* auth.ensureLoggedIn();
        yield* printHuman("Creating an App Store Connect API key via your Apple ID...");
        const created = yield* generateAndUploadAscApiKeyViaAppleId(api, {
          context: auth.buildRequestContext(session),
          appleTeamIdentifier: session.teamId,
          nickname: args.nickname ?? defaultAscApiKeyNickname(),
          role,
          ...compact({ name: args.name }),
        });
        yield* printHuman("App Store Connect API key created and stored.");
        yield* printHumanKeyValue([
          ["ID", created.id],
          ["Key ID", created.keyId],
          ["Issuer ID", created.issuerId],
          ["Role", created.role],
        ]);
        return created;
      }),
      { exits: ASC_KEY_EXIT_EXTRAS, json: "value" },
    ),
});
