import { Effect } from "effect";

import { MissingCredentialsError } from "../../lib/exit-codes";

import type { IosDistribution } from "../../lib/build-profile";
import type { ApiClient } from "../../services/api-client";

const pendingMigrationHint =
  "Provision credentials via the dashboard (Credentials + iOS Bundle Configurations) until the CLI provisioning flow is rewritten.";

export const provisionIosCredentials = (_params: {
  readonly api: ApiClient;
  readonly projectId: string;
  readonly distribution: IosDistribution;
  readonly bundleIdentifier: string;
  readonly appName: string;
}): Effect.Effect<void, MissingCredentialsError> =>
  Effect.fail(
    new MissingCredentialsError({
      message: "CLI iOS credential provisioning is not yet migrated to the new credential store.",
      hint: pendingMigrationHint,
    }),
  );

export const provisionAndroidCredentials = (_params: {
  readonly api: ApiClient;
  readonly projectId: string;
}): Effect.Effect<void, MissingCredentialsError> =>
  Effect.fail(
    new MissingCredentialsError({
      message:
        "CLI Android credential provisioning is not yet migrated to the new credential store.",
      hint: pendingMigrationHint,
    }),
  );
