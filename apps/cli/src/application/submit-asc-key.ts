import { Effect } from "effect";

import { messageOf } from "../lib/credentials-generator-apple-id";
import {
  defaultAscApiKeyNickname,
  generateAndUploadAscApiKeyViaAppleId,
  listAscApiKeysViaAppleId,
} from "../lib/credentials-generator-asc-key";
import { setSubmitProfileAscApiKeyId } from "../lib/eas-json";
import { InteractiveMode } from "../lib/interactive-mode";
import { printHuman } from "../lib/output";
import { promptConfirm, promptSelect } from "../lib/prompts";
import { AppleAuth } from "../services/apple-auth";

import type { AscApiKeyRole } from "../lib/credentials-generator-asc-key";
import type { ApiClient } from "../services/api-client";

export interface EnsureAscApiKeyForSubmitInput {
  readonly api: ApiClient;
  /** Project root holding `eas.json`, for persisting the resolved key id. */
  readonly projectRoot: string;
  /** Submit profile name to persist `ascApiKeyId` under. */
  readonly profileName: string;
}

const ROLE_CHOICES = [
  { value: "ADMIN" as AscApiKeyRole, label: "ADMIN (default)" },
  {
    value: "APP_MANAGER" as AscApiKeyRole,
    label: "APP_MANAGER (least privilege for app management)",
  },
];

const CREATE_CHOICE = "__create__";

/** Best-effort: write the resolved id back to eas.json so the next run reuses it. */
const persist = (input: EnsureAscApiKeyForSubmitInput, keyId: string) =>
  setSubmitProfileAscApiKeyId(input.projectRoot, input.profileName, keyId).pipe(
    Effect.flatMap((path) =>
      printHuman(`Saved ascApiKeyId to ${path} (submit profile "${input.profileName}") for reuse.`),
    ),
    Effect.catchAll((error) =>
      printHuman(
        `Note: could not write ascApiKeyId to eas.json (${error.message}). Add it manually to reuse this key.`,
      ),
    ),
  );

/** Log in, warn about any existing team keys, then (with consent) create + persist. */
const createAndPersist = (input: EnsureAscApiKeyForSubmitInput) =>
  Effect.gen(function* () {
    const auth = yield* AppleAuth;
    const session = yield* auth.ensureLoggedIn();
    const ctx = auth.buildRequestContext(session);

    // Surface keys already on the team so the user can import an existing .p8
    // instead of creating a redundant key (Apple caps keys per team).
    const teamKeys = yield* listAscApiKeysViaAppleId(ctx).pipe(Effect.orElseSucceed(() => []));
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
      hasTeamKeys
        ? "Create a new ASC API key anyway?"
        : "No App Store Connect API key found. Create one now from your Apple ID?",
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
    const created = yield* generateAndUploadAscApiKeyViaAppleId(input.api, {
      context: ctx,
      appleTeamIdentifier: session.teamId,
      nickname: defaultAscApiKeyNickname(),
      role,
    });
    yield* printHuman(`Created and stored ASC API key ${created.keyId}.`);
    yield* persist(input, created.id);
    return created.id;
  });

/**
 * Resolve an ASC API key id to upload a `submit` build with when none is set in
 * the submit profile. Reuses a stored vault key when possible (the only keys we
 * hold a usable `.p8` for), else offers to create one from the Apple ID session.
 * Returns the resolved id, or `null` when none could be resolved — non-interactive
 * runs, a declined prompt, or any failure (login/create/network) degrade to `null`
 * so the caller falls back to queuing the submission with guidance rather than
 * crashing. Persists the resolved id to `eas.json` for reuse.
 */
export const ensureAscApiKeyForSubmit = (input: EnsureAscApiKeyForSubmitInput) =>
  Effect.gen(function* () {
    const mode = yield* InteractiveMode;
    // Apple login + key creation need a TTY; CI keeps the queue-and-instruct path.
    if (!mode.allow) {
      return null;
    }

    const stored = yield* input.api.ascApiKeys.list();
    if (stored.items.length === 1) {
      const [only] = stored.items;
      if (only !== undefined) {
        yield* printHuman(`Using your stored ASC API key "${only.name}" (${only.keyId}).`);
        yield* persist(input, only.id);
        return only.id;
      }
    }
    if (stored.items.length > 1) {
      const picked = yield* promptSelect<string>(
        "No ASC API key in this submit profile. Pick one to use, or create a new one:",
        [
          ...stored.items.map((key) => ({ value: key.id, label: `${key.name} (${key.keyId})` })),
          { value: CREATE_CHOICE, label: "Create a new ASC API key from my Apple ID" },
        ],
      );
      if (picked !== CREATE_CHOICE) {
        yield* persist(input, picked);
        return picked;
      }
    }

    return yield* createAndPersist(input);
  }).pipe(
    Effect.catchAll((error) =>
      printHuman(
        `Could not set up an App Store Connect API key (${messageOf(error)}). The submission was queued — create one with \`credentials generate asc-key\` and re-run.`,
      ).pipe(Effect.as(null)),
    ),
  );
