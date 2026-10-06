/**
 * One step from "which vault certificate" to "an identity codesign /
 * productbuild can use": resolve the stored Developer ID certificate, decrypt
 * its `.p12` locally, and import it into an ephemeral keychain that lives for
 * the enclosing scope. Shared by `macos sign`, `macos package` and
 * `build --platform macos`.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect, Option } from "effect";

import { developerIdCaGeneration, developerIdG1Warning } from "../lib/developer-id-ca";
import { acquireKeychain } from "../lib/ios-keychain";
import { inspectP12 } from "../lib/pkcs12";
import { printWarn } from "../lib/warning-style";
import { fetchDeveloperIdP12, resolveDeveloperIdCertificateId } from "./macos-developer-id";

import type { ApiClient } from "../services/api-client";
import type { DeveloperIdKind } from "./macos-developer-id";

/**
 * Private scratch dir for one macOS signing session (decrypted `.p12`s,
 * ephemeral keychains, entitlement files, staged containers), removed when the
 * enclosing scope closes on every termination path.
 */
export const acquireMacosWorkDir = Effect.acquireRelease(
  Effect.promise(async () => mkdtemp(path.join(tmpdir(), "better-update-macos-"))),
  (dir) => Effect.promise(async () => rm(dir, { recursive: true, force: true })),
);

export interface DeveloperIdIdentity {
  readonly certificateId: string;
  /** Common name, for display. */
  readonly name: string;
  /** SHA-1 — what to pass to codesign/productbuild (never ambiguous). */
  readonly hash: string;
  readonly keychainPath: string;
  readonly teamId: string;
  readonly serialNumber: string;
  /** The decrypted `.p12` in the private work dir — for tools that import it themselves. */
  readonly p12Path: string;
  readonly p12Password: string;
}

export interface AcquireDeveloperIdIdentityOptions {
  readonly kind: DeveloperIdKind;
  /** `--certificate-id`-style override; picks/auto-detects when undefined. */
  readonly certificateId: string | undefined;
  /** Private scratch dir (the decrypted `.p12` and the keychain live here). */
  readonly workDir: string;
}

export const acquireDeveloperIdIdentity = (
  api: ApiClient,
  options: AcquireDeveloperIdIdentityOptions,
) =>
  Effect.gen(function* () {
    const certificateId = yield* resolveDeveloperIdCertificateId(
      api,
      options.certificateId,
      options.kind,
    );
    const p12 = yield* fetchDeveloperIdP12(api, certificateId);
    // Best-effort: a parse failure here surfaces at keychain import instead.
    const info = yield* inspectP12({
      data: Buffer.from(p12.p12Bytes),
      password: p12.p12Password,
    }).pipe(Effect.option);
    if (Option.isSome(info) && developerIdCaGeneration(info.value) === "G1") {
      yield* printWarn(developerIdG1Warning(info.value.signingIdentity));
    }
    const p12Path = path.join(
      options.workDir,
      options.kind === "DEVELOPER_ID_INSTALLER" ? "installer.p12" : "application.p12",
    );
    yield* Effect.promise(async () => writeFile(p12Path, p12.p12Bytes, { mode: 0o600 }));
    const keychain = yield* acquireKeychain({
      tempDir: options.workDir,
      p12Path,
      p12Password: p12.p12Password,
      policy: options.kind === "DEVELOPER_ID_INSTALLER" ? "basic" : "codesigning",
    });
    return {
      certificateId,
      name: keychain.signingIdentity,
      hash: keychain.signingIdentityHash,
      keychainPath: keychain.keychainPath,
      teamId: p12.appleTeamIdentifier,
      serialNumber: p12.serialNumber,
      p12Path,
      p12Password: p12.p12Password,
    } satisfies DeveloperIdIdentity;
  });
