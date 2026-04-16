import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

import { Effect } from "effect";

import { toBase64Url } from "./base64-url";
import { BuildFailedError } from "./exit-codes";

export interface Sha256FileResult {
  readonly sha256: string;
  readonly byteSize: number;
}

export interface Sha256FileBase64UrlResult {
  readonly sha256Base64Url: string;
  readonly byteSize: number;
}

const hashReadError = (message: string) =>
  new BuildFailedError({
    step: "sha256",
    exitCode: 1,
    message,
  });

const hashFile = <TDigest>(
  path: string,
  formatDigest: (digest: Buffer) => TDigest,
): Effect.Effect<{ digest: TDigest; byteSize: number }, BuildFailedError> =>
  Effect.async<{ digest: TDigest; byteSize: number }, BuildFailedError>((resume) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    let byteSize = 0;

    stream.on("data", (chunk) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      byteSize += buffer.byteLength;
      hash.update(buffer);
    });
    stream.on("error", (error) => {
      resume(Effect.fail(hashReadError(`Failed to read file for SHA-256: ${error.message}`)));
    });
    stream.on("end", () => {
      resume(
        Effect.succeed({
          digest: formatDigest(hash.digest()),
          byteSize,
        }),
      );
    });
  });

/**
 * Compute the SHA-256 digest and byte size of a file using Node's streaming
 * hash API. The file is never fully loaded into memory — chunks flow through
 * `createReadStream` into `crypto.createHash("sha256")`.
 */
export const sha256File = (path: string): Effect.Effect<Sha256FileResult, BuildFailedError> =>
  hashFile(path, (digest) => digest.toString("hex")).pipe(
    Effect.map(({ digest, byteSize }) => ({ sha256: digest, byteSize })),
  );

export const sha256FileBase64Url = (
  path: string,
): Effect.Effect<Sha256FileBase64UrlResult, BuildFailedError> =>
  hashFile(path, toBase64Url).pipe(
    Effect.map(({ digest, byteSize }) => ({ sha256Base64Url: digest, byteSize })),
  );

/**
 * Compute a content-type-namespaced hash: `SHA-256(contentType + '\0' + SHA-256_hex(fileBytes))`.
 *
 * This prevents hash collisions when identical bytes are served with different
 * MIME types (e.g. same file used as both `application/javascript` and `text/plain`).
 * The raw content hash is still needed separately for R2 upload verification.
 */
export const sha256Namespaced = (contentType: string, contentSha256Hex: string): string => {
  const input = `${contentType}\0${contentSha256Hex}`;
  return toBase64Url(createHash("sha256").update(input).digest());
};
