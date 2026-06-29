import { Schema } from "effect";

/**
 * A WebAuthn authentication assertion, JSON-stringified by the browser
 * (`@better-auth/passkey/client` drives `navigator.credentials.get()`), carried
 * as a single string so the wire payload stays a plain object with no opaque
 * `unknown` fields. The step-up handler parses it and hands it to better-auth's
 * `verifyPasskeyAuthentication`; the exact inner shape is the plugin's contract,
 * not ours.
 */
export const PasskeyStepUpBody = Schema.Struct({
  assertionJson: Schema.String,
});

/**
 * Result of a successful step-up: the ISO instant the server recorded, which the
 * env-vault gate now treats as the start of the step-up TTL window for this
 * session.
 */
export const PasskeyStepUpResult = Schema.Struct({
  verifiedAt: Schema.String,
});
