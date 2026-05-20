import { compact } from "@better-update/type-guards";
import { Console, Effect } from "effect";

import { MissingCredentialsError } from "./exit-codes";

import type { ApiClient } from "../services/api-client";

type DistributionType = "APP_STORE" | "AD_HOC" | "DEVELOPMENT" | "ENTERPRISE";

export interface UpsertIosBundleConfigInput {
  readonly projectId: string;
  readonly bundleIdentifier: string;
  readonly distributionType: DistributionType;
  readonly appleTeamId: string;
  readonly appleDistributionCertificateId: string;
  readonly appleProvisioningProfileId: string;
  /** Optional — preserved on update when omitted so manual ASC bindings survive. */
  readonly ascApiKeyId?: string;
}

/**
 * Idempotent bind for an iOS bundle configuration. When the row already exists
 * (e.g. orphaned after a cert was deleted, since the FK is `ON DELETE SET NULL`),
 * rebind cert + profile in place instead of failing on the unique constraint.
 * Mirrors EAS's setup behavior where the setup step is rerunnable.
 */
export const upsertIosBundleConfiguration = (api: ApiClient, input: UpsertIosBundleConfigInput) =>
  Effect.gen(function* () {
    const list = yield* api.iosBundleConfigurations.list({
      path: { projectId: input.projectId },
    });
    const existing = list.items.find(
      (item) =>
        item.bundleIdentifier === input.bundleIdentifier &&
        item.distributionType === input.distributionType,
    );

    if (existing === undefined) {
      yield* api.iosBundleConfigurations.create({
        path: { projectId: input.projectId },
        payload: {
          bundleIdentifier: input.bundleIdentifier,
          distributionType: input.distributionType,
          appleTeamId: input.appleTeamId,
          appleDistributionCertificateId: input.appleDistributionCertificateId,
          appleProvisioningProfileId: input.appleProvisioningProfileId,
          ...compact({ ascApiKeyId: input.ascApiKeyId }),
        },
      });
      yield* Console.log("iOS bundle configuration saved.");
      return { action: "created" as const };
    }

    if (existing.appleTeamId !== input.appleTeamId) {
      return yield* new MissingCredentialsError({
        message: `Bundle "${input.bundleIdentifier}" (${input.distributionType}) is already bound to a different Apple team than the new credentials.`,
        hint: "Delete the existing bundle configuration via the dashboard before retrying with a different team.",
      });
    }

    yield* api.iosBundleConfigurations.update({
      path: { id: existing.id },
      payload: {
        appleDistributionCertificateId: input.appleDistributionCertificateId,
        appleProvisioningProfileId: input.appleProvisioningProfileId,
        ...compact({ ascApiKeyId: input.ascApiKeyId }),
      },
    });
    yield* Console.log("iOS bundle configuration rebound.");
    return { action: "updated" as const, id: existing.id };
  });
