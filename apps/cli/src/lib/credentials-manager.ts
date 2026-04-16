import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import type { CredentialDistribution, CredentialType } from "@better-update/api";

import { inspectKeystore, validateKeystoreAlias } from "./keystore-parser";
import { checkCertExpiry, inspectP12 } from "./pkcs12";

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

export const findActiveCredential = (api: ApiClient, filter: CredentialFilter) =>
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

export const uploadCredentialFromFile = (api: ApiClient, input: UploadCredentialFromFileInput) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const fileBytes = yield* fs.readFile(input.filePath);
    const fileBuffer = Buffer.from(fileBytes);
    const blob = fileBuffer.toString("base64");

    let expiresAt: string | undefined;
    let metadata: string | undefined;

    // Validate and extract metadata based on credential type
    if (input.type === "distribution-certificate" && input.password !== undefined) {
      const info = yield* inspectP12({ data: fileBuffer, password: input.password }).pipe(
        Effect.catchAll((e) => Console.warn(e.message).pipe(Effect.as(undefined))),
      );
      if (info) {
        expiresAt = info.expiresAt?.toISOString();
        metadata = JSON.stringify({
          serialNumber: info.serialNumber,
          subject: info.subject,
          issuerCN: info.issuerCN,
        });
        yield* Console.log(`  Certificate: ${info.signingIdentity}`);
        yield* Console.log(`  Serial: ${info.serialNumber}`);
        if (info.expiresAt) yield* Console.log(`  Expires: ${info.expiresAt.toISOString()}`);
        const warning = checkCertExpiry(info.expiresAt, "Distribution certificate");
        if (warning) yield* Console.warn(warning);
      }
    } else if (input.type === "keystore" && input.password !== undefined) {
      const info = yield* inspectKeystore({ data: fileBuffer, password: input.password }).pipe(
        Effect.catchAll((e) => Console.warn(e.message).pipe(Effect.as(undefined))),
      );
      if (info) {
        metadata = JSON.stringify({ aliases: info.aliases });
        yield* Console.log(`  Keystore aliases: ${info.aliases.join(", ")}`);
        if (input.keyAlias) {
          const warning = validateKeystoreAlias(info, input.keyAlias);
          if (warning) yield* Console.warn(warning);
        }
      }
    }

    return yield* api.credentials.upload({
      payload: {
        projectId: input.projectId,
        platform: input.platform,
        type: input.type,
        name: input.name,
        blob,
        ...optionalCredentialFields(input),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
      },
    });
  });

export const activateCredential = (api: ApiClient, credentialId: string) =>
  api.credentials.activate({ path: { id: credentialId } });

export const uploadAndActivateCredential = (api: ApiClient, input: UploadCredentialFromFileInput) =>
  uploadCredentialFromFile(api, input).pipe(
    Effect.flatMap((credential) => activateCredential(api, credential.id)),
  );

export interface UploadCredentialFromBlobInput extends CredentialFilter {
  readonly name: string;
  readonly blob: string;
  readonly password?: string;
  readonly expiresAt?: string;
}

export const uploadAndActivateCredentialFromBlob = (
  api: ApiClient,
  input: UploadCredentialFromBlobInput,
) =>
  api.credentials
    .upload({
      payload: {
        projectId: input.projectId,
        platform: input.platform,
        type: input.type,
        name: input.name,
        blob: input.blob,
        ...(input.distribution !== undefined ? { distribution: input.distribution } : {}),
        ...(input.password !== undefined ? { password: input.password } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      },
    })
    .pipe(Effect.flatMap((credential) => activateCredential(api, credential.id)));
