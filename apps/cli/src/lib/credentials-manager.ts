import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { Credential, CredentialDistribution, CredentialType } from "@better-update/api";
import type { PlatformError } from "@effect/platform/Error";

import type { ApiClient } from "../services/api-client";

export interface CredentialFilter {
  readonly projectId: string;
  readonly platform: "ios" | "android";
  readonly type: typeof CredentialType.Type;
  readonly distribution?: typeof CredentialDistribution.Type;
}

export interface UploadCredentialFromFileInput extends CredentialFilter {
  readonly name: string;
  readonly filePath: string;
  readonly password?: string;
  readonly keyAlias?: string;
  readonly keyPassword?: string;
}

const optionalCredentialFields = (input: UploadCredentialFromFileInput) => ({
  ...(input.distribution !== undefined ? { distribution: input.distribution } : {}),
  ...(input.password !== undefined ? { password: input.password } : {}),
  ...(input.keyAlias !== undefined ? { keyAlias: input.keyAlias } : {}),
  ...(input.keyPassword !== undefined ? { keyPassword: input.keyPassword } : {}),
});

export const findActiveCredential = (
  api: ApiClient,
  filter: CredentialFilter,
): Effect.Effect<Credential | null> =>
  api.credentials
    .list({
      urlParams: {
        projectId: filter.projectId,
        platform: filter.platform,
        type: filter.type,
        ...(filter.distribution !== undefined ? { distribution: filter.distribution } : {}),
      },
    })
    .pipe(Effect.map(({ items }) => items.find((item) => item.isActive) ?? null));

export const uploadCredentialFromFile = (
  api: ApiClient,
  input: UploadCredentialFromFileInput,
): Effect.Effect<Credential, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const fileBytes = yield* fs.readFile(input.filePath);

    return yield* api.credentials.upload({
      payload: {
        projectId: input.projectId,
        platform: input.platform,
        type: input.type,
        name: input.name,
        blob: Buffer.from(fileBytes).toString("base64"),
        ...optionalCredentialFields(input),
      },
    });
  });

export const activateCredential = (
  api: ApiClient,
  credentialId: string,
): Effect.Effect<Credential> => api.credentials.activate({ path: { id: credentialId } });

export const uploadAndActivateCredential = (
  api: ApiClient,
  input: UploadCredentialFromFileInput,
): Effect.Effect<Credential, PlatformError, FileSystem.FileSystem> =>
  uploadCredentialFromFile(api, input).pipe(
    Effect.flatMap((credential) => activateCredential(api, credential.id)),
  );
