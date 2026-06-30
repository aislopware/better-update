/**
 * Shared error mapping for `App.createAsync` (App Store Connect app registration),
 * used by both the `app-store apps create` command and the `submit` flow's
 * ensure-app fallback. apple-utils sets the documented `APP_CREATE_*` constant on
 * the rejected error's `code` (its `message` is human text that never contains the
 * constant), so the actionable CLI hint must be keyed off `code` — read here from
 * the raw rejection before `messageOf` collapses it to the message string.
 */
import { isRecord } from "@better-update/type-guards";

import { AppleConnectError, messageOf } from "./apple-asc-connect";

/** Apple's documented `App.createAsync` rejection codes → an actionable CLI hint. */
const APP_CREATE_HINTS: Record<string, string> = {
  APP_CREATE_INSUFFICIENT_ROLE:
    'your Apple ID needs the "App Manager" or "Admin" role for this provider to create apps',
  APP_CREATE_BUNDLE_ID_NOT_REGISTERED:
    "register the bundle id in your Apple Developer account first (a build or `credentials` run does this)",
  APP_CREATE_NAME_UNAVAILABLE: "that app name is already taken on the App Store — choose another",
  APP_CREATE_NAME_INVALID: "the app name contains invalid characters",
};

/** Read the `APP_CREATE_*` code off a rejected `App.createAsync`, or `""` when absent. */
const appCreateErrorCode = (cause: unknown): string => {
  if (!isRecord(cause)) {
    return "";
  }
  const { code } = cause;
  return typeof code === "string" ? code : "";
};

/**
 * Map a rejected `App.createAsync` to an {@link AppleConnectError}, appending an
 * actionable hint for the known rejection codes (insufficient role, bundle id not
 * registered, name taken/invalid).
 */
export const mapAppCreateError = (cause: unknown): AppleConnectError => {
  const message = messageOf(cause);
  const hint = APP_CREATE_HINTS[appCreateErrorCode(cause)];
  return new AppleConnectError({
    step: "apple-create-app",
    message: hint === undefined ? message : `${message} — ${hint}.`,
  });
};
