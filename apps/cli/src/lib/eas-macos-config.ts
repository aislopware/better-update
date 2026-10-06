import { asRecord, asVersionSlot, compact } from "@better-update/type-guards";

import { asBooleanValue, asStringValue } from "./eas-profile-extends";

/** Containers a Developer ID build ships in (`tar.gz`: the Tauri updater's `.app.tar.gz`). */
export type EasMacosArtifact = "dmg" | "zip" | "pkg" | "tar.gz";

/**
 * The `macos` section of an eas.json build profile — a better-update extension
 * (EAS builds no macOS). Developer ID is the only distribution: the Mac App
 * Store goes through Transporter with a different certificate and sandboxing
 * rules, and is out of scope.
 */
export interface EasMacosProfile {
  readonly distribution?: "developer-id";
  /** Explicit `.xcworkspace` path (relative to project root). Else auto-discover. */
  readonly workspace?: string;
  /** Explicit `.xcodeproj` path when there is no workspace. */
  readonly project?: string;
  readonly scheme?: string;
  readonly buildConfiguration?: string;
  /** Run `pod install` before xcodebuild. Defaults to true when a Podfile exists. */
  readonly podInstall?: boolean;
  /** Container to ship. Default `dmg`. */
  readonly artifact?: EasMacosArtifact;
  /** Notarize + staple. Default true — Gatekeeper blocks an unnotarized download. */
  readonly notarize?: boolean;
  /** Stop waiting for Apple after this long (`notarytool --timeout`, e.g. "45m"). */
  readonly notarizeTimeout?: string;
  /** Vault ASC API key that notarizes (see `credentials list`). */
  readonly ascApiKeyId?: string;
  /** Build `arm64` and `x86_64` even where Xcode's default would drop Intel. */
  readonly universal?: boolean;
  /** Entitlements for the outer app when the CLI (re-)signs it. */
  readonly entitlements?: string;
  /** Metadata overrides — fallback when the built app cannot be read. */
  readonly bundleIdentifier?: string;
  readonly version?: string;
  readonly buildNumber?: string;
}

const asMacosArtifact = (raw: unknown): EasMacosArtifact | undefined => {
  const value = asStringValue(raw);
  return value === "dmg" || value === "zip" || value === "pkg" || value === "tar.gz"
    ? value
    : undefined;
};

export const parseMacosProfile = (raw: unknown): EasMacosProfile | undefined => {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  return compact({
    distribution:
      asStringValue(record["distribution"]) === "developer-id"
        ? ("developer-id" as const)
        : undefined,
    workspace: asStringValue(record["workspace"]),
    project: asStringValue(record["project"]),
    scheme: asStringValue(record["scheme"]),
    buildConfiguration: asStringValue(record["buildConfiguration"]),
    podInstall: asBooleanValue(record["podInstall"]),
    artifact: asMacosArtifact(record["artifact"]),
    notarize: asBooleanValue(record["notarize"]),
    notarizeTimeout: asStringValue(record["notarizeTimeout"]),
    ascApiKeyId: asStringValue(record["ascApiKeyId"]),
    universal: asBooleanValue(record["universal"]),
    entitlements: asStringValue(record["entitlements"]),
    bundleIdentifier: asStringValue(record["bundleIdentifier"]),
    version: asStringValue(record["version"]),
    buildNumber: asVersionSlot(record["buildNumber"]),
  });
};
