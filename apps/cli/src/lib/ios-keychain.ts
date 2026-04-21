import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

import { Command } from "@effect/platform";
import { Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";
import type { Scope } from "effect";

import { KeychainError } from "./exit-codes";

export interface AcquireKeychainOptions {
  readonly tempDir: string;
  readonly p12Path: string;
  readonly p12Password: string;
}

export interface KeychainHandle {
  readonly keychainName: string;
  readonly keychainPath: string;
  readonly signingIdentity: string;
}

// ── shell helpers ─────────────────────────────────────────────────

const runOrFail = (
  cmd: Command.Command,
  step: string,
): Effect.Effect<string, KeychainError, CommandExecutor.CommandExecutor> =>
  Command.string(cmd).pipe(
    Effect.mapError(
      (cause) =>
        new KeychainError({
          message: `keychain ${step} failed: ${String(cause)}`,
        }),
    ),
  );

const listCurrentKeychains = Effect.gen(function* () {
  // `security list-keychains -d user` returns each keychain path on its own line,
  // Surrounded by double quotes and optionally preceded by whitespace.
  const output = yield* runOrFail(
    Command.make("security", "list-keychains", "-d", "user"),
    "list-keychains",
  );
  return output
    .split("\n")
    .map((line) => line.trim().replace(/^"/, "").replace(/"$/, ""))
    .filter((line) => line.length > 0);
});

// Parse `security find-identity -v <keychain>` output to extract the first
// Signing identity. Lines look like:
//   1) 1A2B3C4D... "Apple Distribution: Your Name (TEAMID)"
const parseSigningIdentity = (output: string): string | undefined => {
  const lines = output.split("\n");
  for (const line of lines) {
    const match = /"([^"]+)"/.exec(line);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
};

// ── acquireRelease ────────────────────────────────────────────────

/**
 * Acquire an ephemeral macOS keychain, import a `.p12` into it, add it to the
 * user search list, and tear it all down on scope close. The keychain name is
 * namespaced as `better-update-<uuid>` and lives in `$tempDir`, so cleanup is
 * guaranteed under all termination paths.
 */
export const acquireKeychain = ({
  tempDir,
  p12Path,
  p12Password,
}: AcquireKeychainOptions): Effect.Effect<
  KeychainHandle,
  KeychainError,
  CommandExecutor.CommandExecutor | Scope.Scope
> => {
  const keychainName = `better-update-${randomUUID()}.keychain-db`;
  const keychainPath = path.join(tempDir, keychainName);
  const keychainPassword = randomBytes(32).toString("hex");

  return Effect.acquireRelease(
    // ── acquire ─────────────────────────────────────────────────
    Effect.gen(function* () {
      const priorKeychains = yield* listCurrentKeychains;

      yield* runOrFail(
        Command.make("security", "create-keychain", "-p", keychainPassword, keychainPath),
        "create-keychain",
      );

      yield* runOrFail(
        Command.make("security", "unlock-keychain", "-p", keychainPassword, keychainPath),
        "unlock-keychain",
      );

      yield* runOrFail(
        Command.make("security", "set-keychain-settings", "-t", "3600", "-l", keychainPath),
        "set-keychain-settings",
      );

      yield* runOrFail(
        Command.make(
          "security",
          "import",
          p12Path,
          "-k",
          keychainPath,
          "-P",
          p12Password,
          "-T",
          "/usr/bin/codesign",
        ),
        "import",
      );

      yield* runOrFail(
        Command.make(
          "security",
          "set-key-partition-list",
          "-S",
          "apple-tool:,apple:,codesign:",
          "-s",
          "-k",
          keychainPassword,
          keychainPath,
        ),
        "set-key-partition-list",
      );

      // Prepend our keychain to the search list while preserving the user's
      // Existing ones.
      yield* runOrFail(
        Command.make(
          "security",
          "list-keychains",
          "-d",
          "user",
          "-s",
          keychainPath,
          ...priorKeychains,
        ),
        "list-keychains -s (add)",
      );

      const identitiesOutput = yield* runOrFail(
        Command.make("security", "find-identity", "-v", "-p", "codesigning", keychainPath),
        "find-identity",
      );
      const signingIdentity = parseSigningIdentity(identitiesOutput);
      if (!signingIdentity) {
        return yield* new KeychainError({
          message: "No code signing identity found after importing .p12 into ephemeral keychain.",
        });
      }

      return {
        handle: { keychainName, keychainPath, signingIdentity },
        priorKeychains,
      };
    }),

    // ── release ─────────────────────────────────────────────────
    ({ priorKeychains }) =>
      Effect.gen(function* () {
        // Restore the original search list first, then delete our keychain.
        yield* Command.string(
          Command.make("security", "list-keychains", "-d", "user", "-s", ...priorKeychains),
        ).pipe(Effect.catchAll(() => Effect.void));

        yield* Command.string(Command.make("security", "delete-keychain", keychainPath)).pipe(
          Effect.catchAll(() => Effect.void),
        );
      }),
  ).pipe(Effect.map(({ handle }) => handle));
};
