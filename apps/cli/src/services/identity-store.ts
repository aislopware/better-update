import path from "node:path";

import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

import type { Argon2Params, IdentityFile } from "@better-update/credentials-crypto";

import { IdentityError } from "../lib/exit-codes";
import { formatCause } from "../lib/format-error";
import { CliRuntime } from "./cli-runtime";

const isArgon2Params = (value: unknown): value is Argon2Params =>
  isRecord(value) &&
  typeof value["time"] === "number" &&
  typeof value["memory"] === "number" &&
  typeof value["parallelism"] === "number";

/**
 * Structural guard for the on-disk identity envelope. A corrupt or foreign file
 * reads as "absent" so the CLI prompts to (re)create rather than crashing — the
 * AAD-bound `openIdentity` still fails loudly if a well-formed file was tampered.
 */
const isIdentityFile = (value: unknown): value is IdentityFile =>
  isRecord(value) &&
  value["version"] === 1 &&
  typeof value["publicKey"] === "string" &&
  typeof value["fingerprint"] === "string" &&
  value["kdf"] === "argon2id" &&
  isArgon2Params(value["kdfParams"]) &&
  typeof value["salt"] === "string" &&
  value["cipher"] === "xchacha20poly1305" &&
  typeof value["ct"] === "string";

export class IdentityStore extends Context.Tag("cli/IdentityStore")<
  IdentityStore,
  {
    /** Read the sealed device identity, or `null` when none is set up. */
    readonly load: Effect.Effect<IdentityFile | null>;
    /** Persist the sealed envelope at `~/.better-update/identity.json` (0600). */
    readonly save: (file: IdentityFile) => Effect.Effect<void, IdentityError>;
    /** Remove the on-disk identity (best-effort). */
    readonly clear: Effect.Effect<void>;
  }
>() {}

export const IdentityStoreLive = Layer.effect(
  IdentityStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const runtime = yield* CliRuntime;
    const homeDirectory = yield* runtime.homeDirectory;
    const identityDir = path.join(homeDirectory, ".better-update");
    const identityFile = path.join(identityDir, "identity.json");

    return {
      load: Effect.gen(function* () {
        const content = yield* fs.readFileString(identityFile).pipe(Effect.orElseSucceed(() => ""));
        if (content.length === 0) {
          return null;
        }
        const parsed = safeJsonParse(content);
        return isIdentityFile(parsed) ? parsed : null;
      }),

      save: (file: IdentityFile) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(identityDir, { recursive: true });
          yield* fs.chmod(identityDir, 0o700);
          // Write to a temp file, lock it down, then atomically rename — so
          // identity.json is never momentarily world-readable in the gap between
          // create and chmod (a direct write lands at the umask's mode, often
          // 0644, until the chmod runs).
          const tempFile = `${identityFile}.tmp`;
          yield* fs.writeFileString(tempFile, `${JSON.stringify(file, null, 2)}\n`);
          yield* fs.chmod(tempFile, 0o600);
          yield* fs.rename(tempFile, identityFile);
        }).pipe(
          Effect.mapError(
            (cause) =>
              new IdentityError({ message: `Failed to save identity: ${formatCause(cause)}` }),
          ),
        ),

      clear: fs.remove(identityFile).pipe(Effect.catchAll(() => Effect.void)),
    };
  }),
);
