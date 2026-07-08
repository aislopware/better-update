import { createHash } from "node:crypto";
import path from "node:path";

import { canonicalDeviceRoster } from "@better-update/api";
import { toBase64 } from "@better-update/encoding";
import { compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";

import {
  openVaultSessionInteractive,
  sealForUpload,
  toUploadEnvelope,
} from "../application/credential-cipher";
import { extractKeystoreFingerprints, generateAndroidKeystore } from "./android-keystore";
import { autoBindProjectId } from "./project-link";
import { acquireBuildTempDir } from "./temp-dir";

import type { ApiClient } from "../services/api-client";

/**
 * Stable fingerprint of a device roster, used to detect profile drift. Hashes
 * UDIDs via `canonicalDeviceRoster` — the exact string the server hashes in its
 * staleness check, so the two fingerprints agree by construction.
 */
export const computeDeviceRosterHashHex = (udids: readonly string[]): string =>
  createHash("sha256").update(canonicalDeviceRoster(udids), "utf8").digest("hex");

export class CertificateLimitError extends Data.TaggedError("CertificateLimitError")<{
  readonly message: string;
}> {}

// ── Android keystore ───────────────────────────────────────────────

export interface GenerateAndUploadKeystoreInput {
  readonly keyAlias: string;
  readonly storePassword: string;
  readonly keyPassword: string;
  readonly commonName: string;
  readonly organization: string;
  readonly validityDays?: number;
  /** Optional human label so generated keystores are distinguishable in `credentials list` even when aliases collide. */
  readonly name?: string;
}

export const generateAndUploadKeystore = (api: ApiClient, input: GenerateAndUploadKeystoreInput) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* acquireBuildTempDir;
      const keystorePath = path.join(tempDir, "release.keystore");

      yield* generateAndroidKeystore({
        outputPath: keystorePath,
        keyAlias: input.keyAlias,
        storePassword: input.storePassword,
        keyPassword: input.keyPassword,
        commonName: input.commonName,
        organization: input.organization,
        ...compact({ validityDays: input.validityDays }),
      });

      const bytes = yield* fs.readFile(keystorePath);
      const fingerprints = yield* extractKeystoreFingerprints({
        keystorePath,
        keyAlias: input.keyAlias,
        storePassword: input.storePassword,
      });
      const session = yield* openVaultSessionInteractive(api);
      const metadata = compact({
        name: input.name,
        keyAlias: input.keyAlias,
        md5Fingerprint: fingerprints.md5,
        sha1Fingerprint: fingerprints.sha1,
        sha256Fingerprint: fingerprints.sha256,
        // generateAndroidKeystore always emits a JKS container.
        keystoreType: "JKS" as const,
      });
      const envelope = yield* sealForUpload({
        session,
        credentialType: "keystore",
        metadata,
        secret: {
          keystoreBase64: toBase64(bytes),
          keystorePassword: input.storePassword,
          keyPassword: input.keyPassword,
        },
      });
      const created = yield* api.androidUploadKeystores.upload({
        payload: { ...toUploadEnvelope(envelope), ...metadata, ...(yield* autoBindProjectId) },
      });
      return { id: created.id, keyAlias: created.keyAlias };
    }),
  );
