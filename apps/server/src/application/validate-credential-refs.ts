import { Effect } from "effect";

import { CurrentActor } from "../auth/current-actor";
import { NotFound } from "../errors";
import { AndroidUploadKeystoreRepo } from "../repositories/android-upload-keystores";
import { AppleDistributionCertificateRepo } from "../repositories/apple-distribution-certificates";
import { AppleProvisioningProfileRepo } from "../repositories/apple-provisioning-profiles";
import { ApplePushKeyRepo } from "../repositories/apple-push-keys";
import { AppleTeamRepo } from "../repositories/apple-teams";
import { AscApiKeyRepo } from "../repositories/asc-api-keys";
import { GoogleServiceAccountKeyRepo } from "../repositories/google-service-account-keys";

// Project-config rows (iOS bundle configurations, Android build-credential
// groups) reference org credentials by raw id. The build-time resolver
// re-checks every reference, but accepting garbage at write turns a typo
// into a deferred build failure — so configs verify each referenced id
// exists in the acting org BEFORE persisting. Dangling and cross-org ids
// are both NotFound (enumeration-safe, same wording as resolve). Binding
// state is deliberately NOT checked here: bindings change over time and
// build-credentials resolve is their single enforcement point (spec §1a).

/** A referenced id to verify: `null`/`undefined` payload slots are skipped. */
type Ref = string | null | undefined;

const check = <Entity extends { readonly organizationId: string }, Deps>(
  id: Ref,
  load: (id: string) => Effect.Effect<Entity, NotFound, Deps>,
  label: string,
) =>
  Effect.gen(function* () {
    if (typeof id !== "string") {
      return;
    }
    const ctx = yield* CurrentActor;
    const notFound = new NotFound({ message: `${label} not found` });
    const entity = yield* load(id).pipe(Effect.mapError(() => notFound));
    if (entity.organizationId !== ctx.organizationId) {
      return yield* notFound;
    }
  });

export const assertIosCredentialRefs = (params: {
  readonly appleTeamId?: Ref;
  readonly appleDistributionCertificateId?: Ref;
  readonly appleProvisioningProfileId?: Ref;
  readonly applePushKeyId?: Ref;
  readonly ascApiKeyId?: Ref;
}) =>
  Effect.gen(function* () {
    yield* check(
      params.appleTeamId,
      (id) => AppleTeamRepo.pipe(Effect.flatMap((repo) => repo.findById({ id }))),
      "Apple team",
    );
    yield* check(
      params.appleDistributionCertificateId,
      (id) =>
        AppleDistributionCertificateRepo.pipe(Effect.flatMap((repo) => repo.findById({ id }))),
      "Distribution certificate",
    );
    yield* check(
      params.appleProvisioningProfileId,
      (id) => AppleProvisioningProfileRepo.pipe(Effect.flatMap((repo) => repo.findById({ id }))),
      "Provisioning profile",
    );
    yield* check(
      params.applePushKeyId,
      (id) => ApplePushKeyRepo.pipe(Effect.flatMap((repo) => repo.findById({ id }))),
      "Push key",
    );
    yield* check(
      params.ascApiKeyId,
      (id) => AscApiKeyRepo.pipe(Effect.flatMap((repo) => repo.findById({ id }))),
      "ASC API key",
    );
  });

const loadGsaKey = (id: string) =>
  GoogleServiceAccountKeyRepo.pipe(Effect.flatMap((repo) => repo.findById({ id })));

export const assertAndroidCredentialRefs = (params: {
  readonly androidUploadKeystoreId?: Ref;
  readonly googleServiceAccountKeyForSubmissionsId?: Ref;
  readonly googleServiceAccountKeyForFcmV1Id?: Ref;
}) =>
  Effect.gen(function* () {
    yield* check(
      params.androidUploadKeystoreId,
      (id) => AndroidUploadKeystoreRepo.pipe(Effect.flatMap((repo) => repo.findById({ id }))),
      "Upload keystore",
    );
    yield* check(
      params.googleServiceAccountKeyForSubmissionsId,
      loadGsaKey,
      "Google service account key",
    );
    yield* check(
      params.googleServiceAccountKeyForFcmV1Id,
      loadGsaKey,
      "Google service account key",
    );
  });
