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
import { compact, toOptional } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { mapAppCreateError } from "../lib/apple-app-create-error";
import { buildTokenRequestContext, messageOf, wrapConnect } from "../lib/apple-asc-connect";
import { setSubmitProfileAscAppId } from "../lib/eas-json";
import { readExpoConfig } from "../lib/expo-config";
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
  /** Fallback name to pre-fill the prompt with (e.g. the better-update project name). */
  readonly defaultAppName: string | undefined;
  readonly sku: string | undefined;
  readonly companyName: string | undefined;
  readonly primaryLocale: string | undefined;
}

const DEFAULT_LOCALE = "en-US";

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
  companyName: string | undefined,
  input: EnsureAscAppForSubmitInput,
) =>
  Effect.tryPromise({
    try: async () =>
      AppleUtils.App.createAsync(
        cookieCtx,
        compact({
          name,
          bundleId: input.bundleIdentifier,
          sku: input.sku ?? input.bundleIdentifier,
          primaryLocale: input.primaryLocale ?? DEFAULT_LOCALE,
          companyName,
          platforms: [AppleUtils.Platform.IOS],
        }),
      ),
    catch: mapAppCreateError,
  });

/**
 * Best-effort App Store name default to pre-fill the prompt with. Prefers the
 * Expo config's `name` (app.json `expo.name`), then the passed-in fallback (the
 * better-update project name) so non-Expo projects — which have no `@expo/config`
 * — still get a sensible default. Returns `undefined` when neither is available.
 */
const resolveDefaultAppName = (input: EnsureAscAppForSubmitInput) =>
  readExpoConfig(input.projectRoot).pipe(
    Effect.map((config) => (config.name?.trim() ? config.name.trim() : undefined)),
    Effect.orElseSucceed(() => undefined),
    Effect.map((expoName) => {
      const fallback = input.defaultAppName?.trim();
      return expoName ?? (fallback || undefined);
    }),
  );

/** Reject a blank app name so the prompt re-asks instead of 500'ing `App.createAsync`. */
const requireNonEmptyName = (value: string | undefined): string | undefined =>
  value?.trim() ? undefined : "An app name is required.";

/**
 * The App Store name to create the app under. A non-empty configured `appName`
 * wins; else prompt — pre-filled with the resolved default (Expo `expo.name` or
 * the better-update project name) and *required*, so an empty Enter re-asks
 * rather than reaching `App.createAsync` with a blank name (which Apple 500s).
 */
const resolveAppName = (input: EnsureAscAppForSubmitInput) =>
  Effect.gen(function* () {
    const configured = input.appName?.trim();
    if (configured) {
      return configured;
    }
    const defaultName = yield* resolveDefaultAppName(input);
    const entered = yield* promptText(
      "App name (as shown on the App Store)",
      defaultName === undefined
        ? { placeholder: input.bundleIdentifier, validate: requireNonEmptyName }
        : { initialValue: defaultName, validate: requireNonEmptyName },
    );
    return entered.trim();
  });

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

    // Resolve a non-empty name (configured, or a required prompt pre-filled with
    // the Expo/project default) before any login — Apple 500s on a blank name.
    const name = yield* resolveAppName(input);
    if (name.length === 0) {
      yield* printHuman(
        `No app name was provided, so the App Store Connect app can't be created. Re-run and enter a name, or set submit.${input.profileName}.ios.appName in eas.json.`,
      );
      return null;
    }

    const auth = yield* AppleAuth;
    const session = yield* auth.ensureLoggedIn();
    const cookieCtx = auth.buildRequestContext(session);

    // Apple requires a company name for the FIRST app on a brand-new organization
    // account (the App Store seller name); default it to the signed-in team name.
    const companyName = input.companyName ?? toOptional(session.teamName);

    yield* printHuman("Creating the App Store Connect app via your Apple ID...");
    const app = yield* createApp(cookieCtx, name, companyName, input);
    yield* printHuman(`Created App Store Connect app "${name}" (${app.id}).`);
    yield* persist(input, app.id);
    return app.id;
  }).pipe(
    Effect.catchAll((error) =>
      printHuman(
        `Could not resolve or create the App Store Connect app (${messageOf(error)}). Continuing without it — set ascAppId in the eas.json submit profile to skip this lookup.`,
      ).pipe(Effect.as(null)),
    ),
  );
