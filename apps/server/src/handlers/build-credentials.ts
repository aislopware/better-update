import { compact } from "@better-update/type-guards";
import { HttpApiBuilder, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertVaultRotationNotPending } from "../application/assert-vault-rotation";
import {
  resolveAndroidBuildCredentials,
  resolveIosBuildCredentials,
} from "../application/resolve-build-credentials";
import { logAudit } from "../audit/logger";
import { assertAndroidOrgCredentialAccess } from "../auth/android-credential-access";
import { assertAppleCredentialAccess } from "../auth/apple-team-access";
import { bindingHint } from "../auth/binding-hint";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccessAny } from "../auth/policy";
import { Forbidden } from "../errors";
import { toApiResolveReadEffect } from "../http/to-api-effect";
import { AndroidUploadKeystoreRepo } from "../repositories/android-upload-keystores";
import { AppleTeamRepo } from "../repositories/apple-teams";
import { ProjectCredentialBindingRepo } from "../repositories/project-credential-bindings";

import type { CredentialBindingType } from "../models";

// The v2 hard rule (GITLAB-RBAC-SPEC §1a/§3c): a build may only consume
// credentials BOUND to its project — for every caller, admins included.
// Rank gates come on top for non-admins (the access helpers).
const assertBoundToProject = (params: {
  readonly organizationId: string;
  readonly projectId: string;
  readonly resourceType: CredentialBindingType;
  readonly resourceId: string;
  readonly label: string;
}) =>
  Effect.gen(function* () {
    const bound = yield* ProjectCredentialBindingRepo.pipe(
      Effect.flatMap((bindings) =>
        bindings.boundProjectIds({
          organizationId: params.organizationId,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
        }),
      ),
    );
    if (!bound.includes(params.projectId)) {
      return yield* new Forbidden({
        message: `${params.label} (${params.resourceType} ${params.resourceId}) is not bound to project ${params.projectId} — ${bindingHint(params.resourceType, params.resourceId, params.projectId)}`,
      });
    }
  });

const withNoStore = (body: unknown) =>
  HttpServerResponse.json(body, {
    headers: { "cache-control": "no-store, private" },
  });

export const BuildCredentialsGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "buildCredentials",
  (handlers) =>
    handlers.handle("resolve", ({ path, payload }) =>
      toApiResolveReadEffect(
        Effect.gen(function* () {
          yield* assertProjectOwnership(path.projectId);
          const ctx = yield* CurrentActor;

          // Fail closed while the vault is flagged for rotation (a recipient was
          // removed): handing out more vault-key-encrypted ciphertext is refused
          // until an admin rotates. See application/assert-vault-rotation.
          yield* assertVaultRotationNotPending({ organizationId: ctx.organizationId });

          if (payload.platform === "ios") {
            // Coarse gate first (the owning Apple team is only known after
            // resolution), then the precise team-scoped gate before anything
            // is returned (authz-models.ts "APPLE-TEAM axis").
            yield* assertAccessAny("appleCredential", "download");
            const { response, resolvedIds } = yield* resolveIosBuildCredentials({
              organizationId: ctx.organizationId,
              projectId: path.projectId,
              bundleIdentifier: payload.bundleIdentifier,
              distributionType: payload.distributionType,
            });
            const team = yield* AppleTeamRepo.pipe(
              Effect.flatMap((teams) =>
                teams.findByAppleTeamId({
                  organizationId: ctx.organizationId,
                  appleTeamId: response.context.appleTeamIdentifier,
                }),
              ),
            );
            yield* assertBoundToProject({
              organizationId: ctx.organizationId,
              projectId: path.projectId,
              resourceType: "appleTeam",
              resourceId: team.id,
              label: "This Apple team",
            });
            yield* assertAppleCredentialAccess({
              action: "download",
              appleTeamRowId: team.id,
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

          yield* assertAccessAny("androidCredential", "download");
          const { response, resolvedIds } = yield* resolveAndroidBuildCredentials({
            organizationId: ctx.organizationId,
            projectId: path.projectId,
            applicationIdentifier: payload.applicationIdentifier,
            buildProfile: payload.buildProfile,
          });
          const keystore = yield* AndroidUploadKeystoreRepo.pipe(
            Effect.flatMap((keystores) => keystores.findById({ id: resolvedIds.keystoreId })),
          );
          yield* assertBoundToProject({
            organizationId: ctx.organizationId,
            projectId: path.projectId,
            resourceType: "androidUploadKeystore",
            resourceId: keystore.id,
            label: "This upload keystore",
          });
          yield* assertAndroidOrgCredentialAccess({
            action: "download",
            resourceType: "androidUploadKeystore",
            resourceId: keystore.id,
            isProtected: keystore.isProtected,
          });
          yield* logAudit({
            action: "build-credentials.resolve",
            resourceType: "androidCredential",
            resourceId: resolvedIds.keystoreId,
            projectId: path.projectId,
            metadata: {
              platform: "android",
              applicationIdentifier: payload.applicationIdentifier,
              keystoreId: resolvedIds.keystoreId,
              buildCredentialsGroupId: resolvedIds.buildCredentialsGroupId,
              ...compact({ buildProfile: payload.buildProfile }),
            },
          });
          return yield* withNoStore(response).pipe(Effect.orDie);
        }),
      ),
    ),
);
