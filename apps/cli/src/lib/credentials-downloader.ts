import { Effect } from "effect";

import type { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";

import { MissingCredentialsError } from "./exit-codes";

import type { ApiClient } from "../services/api-client";

export interface DownloadIosCredentialsOptions {
  readonly projectId: string;
  readonly distribution: string;
  readonly tempDir: string;
}

export interface IosCredentials {
  readonly p12Path: string;
  readonly p12Password: string;
  readonly profilePath: string;
  readonly profileFilename: string;
  readonly teamId?: string;
}

const notWiredHint =
  "Build pipeline not yet migrated to new credential tables. Bind via iOS Bundle Configuration in the dashboard.";

export const downloadIosCredentials = (
  _api: ApiClient,
  _options: DownloadIosCredentialsOptions,
): Effect.Effect<IosCredentials, MissingCredentialsError | PlatformError, FileSystem.FileSystem> =>
  Effect.fail(
    new MissingCredentialsError({
      message: "iOS credential download from the new credential store is not yet implemented.",
      hint: notWiredHint,
    }),
  );

export interface DownloadAndroidCredentialsOptions {
  readonly projectId: string;
  readonly tempDir: string;
}

export interface AndroidCredentials {
  readonly keystorePath: string;
  readonly storePassword: string;
  readonly keyAlias: string;
  readonly keyPassword: string;
}

export const downloadAndroidCredentials = (
  _api: ApiClient,
  _options: DownloadAndroidCredentialsOptions,
): Effect.Effect<
  AndroidCredentials,
  MissingCredentialsError | PlatformError,
  FileSystem.FileSystem
> =>
  Effect.fail(
    new MissingCredentialsError({
      message: "Android credential download from the new credential store is not yet implemented.",
      hint: notWiredHint,
    }),
  );
