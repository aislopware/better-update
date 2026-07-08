import { Effect } from "effect";

import { messageOf } from "../lib/apple-asc-connect";
import { setSubmitProfileAscApiKeyId } from "../lib/eas-json";
import { printHuman } from "../lib/output";
import { pickOrCreateAscApiKey } from "./asc-key-resolve";

import type { ApiClient } from "../services/api-client";

export interface EnsureAscApiKeyForSubmitInput {
  readonly api: ApiClient;
  /** Project root holding `eas.json`, for persisting the resolved key id. */
  readonly projectRoot: string;
  /** Submit profile name to persist `ascApiKeyId` under. */
  readonly profileName: string;
}

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

/**
 * Resolve an ASC API key id to upload a `submit` build with when none is set in
 * the submit profile: {@link pickOrCreateAscApiKey} (team-labeled picker over
 * stored keys — never auto-picked, even a lone one — plus create-from-Apple-ID).
 * Returns the resolved id, or `null` when none could be resolved —
 * non-interactive runs, a declined prompt, or any failure (login/create/network)
 * degrade to `null` so the caller falls back to queuing the submission with
 * guidance rather than crashing. Persists the resolved id to `eas.json` for reuse.
 */
export const ensureAscApiKeyForSubmit = (input: EnsureAscApiKeyForSubmitInput) =>
  Effect.gen(function* () {
    const resolved = yield* pickOrCreateAscApiKey(
      input.api,
      "No ASC API key in this submit profile. Pick one to use, or create a new one:",
    );
    if (resolved !== null) {
      yield* persist(input, resolved);
    }
    return resolved;
  }).pipe(
    Effect.catchAll((error) =>
      printHuman(
        `Could not set up an App Store Connect API key (${messageOf(error)}). The submission was queued — create one with \`credentials generate asc-key\` and re-run.`,
      ).pipe(Effect.as(null)),
    ),
  );
