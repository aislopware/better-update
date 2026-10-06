import path from "node:path";

import { FileSystem, Effect } from "effect";

import type { Scope } from "effect";

import { ProvisioningError } from "./exit-codes";
import { parsePlistXml } from "./plist";
import { profilePlistXml } from "./provisioning-profile-plist";
import { xcodeProfileDirectories } from "./xcode-profile-dirs";

import type { PlistObject } from "./plist";

// ── pure extraction ───────────────────────────────────────────────

export interface ProvisioningInfo {
  readonly uuid: string;
  readonly name: string;
  readonly teamId: string;
}

const getString = (obj: PlistObject, key: string): string | undefined => {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
};

const getFirstArrayString = (obj: PlistObject, key: string): string | undefined => {
  const value = obj[key];
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
};

/**
 * Extract `UUID`, `Name`, and the first `TeamIdentifier` from a profile's
 * XML plist. Returns `ProvisioningError` when any
 * of the three fields are missing.
 */
export const extractProvisioningInfo = (
  plistXml: string,
): Effect.Effect<ProvisioningInfo, ProvisioningError> =>
  Effect.gen(function* () {
    const parsed: PlistObject = yield* Effect.try({
      try: () => parsePlistXml(plistXml),
      catch: (error) =>
        new ProvisioningError({
          message: `Failed to parse provisioning profile plist: ${error instanceof Error ? error.message : String(error)}`,
        }),
    });

    const uuid = getString(parsed, "UUID");
    const name = getString(parsed, "Name");
    const teamId = getFirstArrayString(parsed, "TeamIdentifier");

    if (!uuid || !name || !teamId) {
      return yield* new ProvisioningError({
        message:
          `Failed to parse provisioning profile: missing ${uuid ? "" : "UUID "}${name ? "" : "Name "}${teamId ? "" : "TeamIdentifier "}`.trim(),
      });
    }

    return { uuid, name, teamId };
  });

// ── scoped installation ───────────────────────────────────────────

export interface InstallProvisioningProfileOptions {
  readonly profilePath: string;
}

export interface InstalledProvisioning {
  readonly uuid: string;
  readonly name: string;
  readonly teamId: string;
  readonly installedPath: string;
}

interface AcquiredProvisioning extends InstalledProvisioning {
  /**
   * True if we installed the profile (so release should delete it).
   * False if the profile was already present (e.g., installed by Xcode) —
   * in that case we leave it alone on release to avoid breaking the user's
   * other signing operations.
   */
  readonly ownsInstallation: boolean;
}

/**
 * Scoped installation of a provisioning profile: parses its metadata, copies it into `~/Library/MobileDevice/Provisioning Profiles`
 * under `<uuid>.mobileprovision`, and removes the copy on scope close — but
 * only if we installed it. If the target file already existed when we arrived
 * (e.g., Xcode had it), we leave both the file and the contents untouched.
 */
export const installProvisioningProfile = ({
  profilePath,
}: InstallProvisioningProfileOptions): Effect.Effect<
  InstalledProvisioning,
  ProvisioningError,
  FileSystem.FileSystem | Scope.Scope
> =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const plistXml = yield* fs.readFile(profilePath).pipe(
        Effect.map(profilePlistXml),
        Effect.catch(
          (error) =>
            new ProvisioningError({
              message: `Could not read the provisioning profile ${profilePath}: ${String(error)}`,
            }),
        ),
        Effect.flatMap((xml) =>
          xml === undefined
            ? Effect.fail(
                new ProvisioningError({
                  message: `${profilePath} is not a provisioning profile (no property list in it).`,
                }),
              )
            : Effect.succeed(xml),
        ),
      );

      const info = yield* extractProvisioningInfo(plistXml);
      const targetDir = (yield* xcodeProfileDirectories).mobileDevice;
      const installedPath = path.join(targetDir, `${info.uuid}.mobileprovision`);

      yield* fs.makeDirectory(targetDir, { recursive: true }).pipe(
        Effect.catch(
          (error) =>
            new ProvisioningError({
              message: `Failed to create provisioning profiles dir: ${String(error)}`,
            }),
        ),
      );

      const alreadyInstalled = yield* fs
        .exists(installedPath)
        .pipe(Effect.orElseSucceed(() => false));

      if (alreadyInstalled) {
        return {
          ...info,
          installedPath,
          ownsInstallation: false,
        } satisfies AcquiredProvisioning;
      }

      yield* fs.copyFile(profilePath, installedPath).pipe(
        Effect.catch(
          (error) =>
            new ProvisioningError({
              message: `Failed to copy provisioning profile into ${installedPath}: ${String(error)}`,
            }),
        ),
      );

      return {
        ...info,
        installedPath,
        ownsInstallation: true,
      } satisfies AcquiredProvisioning;
    }),
    (acquired) =>
      Effect.gen(function* () {
        if (!acquired.ownsInstallation) {
          return;
        }
        const fs = yield* FileSystem.FileSystem;
        yield* fs.remove(acquired.installedPath).pipe(Effect.catch(() => Effect.void));
      }),
  ).pipe(
    Effect.map<AcquiredProvisioning, InstalledProvisioning>(
      ({ uuid, name, teamId, installedPath }) => ({
        uuid,
        name,
        teamId,
        installedPath,
      }),
    ),
  );
