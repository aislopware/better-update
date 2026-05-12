import { Console, Effect } from "effect";

import { revokeLocalDistributionCertificate } from "../lib/credentials-generator";
import { MissingCredentialsError } from "../lib/exit-codes";
import { printKeyValue } from "../lib/output";
import { promptConfirm, promptSelect } from "../lib/prompts";

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
