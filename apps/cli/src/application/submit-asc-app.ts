/**
 * Resolve (and, with consent, create) the App Store Connect app record a `submit`
 * needs for TestFlight config. EAS's `ensureAppExists` equivalent: look the app up
 * headlessly via the vault `.p8` (no Apple login when it already exists), and only
 * when it's missing fall back to an interactive `App.createAsync` from the Apple ID
 * cookie session. The resolved `ascAppId` is persisted to `eas.json` for reuse.
 *
 * Returns the app id, or `null` when none could be resolved — non-interactive runs,
 * a declined prompt, or any failure (login/create/network) degrade to `null` so the
 * caller queues the submission with guidance rather than crashing.
 */
import { compact } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import {
  AppleConnectError,
  buildTokenRequestContext,
  messageOf,
  wrapConnect,
} from "../lib/apple-asc-connect";
import { setSubmitProfileAscAppId } from "../lib/eas-json";
import { InteractiveMode } from "../lib/interactive-mode";
import { printHuman } from "../lib/output";
import { promptConfirm, promptText } from "../lib/prompts";
import { AppleAuth } from "../services/apple-auth";

import type { AscCredentials } from "../lib/asc-credentials";

export interface EnsureAscAppForSubmitInput {
  /** Already-decrypted ASC `.p8`, for the headless app lookup. */
  readonly credentials: AscCredentials;
  /** Project root holding `eas.json`, for persisting the resolved app id. */
  readonly projectRoot: string;
  /** Submit profile name to persist `ascAppId` under. */
  readonly profileName: string;
  readonly bundleIdentifier: string;
  readonly appName: string | undefined;
  readonly sku: string | undefined;
  readonly companyName: string | undefined;
  readonly primaryLocale: string | undefined;
}

const DEFAULT_LOCALE = "en-US";

/** Apple's documented `App.createAsync` rejections → an actionable hint. */
const APP_CREATE_HINTS: Record<string, string> = {
  APP_CREATE_INSUFFICIENT_ROLE:
    'your Apple ID needs the "App Manager" or "Admin" role for this provider to create apps',
  APP_CREATE_BUNDLE_ID_NOT_REGISTERED:
    "register the bundle id in your Apple Developer account first (a build or `credentials` run does this)",
  APP_CREATE_NAME_UNAVAILABLE: "that app name is already taken on the App Store — choose another",
  APP_CREATE_NAME_INVALID: "the app name contains invalid characters",
};

/** Best-effort: write the resolved id back to eas.json so the next run reuses it. */
const persist = (input: EnsureAscAppForSubmitInput, ascAppId: string) =>
  setSubmitProfileAscAppId(input.projectRoot, input.profileName, ascAppId).pipe(
    Effect.flatMap((path) =>
      printHuman(`Saved ascAppId to ${path} (submit profile "${input.profileName}") for reuse.`),
    ),
    Effect.catchAll((error) =>
      printHuman(
        `Note: could not write ascAppId to eas.json (${error.message}). Add it manually to reuse it.`,
      ),
    ),
  );

const createApp = (
  cookieCtx: AppleUtils.RequestContext,
  name: string,
  input: EnsureAscAppForSubmitInput,
) =>
  wrapConnect("apple-create-app", async () =>
    AppleUtils.App.createAsync(
      cookieCtx,
      compact({
        name,
        bundleId: input.bundleIdentifier,
        sku: input.sku ?? input.bundleIdentifier,
        primaryLocale: input.primaryLocale ?? DEFAULT_LOCALE,
        companyName: input.companyName,
        platforms: [AppleUtils.Platform.IOS],
      }),
    ),
  ).pipe(
    Effect.mapError((error) => {
      const hint = Object.entries(APP_CREATE_HINTS).find(([code]) => error.message.includes(code));
      return hint === undefined
        ? error
        : new AppleConnectError({ step: error.step, message: `${error.message} — ${hint[1]}.` });
    }),
  );

export const ensureAscAppForSubmit = (input: EnsureAscAppForSubmitInput) =>
  Effect.gen(function* () {
    const ctx = buildTokenRequestContext(input.credentials);
    // Headless lookup first — an existing app resolves with no Apple login.
    const existing = yield* wrapConnect("apple-find-app", async () =>
      AppleUtils.App.findAsync(ctx, { bundleId: input.bundleIdentifier }),
    );
    if (existing !== null) {
      yield* persist(input, existing.id);
      return existing.id;
    }

    const mode = yield* InteractiveMode;
    // Creating an app needs an Apple ID login (TTY + 2FA); CI keeps the guidance path.
    if (!mode.allow) {
      yield* printHuman(
        `No App Store Connect app exists for bundle id ${input.bundleIdentifier}. Set ascAppId in the eas.json submit profile, or re-run interactively to create it.`,
      );
      return null;
    }

    const proceed = yield* promptConfirm(
      `No App Store Connect app exists for bundle id ${input.bundleIdentifier}. Create it now from your Apple ID?`,
      { initialValue: true },
    );
    if (!proceed) {
      return null;
    }

    const name =
      input.appName ??
      (yield* promptText("App name (as shown on the App Store)", {
        placeholder: input.bundleIdentifier,
      }));

    const auth = yield* AppleAuth;
    const session = yield* auth.ensureLoggedIn();
    const cookieCtx = auth.buildRequestContext(session);

    yield* printHuman("Creating the App Store Connect app via your Apple ID...");
    const app = yield* createApp(cookieCtx, name, input);
    yield* printHuman(`Created App Store Connect app "${name}" (${app.id}).`);
    yield* persist(input, app.id);
    return app.id;
  }).pipe(
    Effect.catchAll((error) =>
      printHuman(
        `Could not resolve or create the App Store Connect app (${messageOf(error)}). The submission was queued — set ascAppId in eas.json and re-run.`,
      ).pipe(Effect.as(null)),
    ),
  );
