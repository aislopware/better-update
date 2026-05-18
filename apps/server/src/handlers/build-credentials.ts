import { HttpApiBuilder, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import {
  resolveAndroidBuildCredentials,
  resolveIosBuildCredentials,
} from "../application/resolve-build-credentials";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { toApiBadRequestReadEffect } from "../http/to-api-effect";

const withNoStore = (body: unknown) =>
  HttpServerResponse.json(body, {
    headers: { "cache-control": "no-store, private" },
  });

export const BuildCredentialsGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "buildCredentials",
  (handlers) =>
    handlers.handle("resolve", ({ path, payload }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertProjectOwnership(path.projectId);
          const ctx = yield* CurrentActor;

          if (payload.platform === "ios") {
            yield* assertPermission("appleCredential", "download");
            const { response, resolvedIds } = yield* resolveIosBuildCredentials({
              organizationId: ctx.organizationId,
              projectId: path.projectId,
              bundleIdentifier: payload.bundleIdentifier,
              distributionType: payload.distributionType,
            });
            yield* logAudit({
              action: "build-credentials.resolve",
              resourceType: "appleCredential",
              resourceId: resolvedIds.provisioningProfileId,
              projectId: path.projectId,
              metadata: {
                platform: "ios",
                bundleIdentifier: payload.bundleIdentifier,
                distributionType: payload.distributionType,
                distributionCertificateId: resolvedIds.distributionCertificateId,
                provisioningProfileId: resolvedIds.provisioningProfileId,
                pushKeyId: resolvedIds.pushKeyId,
                profileStale: resolvedIds.profileStale,
                currentDeviceRosterHash: resolvedIds.currentDeviceRosterHash,
              },
            });
            return yield* withNoStore(response).pipe(Effect.orDie);
          }

          yield* assertPermission("androidCredential", "download");
          const { response, resolvedIds } = yield* resolveAndroidBuildCredentials({
            organizationId: ctx.organizationId,
            projectId: path.projectId,
            applicationIdentifier: payload.applicationIdentifier,
            buildProfile: payload.buildProfile,
          });
          yield* logAudit({
            action: "build-credentials.resolve",
            resourceType: "androidCredential",
            resourceId: resolvedIds.keystoreId,
            projectId: path.projectId,
            metadata: {
              platform: "android",
              applicationIdentifier: payload.applicationIdentifier,
              ...(payload.buildProfile === undefined ? {} : { buildProfile: payload.buildProfile }),
              keystoreId: resolvedIds.keystoreId,
              buildCredentialsGroupId: resolvedIds.buildCredentialsGroupId,
            },
          });
          return yield* withNoStore(response).pipe(Effect.orDie);
        }),
      ),
    ),
);
