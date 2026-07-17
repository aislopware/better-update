/**
 * Read-only token-vs-cookie auth planning for the Apple credential generators
 * that keep an Apple ID (cookie) fallback, e.g. `credentials generate
 * merchant-id`. Unlike `resolveSubmitProfileAscApiKeyId` this never prompts and
 * never writes back to eas.json: a configured ASC API key (flag > eas.json
 * submit profile) selects the headless token path, anything else stays on the
 * interactive cookie path exactly as before.
 */

/** How a generator should authenticate against App Store Connect. */
export type AscAuthPlan =
  | { readonly mode: "token"; readonly ascApiKeyId: string }
  | { readonly mode: "cookie" };

/**
 * Pick the auth mode from the configured key ids: flag wins over the submit
 * profile; neither means cookie. Blank/whitespace values count as absent so
 * `--asc-api-key-id ""` cannot select an empty key.
 */
export const planAscAuth = (input: {
  readonly flagKeyId?: string | undefined;
  readonly profileKeyId?: string | undefined;
}): AscAuthPlan => {
  const configured = input.flagKeyId?.trim() || input.profileKeyId?.trim();
  return configured ? { mode: "token", ascApiKeyId: configured } : { mode: "cookie" };
};

/**
 * The note printed when the token path cannot be opened (key lookup failed,
 * vault decrypt declined, ...) and the command degrades to Apple ID login.
 * Only used before anything is created on Apple — later errors surface as-is.
 */
export const tokenFallbackNote = (ascApiKeyId: string, reason: string): string =>
  `Could not authenticate with App Store Connect API key ${ascApiKeyId} (${reason}); falling back to Apple ID login.`;
