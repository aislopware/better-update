/**
 * The Account Holder hand-off for Apple certificates nobody else can create
 * (Developer ID Application / Installer): `credentials csr create` makes the
 * key and request, `credentials csr import` pairs the `.cer` that comes back
 * with that key and seals the result into the vault.
 *
 * Between the two the private key waits in `~/.better-update/csr/` (mode
 * 0600, the same footing as an SSH key), named by its public-key fingerprint
 * so an import finds it from the certificate alone. Import deletes it.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Effect, Option, Schema } from "effect";

import {
  certificateTypeFromCommonName,
  isMacosCertificateType,
} from "../lib/apple-certificate-type";
import {
  buildP12,
  certificateCommonName,
  createSigningRequest,
  publicKeyFingerprint,
  readCertificate,
} from "../lib/apple-csr";
import { uploadAppleCertificate } from "../lib/credentials-apple-certificate";
import { CredentialValidationError } from "../lib/exit-codes";
import { CliRuntime } from "../services/cli-runtime";

import type { ApiClient } from "../services/api-client";

/** What the request is for — only a label for `csr list` and the guide. */
export type CsrPurpose = "developer-id-application" | "developer-id-installer" | "other";

const PURPOSE_LABEL: Record<CsrPurpose, string> = {
  "developer-id-application": "Developer ID Application",
  "developer-id-installer": "Developer ID Installer",
  other: "Apple certificate",
};

const PendingRequest = Schema.Struct({
  purpose: Schema.Literals(["developer-id-application", "developer-id-installer", "other"]),
  commonName: Schema.String,
  email: Schema.String,
  createdAt: Schema.String,
  csrPath: Schema.String,
});
type PendingRequest = typeof PendingRequest.Type;

const decodePending = Schema.decodeUnknownOption(Schema.fromJsonString(PendingRequest));

const pendingDir = Effect.gen(function* () {
  const runtime = yield* CliRuntime;
  return path.join(yield* runtime.homeDirectory, ".better-update", "csr");
});

const keyFile = (dir: string, fingerprint: string) => path.join(dir, `${fingerprint}.key.pem`);
const metaFile = (dir: string, fingerprint: string) => path.join(dir, `${fingerprint}.json`);

export const handoffGuide = (purpose: CsrPurpose, csrPath: string): string =>
  [
    `Send ${csrPath} to your team's Account Holder (only they can create this certificate).`,
    "They create it at https://developer.apple.com/account/resources/certificates/add :",
    `  1. Choose "${PURPOSE_LABEL[purpose]}" and continue.`,
    '  2. Keep the "G2 Sub-CA (Xcode 11.4.1 or later)" profile type.',
    "  3. Upload the .certSigningRequest, then download the .cer and send it back.",
    "Then, on this machine:",
    "  better-update credentials csr import <downloaded.cer>",
    "The private key stays on this machine until that import seals it into the vault.",
  ].join("\n");

export const createPendingRequest = (params: {
  readonly purpose: CsrPurpose;
  readonly commonName: string;
  readonly email: string;
  readonly csrPath: string;
}) =>
  Effect.gen(function* () {
    const request = yield* createSigningRequest(params);
    const dir = yield* pendingDir;
    const meta: PendingRequest = {
      purpose: params.purpose,
      commonName: params.commonName,
      email: params.email,
      createdAt: new Date().toISOString(),
      csrPath: params.csrPath,
    };
    yield* Effect.promise(async () => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);
      await writeFile(keyFile(dir, request.publicKeyFingerprint), request.privateKeyPem, {
        mode: 0o600,
      });
      await writeFile(metaFile(dir, request.publicKeyFingerprint), `${JSON.stringify(meta)}\n`);
      await writeFile(params.csrPath, request.csrPem);
    });
    return {
      fingerprint: request.publicKeyFingerprint,
      keyPath: keyFile(dir, request.publicKeyFingerprint),
    };
  });

export const listPendingRequests = Effect.gen(function* () {
  const dir = yield* pendingDir;
  const entries = yield* Effect.promise(async () => readdir(dir).catch((): string[] => []));
  const metas = yield* Effect.forEach(
    entries.filter((entry) => entry.endsWith(".json")),
    (entry) =>
      Effect.promise(async () => readFile(path.join(dir, entry), "utf8")).pipe(
        Effect.map((json) =>
          Option.match(decodePending(json), {
            onNone: () => [],
            onSome: (pending) => [{ ...pending, fingerprint: entry.slice(0, -".json".length) }],
          }),
        ),
      ),
  );
  return metas.flat().toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
});

/**
 * Pair a downloaded `.cer` with the pending key it was requested for, upload
 * the resulting `.p12` to the vault under the platform its common name says,
 * and forget the key.
 */
export const importIssuedCertificate = (
  api: ApiClient,
  params: { readonly cerPath: string; readonly name: string | undefined },
) =>
  Effect.gen(function* () {
    const certificate = yield* readCertificate(
      yield* Effect.promise(async () => readFile(params.cerPath)),
    );
    const fingerprint = publicKeyFingerprint(certificate.publicKey);
    const dir = yield* pendingDir;
    const privateKeyPem = yield* Effect.promise(async () =>
      readFile(keyFile(dir, fingerprint), "utf8").catch(() => undefined),
    );
    if (privateKeyPem === undefined) {
      return yield* new CredentialValidationError({
        message: `No pending request on this machine matches ${path.basename(params.cerPath)}. Import it on the machine that ran \`credentials csr create\`, or export a .p12 from Keychain Access and use \`credentials upload\`.`,
      });
    }
    const commonName = certificateCommonName(certificate);
    const password = randomBytes(18).toString("base64url");
    const p12 = yield* buildP12({ certificate, privateKeyPem, password });
    const expect = isMacosCertificateType(certificateTypeFromCommonName(commonName))
      ? "macos"
      : "ios";
    const uploaded = yield* uploadAppleCertificate(expect)(
      api,
      {
        platform: expect,
        type: expect === "macos" ? "macos-certificate" : "distribution-certificate",
        name: params.name ?? commonName ?? path.basename(params.cerPath),
        filePath: params.cerPath,
        password,
      },
      p12,
    );
    yield* Effect.promise(async () => {
      await rm(keyFile(dir, fingerprint), { force: true });
      await rm(metaFile(dir, fingerprint), { force: true });
    });
    return { ...uploaded, commonName };
  });
