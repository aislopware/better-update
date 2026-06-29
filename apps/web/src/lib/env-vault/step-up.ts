import { WEB_ENV_STEP_UP_REQUIRED_MESSAGE, WEB_ENV_STEP_UP_TTL_MS } from "@better-update/api";
import { getTypedApiError } from "@better-update/api-client";
import { stepUpPasskey } from "@better-update/api-client/react";
import { startAuthentication } from "@simplewebauthn/browser";

import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

// Same base URL as the auth client: empty in this repo, so requests resolve
// against the current origin (the worker serves `/api/auth/*` same-origin in
// prod; the Vite dev proxy forwards it in development).
// eslint-disable-next-line eslint-js/no-restricted-syntax -- Vite build-time env; empty fallback resolves to the current origin (mirrors lib/auth-client.ts)
const apiBaseUrl: string = import.meta.env.VITE_API_URL ?? "";

// The server expires a step-up after WEB_ENV_STEP_UP_TTL_MS (10 min). The browser
// mirrors that window — minus a safety margin — so it can re-prompt the passkey
// *proactively* (and never present a stale-but-looks-fresh state) rather than
// waiting to bounce off a server 403. The margin absorbs clock skew + request
// latency so the client errs toward re-verifying slightly early.
const STEP_UP_SAFETY_MARGIN_MS = 30 * 1000;
const STEP_UP_FRESH_MS = WEB_ENV_STEP_UP_TTL_MS - STEP_UP_SAFETY_MARGIN_MS;

// Session-scoped (the server keys the step-up by session, not by org), so a single
// key tracks freshness across every org/dialog in this tab. sessionStorage ONLY —
// cleared on tab close, mirroring the unlocked-key cache (see ./cache).
const STEP_UP_VERIFIED_AT_KEY = "bu.env-vault.step-up-verified-at";

// The env-vault routes are client-only (ssr:false), so sessionStorage is always
// present here — no SSR guard needed (mirrors ./cache).

/** Record that a step-up just succeeded, starting the client-side freshness window. */
const markStepUpVerified = (): void => {
  globalThis.sessionStorage.setItem(STEP_UP_VERIFIED_AT_KEY, String(Date.now()));
};

/** Forget the recorded step-up (called when the vault is locked). */
export const clearStepUp = (): void => {
  globalThis.sessionStorage.removeItem(STEP_UP_VERIFIED_AT_KEY);
};

/**
 * Whether the browser believes a server step-up is still valid (within the
 * mirrored TTL minus the safety margin). A best-effort hint to decide whether to
 * re-prompt proactively; the server stays the source of truth, so callers still
 * handle a `isStepUpRequiredError` rejection (see `performStepUpGatedWrite`).
 */
export const isStepUpFresh = (): boolean => {
  const raw = globalThis.sessionStorage.getItem(STEP_UP_VERIFIED_AT_KEY);
  if (raw === null) {
    return false;
  }
  const verifiedAtMs = Number(raw);
  return Number.isFinite(verifiedAtMs) && Date.now() - verifiedAtMs < STEP_UP_FRESH_MS;
};

const isOptionsJSON = (value: unknown): value is PublicKeyCredentialRequestOptionsJSON =>
  typeof value === "object" &&
  value !== null &&
  "challenge" in value &&
  typeof value.challenge === "string";

/**
 * Run a WebAuthn step-up against the current cookie session and record it
 * server-side, so the env-vault endpoints (account-key escrow download, value
 * reveal, and value CRUD) accept this browser session for the next few minutes.
 *
 * The better-auth passkey client only exposes a full *sign-in* ceremony, which
 * would mint a fresh session and skip our owner-binding check, so the assertion
 * is driven manually here:
 *   1. GET the challenge options better-auth issues (it scopes `allowCredentials`
 *      to the current session user's passkeys and sets the signed challenge
 *      cookie at path `/`, so it is also sent to `/api/web-vault/step-up`),
 *   2. run the browser ceremony with `@simplewebauthn/browser`,
 *   3. POST the raw assertion to `/api/web-vault/step-up`, which verifies it AND
 *      binds the verified passkey to this session's user before recording it.
 *
 * The server reads `body.response` (better-auth's verify-authentication shape),
 * so the assertion is wrapped accordingly. On success the freshness window is
 * recorded client-side so callers can avoid an avoidable re-prompt.
 */
export const runPasskeyStepUp = async (): Promise<void> => {
  const response = await fetch(`${apiBaseUrl}/api/auth/passkey/generate-authenticate-options`, {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  const optionsJSON: unknown = response.ok ? await response.json() : null;
  if (!isOptionsJSON(optionsJSON)) {
    // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject -- surfaces a failed challenge fetch to the mutation layer (toasted by useApiMutation)
    throw new Error("Could not start passkey verification.");
  }
  const assertion = await startAuthentication({ optionsJSON });
  await stepUpPasskey(JSON.stringify({ response: assertion }));
  markStepUpVerified();
};

/** Run a passkey step-up only if the client window has lapsed; otherwise a no-op. */
const ensureStepUp = async (): Promise<void> => {
  if (isStepUpFresh()) {
    return;
  }
  await runPasskeyStepUp();
};

/**
 * Whether `error` is the server's "step-up required" rejection (vs an unrelated
 * permission `Forbidden`). Matched against the shared message so the browser can
 * recover by re-prompting the passkey instead of dead-ending on the text.
 */
export const isStepUpRequiredError = (error: unknown): boolean => {
  const typed = getTypedApiError(error);
  return typed?._tag === "Forbidden" && typed.message === WEB_ENV_STEP_UP_REQUIRED_MESSAGE;
};

/**
 * Run a step-up-gated env-value write from a user gesture: refresh the step-up if
 * the client window lapsed (so the WebAuthn prompt fires inside the click rather
 * than after an async 403), then perform the write. If the server still rejects
 * for a stale step-up — its record lapsed within our safety margin, or the session
 * rotated — mark the client stale so the next click re-verifies.
 */
export const performStepUpGatedWrite = async <T>(write: () => Promise<T>): Promise<T> => {
  await ensureStepUp();
  // eslint-disable-next-line functional/no-try-statements -- resync client step-up state on the server's authoritative rejection, then rethrow for useApiMutation to toast
  try {
    return await write();
  } catch (error: unknown) {
    if (isStepUpRequiredError(error)) {
      clearStepUp();
    }
    // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject -- rethrow the server's original rejection; it is the mutation's error channel (useApiMutation toasts it)
    throw error;
  }
};
