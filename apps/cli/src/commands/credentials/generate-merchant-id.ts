import { compact } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_AUTH_ARGS, loadSubmitProfile } from "../../application/app-store-connect";
import { openCookieContext } from "../../application/asc-cookie-session";
import { messageOf, wrapConnect } from "../../lib/apple-asc-connect";
import { planAscAuth, tokenFallbackNote } from "../../lib/asc-auth-plan";
import { applePortalExitCodes } from "../../lib/command-errors";
import { ascKeyRequestContext } from "../../lib/credentials-generator-apple";
import { registerMerchantId } from "../../lib/credentials-generator-merchant";
import { CredentialValidationError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

const MERCHANT_ID_PATTERN = /^merchant\.[A-Za-z0-9][A-Za-z0-9.-]*$/u;

/**
 * Open the headless token context for a configured ASC API key. Merchant-id
 * registration is Apple-side only (nothing is uploaded to the vault), so no
 * `appleTeamIdentifier` is needed — the JWT's issuer selects the team. The key
 * is probed with a read-only merchant-id list BEFORE any mutation, so a key
 * that Apple rejects (revoked, insufficient role) still degrades to the cookie
 * path — the pre-change behavior — instead of failing the command. Any failure
 * here happens before anything is created on Apple.
 */
const openTokenContext = (ascApiKeyId: string) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const context = yield* ascKeyRequestContext(api, ascApiKeyId);
    // Cheap validity+permission probe: exercises the JWT against the same
    // resource the registration mutates.
    yield* wrapConnect("apple-verify-merchant-key", async () =>
      AppleUtils.MerchantId.getAsync(context, {}),
    );
    yield* printHuman("Registering Apple Pay Merchant ID via the App Store Connect API...");
    return context;
  }).pipe(
    Effect.catch((error) =>
      printHuman(tokenFallbackNote(ascApiKeyId, messageOf(error))).pipe(Effect.as(undefined)),
    ),
  );

/** Log in with the Apple ID and build the cookie context — the fallback path. */
const openCookieRegistrationContext = Effect.gen(function* () {
  const { ctx } = yield* openCookieContext;
  yield* printHuman("Registering Apple Pay Merchant ID via your Apple ID...");
  return ctx;
});

export const merchantIdCommand = Command.make(
  "merchant-id",
  {
    identifier: Flag.String("identifier").pipe(Flag.withDescription("Merchant ID (merchant.*)")),
    name: Flag.String("name").pipe(
      Flag.withDescription("Display name (defaults to the identifier)"),
      optionalFlag,
    ),
    "bundle-identifier": Flag.String("bundle-identifier").pipe(
      Flag.withDescription("App ID to enable the Apple Pay capability on"),
      optionalFlag,
    ),
    ...ASC_AUTH_ARGS,
  },
  Effect.fn(
    function* (args) {
      const identifier = args.identifier.trim();
      if (!MERCHANT_ID_PATTERN.test(identifier)) {
        return yield* new CredentialValidationError({
          message: `Merchant ID "${identifier}" must look like merchant.com.example.`,
        });
      }
      const runtime = yield* CliRuntime;
      const projectRoot = yield* runtime.cwd;
      const profile = yield* loadSubmitProfile(projectRoot, args.profile);
      const plan = planAscAuth({
        flagKeyId: args["asc-api-key-id"],
        profileKeyId: profile?.ascApiKeyId,
      });
      const tokenContext =
        plan.mode === "token" ? yield* openTokenContext(plan.ascApiKeyId) : undefined;
      // Once registration starts, errors surface as-is — no cookie retry that
      // could double-create the merchant id on Apple.
      const context = tokenContext ?? (yield* openCookieRegistrationContext);
      const created = yield* registerMerchantId({
        context,
        identifier,
        name: args.name ?? identifier,
        ...compact({ bundleIdentifier: args["bundle-identifier"] }),
      });
      yield* printHuman("Merchant ID registered.");
      yield* printHumanKeyValue([
        ["Merchant ID", created.identifier],
        ["Name", created.name],
        ["Apple identifier", created.developerPortalIdentifier],
        ["Apple Pay enabled on", created.capabilityEnabledForBundleId ?? "-"],
      ]);
      return created;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Register an Apple Pay Merchant ID (merchant.*) on the Developer Portal, optionally turning on Apple Pay for an App ID. Authenticates with a stored App Store Connect API key when one is configured (--asc-api-key-id or the eas.json submit profile's ascApiKeyId) and falls back to Apple ID login otherwise. The payment-processing certificate itself is uploaded separately with `credentials upload --type apple-pay-certificate`.",
  ),
  Command.provide(applePortalExitCodes),
);
