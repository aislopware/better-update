import { Effect } from "effect";

import type AppleUtils from "@expo/apple-utils";

import { messageOf } from "../lib/apple-asc-connect";
import { ascApiKeyChoice, makeAppleTeamLabeler } from "../lib/credential-choices";
import {
  defaultAscApiKeyNickname,
  generateAndUploadAscApiKeyViaAppleId,
  listAscApiKeysViaAppleId,
} from "../lib/credentials-generator-asc-key";
import { setSubmitProfileAscApiKeyId } from "../lib/eas-json";
import { AppStoreError } from "../lib/exit-codes";
import { InteractiveMode } from "../lib/interactive-mode";
import { printHuman } from "../lib/output";
import { promptConfirm, promptSelect } from "../lib/prompts";
import { AppleAuth } from "../services/apple-auth";

import type { AscApiKeyRole } from "../lib/credentials-generator-asc-key";
import type { ApiClient } from "../services/api-client";

/**
 * Interactive ASC-API-key resolution shared by every flow that needs a key but
 * doesn't have one configured — submit, testflight/app-store, the build
 * credential wizards, `devices sync`, and `credentials generate`. One prompt
 * vocabulary everywhere: a team-labeled picker over stored vault keys plus a
 * "create from my Apple ID" escape hatch, so a brand-new Apple team can
 * bootstrap without leaving the command.
 */

const ROLE_CHOICES = [
  { value: "ADMIN" as AscApiKeyRole, label: "ADMIN (default)" },
  {
    value: "APP_MANAGER" as AscApiKeyRole,
    label: "APP_MANAGER (least privilege for app management)",
  },
];

export const CREATE_ASC_KEY_CHOICE = "__create__";

/**
 * Create an ASC API key from an ALREADY-OPEN Apple ID cookie session — warns
 * about keys the team already holds (a `.p8` downloads only once and Apple caps
 * keys per team), asks for consent + role, then creates, seals, and uploads.
 * Returns `null` when the user declines.
 */
export const createAscKeyFromSession = (
  api: ApiClient,
  params: {
    readonly ctx: AppleUtils.RequestContext;
    /** 10-char Apple Developer Team ID of the logged-in session. */
    readonly appleTeamIdentifier: string;
    /** Consent prompt; defaults to a generic create question. */
    readonly confirmMessage?: string;
  },
) =>
  Effect.gen(function* () {
    // Surface keys already on the team so the user can import an existing .p8
    // instead of creating a redundant key.
    const teamKeys = yield* listAscApiKeysViaAppleId(params.ctx).pipe(
      Effect.orElseSucceed(() => []),
    );
    const hasTeamKeys = teamKeys.length > 0;
    if (hasTeamKeys) {
      yield* printHuman(
        `Your Apple team already has ${String(teamKeys.length)} App Store Connect API key(s): ${teamKeys
          .map((key) => key.nickname)
          .join(", ")}.`,
      );
      yield* printHuman(
        "A key's .p8 is downloadable only once at creation, so an existing key is reusable only if you still have its .p8 (import it with `credentials upload-asc-key`). Apple also caps the number of keys per team.",
      );
    }
    const proceed = yield* promptConfirm(
      params.confirmMessage ??
        (hasTeamKeys
          ? "Create a new ASC API key anyway?"
          : "No App Store Connect API key found. Create one now from your Apple ID?"),
      { initialValue: !hasTeamKeys },
    );
    if (!proceed) {
      return null;
    }

    const role = yield* promptSelect<AscApiKeyRole>(
      "Select a role for the generated API key",
      ROLE_CHOICES,
    );
    yield* printHuman("Creating an App Store Connect API key via your Apple ID...");
    const created = yield* generateAndUploadAscApiKeyViaAppleId(api, {
      context: params.ctx,
      appleTeamIdentifier: params.appleTeamIdentifier,
      nickname: defaultAscApiKeyNickname(),
      role,
    });
    yield* printHuman(`Created and stored ASC API key ${created.keyId}.`);
    return created;
  });

/** Log in with the Apple ID (2FA) and run {@link createAscKeyFromSession}. */
export const createAscKeyViaLogin = (api: ApiClient, confirmMessage?: string) =>
  Effect.gen(function* () {
    const auth = yield* AppleAuth;
    const session = yield* auth.ensureLoggedIn();
    return yield* createAscKeyFromSession(api, {
      ctx: auth.buildRequestContext(session),
      appleTeamIdentifier: session.teamId,
      ...(confirmMessage === undefined ? {} : { confirmMessage }),
    });
  });

/**
 * Resolve an ASC API key id interactively: a team-labeled picker over every
 * stored vault key (a lone key is never auto-picked — it may belong to a
 * different Apple team than the target) plus a create-from-Apple-ID option.
 * With no stored keys it goes straight to the create flow. Returns the key id,
 * or `null` when non-interactive or the user declines.
 */
export const pickOrCreateAscApiKey = (api: ApiClient, promptMessage?: string) =>
  Effect.gen(function* () {
    const mode = yield* InteractiveMode;
    // Apple login + key creation need a TTY; CI callers keep their error paths.
    if (!mode.allow) {
      return null;
    }

    const stored = yield* api.ascApiKeys.list();
    if (stored.items.length === 0) {
      const created = yield* createAscKeyViaLogin(api);
      return created === null ? null : created.id;
    }

    const teamLabel = makeAppleTeamLabeler((yield* api.appleTeams.list()).items);
    const picked = yield* promptSelect<string>(
      promptMessage ?? "No ASC API key configured. Pick one to use, or create a new one:",
      [
        ...stored.items.map((key) =>
          ascApiKeyChoice(key, key.appleTeamId === null ? undefined : teamLabel(key.appleTeamId)),
        ),
        { value: CREATE_ASC_KEY_CHOICE, label: "Create a new ASC API key from my Apple ID" },
      ],
    );
    if (picked !== CREATE_ASC_KEY_CHOICE) {
      return picked;
    }
    const created = yield* createAscKeyViaLogin(api);
    return created === null ? null : created.id;
  });

/**
 * Resolve the ASC API key id for the eas.json-driven command groups
 * (`testflight` / `app-store`): flag > profile > interactive team-labeled picker
 * (plus create-from-Apple-ID) — never a silent lone-key auto-pick, which grabs
 * the wrong team's key as soon as the org spans several Apple teams. A picked id
 * is written back to the eas.json submit profile; non-interactive runs fail with
 * guidance as before.
 */
export const resolveSubmitProfileAscApiKeyId = (params: {
  readonly api: ApiClient;
  readonly flagKeyId: string | undefined;
  readonly profileKeyId: string | undefined;
  readonly projectRoot: string;
  readonly profileName: string;
}) =>
  Effect.gen(function* () {
    const preset = params.flagKeyId ?? params.profileKeyId;
    if (preset !== undefined) {
      return preset;
    }
    const picked = yield* pickOrCreateAscApiKey(
      params.api,
      "No ASC API key configured for this submit profile. Pick one to use, or create a new one:",
    ).pipe(
      Effect.catchAll((error) =>
        printHuman(`Could not resolve an App Store Connect API key: ${messageOf(error)}`).pipe(
          Effect.as(null),
        ),
      ),
    );
    if (picked !== null) {
      // Best-effort: a failed write only costs re-picking next run.
      yield* setSubmitProfileAscApiKeyId(params.projectRoot, params.profileName, picked).pipe(
        Effect.flatMap((path) =>
          printHuman(`Saved ascApiKeyId to ${path} (submit profile "${params.profileName}").`),
        ),
        Effect.catchAll(() => Effect.void),
      );
      return picked;
    }
    return yield* new AppStoreError({
      message:
        "No App Store Connect API key configured. Create one with `better-update credentials generate asc-key`, pass --asc-api-key-id, or set ascApiKeyId on the eas.json submit profile.",
    });
  });
