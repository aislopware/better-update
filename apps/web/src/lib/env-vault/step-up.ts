import { stepUpPasskey } from "@better-update/api-client/react";
import { startAuthentication } from "@simplewebauthn/browser";

import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

// Same base URL as the auth client: empty in this repo, so requests resolve
// against the current origin (the worker serves `/api/auth/*` same-origin in
// prod; the Vite dev proxy forwards it in development).
// eslint-disable-next-line eslint-js/no-restricted-syntax -- Vite build-time env; empty fallback resolves to the current origin (mirrors lib/auth-client.ts)
const apiBaseUrl: string = import.meta.env.VITE_API_URL ?? "";

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
 * so the assertion is wrapped accordingly.
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
};
