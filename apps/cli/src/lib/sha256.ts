import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

import { Effect } from "effect";

import { BuildFailedError } from "./exit-codes";

export interface Sha256FileResult {
  readonly sha256: string;
  readonly byteSize: number;
}

/**
 * Compute the SHA-256 digest and byte size of a file using Node's streaming
 * hash API. The file is never fully loaded into memory — chunks flow through
 * `createReadStream` into `crypto.createHash("sha256")`.
 */
export const sha256File = (path: string): Effect.Effect<Sha256FileResult, BuildFailedError> =>
  Effect.async<Sha256FileResult, BuildFailedError>((resume) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    let byteSize = 0;

    stream.on("data", (chunk) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      byteSize += buffer.byteLength;
      hash.update(buffer);
    });
    stream.on("error", (error) => {
      resume(
        Effect.fail(
          new BuildFailedError({
            step: "sha256",
            exitCode: 1,
            message: `Failed to read file for SHA-256: ${error.message}`,
          }),
        ),
      );
    });
    stream.on("end", () => {
      resume(Effect.succeed({ sha256: hash.digest("hex"), byteSize }));
    });
  });
