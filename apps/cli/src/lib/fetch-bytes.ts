import { Buffer } from "node:buffer";

import { Effect } from "effect";

import { UploadFailedError } from "./exit-codes";
import { formatCause } from "./format-error";

/**
 * Download a presigned/tokenized URL fully into memory. Shared by the
 * artifact / debug-symbol / sourcemap download commands, which all write the
 * bytes straight to a local file. `label` names the payload in error
 * messages, e.g. "artifact" → "Failed to download artifact: …".
 */
export const fetchBytes = (url: string, label: string): Effect.Effect<Buffer, UploadFailedError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: async () => fetch(url),
      catch: (cause) =>
        new UploadFailedError({ message: `Failed to request ${label}: ${formatCause(cause)}` }),
    });
    if (!response.ok) {
      return yield* new UploadFailedError({
        message: `Failed to download ${label}: HTTP ${String(response.status)} ${response.statusText}`,
      });
    }
    const buffer = yield* Effect.tryPromise({
      try: async () => response.arrayBuffer(),
      catch: (cause) =>
        new UploadFailedError({ message: `Failed to read ${label} body: ${formatCause(cause)}` }),
    });
    return Buffer.from(buffer);
  });
