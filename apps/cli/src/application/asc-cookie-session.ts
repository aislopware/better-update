import { Effect } from "effect";

/**
 * Cookie (Apple ID) App Store Connect session resolvers for the **Iris-only**
 * commands a JWT key cannot reach: App Review / Resolution Center, upstream ASC
 * key list/revoke, app registration, App Clip bundle-id create, sandbox testers.
 *
 * The Token counterpart (`app-store-connect.ts`) stays CI-safe; this module logs in
 * via Apple ID (2FA; `InteractiveProhibitedError` in CI) and reuses that module's
 * submit-profile + app-id resolution over the cookie context, so no stored ASC key
 * is needed.
 */
import type AppleUtils from "@expo/apple-utils";

import { AppleAuth } from "../services/apple-auth";
import { CliRuntime } from "../services/cli-runtime";
import { loadSubmitProfile, resolveAppId } from "./app-store-connect";

import type { AscCommonArgs } from "./app-store-connect";

/** A resolved cookie (Apple ID) App Store Connect session scoped to one app. */
export interface AscCookieSession {
  readonly ctx: AppleUtils.RequestContext;
  readonly appId: string;
}

/**
 * Resolve an account-scoped cookie context for the Iris-only commands that need no
 * app (ASC key list/revoke, App Clip bundle-id create, sandbox testers, app
 * registration). Returns the cookie context plus the resolved Apple ID session
 * (team name etc.).
 */
export const openCookieContext = Effect.gen(function* () {
  const auth = yield* AppleAuth;
  const session = yield* auth.ensureLoggedIn();
  return { ctx: auth.buildRequestContext(session), session };
});

/**
 * Resolve a cookie {@link AscCookieSession} for the app-scoped Iris-only commands
 * (App Review / Resolution Center). Resolves the app id the same way
 * `openAscSession` does — flag › profile `ascAppId` › `App.findAsync` by bundle id —
 * but over the cookie context.
 */
export const openCookieAppSession = (args: AscCommonArgs) =>
  Effect.gen(function* () {
    const auth = yield* AppleAuth;
    const loggedIn = yield* auth.ensureLoggedIn();
    const ctx = auth.buildRequestContext(loggedIn);
    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;
    const profile = yield* loadSubmitProfile(projectRoot, args.profile);
    const bundleId = args["bundle-identifier"] ?? profile?.bundleIdentifier;
    const appId = yield* resolveAppId({
      ctx,
      flagAppId: args["app-id"],
      profileAppId: profile?.ascAppId,
      bundleId,
    });
    return { ctx, appId } satisfies AscCookieSession;
  });
