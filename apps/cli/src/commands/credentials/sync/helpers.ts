import path from "node:path";

import { Effect } from "effect";

import type { FileSystem } from "@effect/platform";

import { CredentialsJsonError } from "../../../lib/exit-codes";

import type { CredentialsJson } from "../../../lib/credentials-json";

export const SYNC_EXIT_EXTRAS = {
  CredentialsJsonError: 5,
  CredentialValidationError: 5,
} as const;

export interface SyncRow {
  readonly type: string;
  readonly path: string;
  readonly status: string;
  readonly id: string;
}

export interface PullRow {
  readonly type: string;
  readonly path: string;
  readonly id: string;
}

export const writeArtifact = (
  fs: FileSystem.FileSystem,
  projectRoot: string,
  relPath: string,
  bytes: Uint8Array,
): Effect.Effect<string, CredentialsJsonError> =>
  Effect.gen(function* () {
    const abs = path.join(projectRoot, relPath);
    const dir = path.dirname(abs);
    yield* fs
      .makeDirectory(dir, { recursive: true })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CredentialsJsonError({ message: `Failed to create ${dir}: ${String(cause)}` }),
        ),
      );
    yield* fs
      .writeFile(abs, bytes)
      .pipe(
        Effect.mapError(
          (cause) =>
            new CredentialsJsonError({ message: `Failed to write ${abs}: ${String(cause)}` }),
        ),
      );
    return relPath;
  });

export const writeText = (
  fs: FileSystem.FileSystem,
  projectRoot: string,
  relPath: string,
  text: string,
) => writeArtifact(fs, projectRoot, relPath, new TextEncoder().encode(text));

export const ensureGitignoreEntries = (
  fs: FileSystem.FileSystem,
  projectRoot: string,
  paths: readonly string[],
): Effect.Effect<readonly string[], CredentialsJsonError> =>
  Effect.gen(function* () {
    const filePath = path.join(projectRoot, ".gitignore");
    const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    const previous = exists
      ? yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""))
      : "";
    const lines = previous.split("\n");
    const added: string[] = [];
    const next = [...lines];
    for (const entry of paths) {
      if (!lines.includes(entry)) {
        next.push(entry);
        added.push(entry);
      }
    }
    if (added.length === 0) {
      return [];
    }
    const body = next.join("\n").trimEnd();
    yield* fs.writeFileString(filePath, `${body}\n`).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to update .gitignore: ${String(cause)}`,
          }),
      ),
    );
    return added;
  });

interface CredentialMeta {
  readonly id: string;
  readonly label: string;
}

interface IosBuildInput {
  readonly first: CredentialMeta | undefined;
  readonly profileFirst: CredentialMeta | undefined;
  readonly pushFirst: CredentialMeta | undefined;
  readonly ascFirst: CredentialMeta | undefined;
  readonly storage: Map<
    string,
    { readonly relPath: string; readonly extras?: Record<string, string> }
  >;
}

export const buildIosFromMeta = (
  params: IosBuildInput,
): NonNullable<CredentialsJson["ios"]> | undefined => {
  if (!params.first || !params.profileFirst) {
    return undefined;
  }
  const cert = params.storage.get(params.first.id);
  const profile = params.storage.get(params.profileFirst.id);
  if (!cert || !profile || !cert.extras?.["password"]) {
    return undefined;
  }
  const result: NonNullable<CredentialsJson["ios"]> = {
    provisioningProfilePath: profile.relPath,
    distributionCertificate: {
      path: cert.relPath,
      password: cert.extras["password"],
    },
  };
  if (params.pushFirst) {
    const push = params.storage.get(params.pushFirst.id);
    if (push?.extras?.["keyId"] && push.extras["teamId"]) {
      return {
        ...result,
        pushKey: {
          path: push.relPath,
          keyId: push.extras["keyId"],
          teamId: push.extras["teamId"],
        },
      };
    }
  }
  if (params.ascFirst) {
    const asc = params.storage.get(params.ascFirst.id);
    if (asc?.extras?.["keyId"] && asc.extras["issuerId"]) {
      return {
        ...result,
        ascApiKey: {
          path: asc.relPath,
          keyId: asc.extras["keyId"],
          issuerId: asc.extras["issuerId"],
        },
      };
    }
  }
  return result;
};
