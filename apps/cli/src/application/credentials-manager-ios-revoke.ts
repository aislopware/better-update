import { Console, Effect } from "effect";

import { revokeLocalDistributionCertificate } from "../lib/credentials-generator";
import { revokeLocalApnsKey } from "../lib/credentials-generator-apple-id";
import { MissingCredentialsError } from "../lib/exit-codes";
import { printKeyValue } from "../lib/output";
import { promptConfirm, promptSelect } from "../lib/prompts";
import { AppleAuth } from "../services/apple-auth";

import type { WizardContext } from "./credentials-manager-shared";

export const revokeIosDistributionCert = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const certs = yield* ctx.api.appleDistributionCertificates.list();
    if (certs.items.length === 0) {
      return yield* new MissingCredentialsError({
        message: "No distribution certificates in this account.",
        hint: "Run 'Add a new distribution certificate' to create one first.",
      });
    }
    const ascKeys = yield* ctx.api.ascApiKeys.list();
    const teamKeys = ascKeys.items.filter((entry) => entry.appleTeamId !== null);
    if (teamKeys.length === 0) {
      return yield* new MissingCredentialsError({
        message: "No ASC API key linked to an Apple team.",
        hint: "Upload an ASC API key first so the CLI can call Apple to revoke.",
      });
    }
    const localId = yield* promptSelect<string>(
      "Select a distribution certificate to revoke",
      certs.items.map((cert) => ({
        value: cert.id,
        label: `${cert.serialNumber.slice(0, 12)}… (team ${cert.appleTeamId})`,
      })),
    );
    const target = certs.items.find((entry) => entry.id === localId);
    const matchingAscKey = teamKeys.find((key) => key.appleTeamId === target?.appleTeamId);
    const ascApiKeyId =
      matchingAscKey?.id ??
      (yield* promptSelect<string>(
        "Select an ASC API key to call Apple with",
        teamKeys.map((key) => ({ value: key.id, label: `${key.name} (${key.keyId})` })),
      ));
    const keepLocal = yield* promptConfirm("Keep the certificate in this account after revoking?", {
      initialValue: false,
    });
    yield* Console.log("Calling Apple to revoke the certificate...");
    const result = yield* revokeLocalDistributionCertificate(ctx.api, {
      ascApiKeyId,
      distributionCertificateId: localId,
      keepLocal,
    });
    yield* Console.log("Revoke complete.");
    yield* printKeyValue([
      ["Local ID", result.localId],
      ["Serial", result.serialNumber],
      ["Revoked on Apple", result.revokedOnApple ? "yes" : "no (not present on portal)"],
      ["Deleted locally", result.deletedLocally ? "yes" : "no (kept)"],
    ]);
    return undefined;
  });

export const revokeIosPushKey = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const { items } = yield* ctx.api.applePushKeys.list();
    if (items.length === 0) {
      return yield* new MissingCredentialsError({
        message: "No APNs push keys in this account.",
        hint: "Run 'Add a new push key' to create one first.",
      });
    }
    const localId = yield* promptSelect<string>(
      "Select a push key to revoke",
      items.map((key) => ({ value: key.id, label: `${key.keyId} (team ${key.appleTeamId})` })),
    );
    const target = items.find((entry) => entry.id === localId);
    if (target === undefined) {
      return yield* new MissingCredentialsError({
        message: `Selected push key ${localId} not found.`,
        hint: "Re-run and pick again.",
      });
    }
    const keepLocal = yield* promptConfirm("Keep the key in this account after revoking?", {
      initialValue: false,
    });
    const auth = yield* AppleAuth;
    const session = yield* auth.ensureLoggedIn();
    yield* Console.log("Logging in to Apple and revoking the push key...");
    const result = yield* revokeLocalApnsKey(ctx.api, {
      context: auth.buildRequestContext(session),
      pushKeyId: target.id,
      keyId: target.keyId,
      keepLocal,
    });
    yield* Console.log("Revoke complete.");
    yield* printKeyValue([
      ["Local ID", result.localId],
      ["Key ID", result.keyId],
      ["Revoked on Apple", result.revokedOnApple ? "yes" : "no (not present on portal)"],
      ["Deleted locally", result.deletedLocally ? "yes" : "no (kept)"],
    ]);
    return undefined;
  });
