import { DesktopArch } from "@better-update/api";
import { asRecord, asVersionSlot, compact } from "@better-update/type-guards";
import { Schema } from "effect";

import { asStringValue } from "./eas-profile-extends";

/**
 * The `windows` / `linux` section of an eas.json build profile — a
 * better-update extension (EAS builds neither). The build itself is a
 * `custom.<platform>` command (electron-builder, Tauri, anything); this
 * section only fills in what the artifact cannot say about itself.
 */
export interface EasDesktopProfile {
  /** The architectures the artifacts install when neither their bytes nor their names say. */
  readonly arch?: readonly DesktopArch[];
  /** Product name the feeds name downloads after. Default: Tauri `productName`, else package.json. */
  readonly appName?: string;
  /** Default: Tauri `identifier`, else electron-builder `appId`. */
  readonly bundleIdentifier?: string;
  readonly version?: string;
  readonly buildNumber?: string;
  /** Windows only: the oldest Windows build the app runs on, e.g. `10.0.17763`. */
  readonly minimumSystemVersion?: string;
  /** Windows only: the WinSparkle EdDSA public key the app verifies updates with. */
  readonly winSparklePublicKey?: string;
}

const isDesktopArch = Schema.is(DesktopArch);

/** One arch or a list of them; anything unknown makes the whole value invalid. */
const asArchList = (raw: unknown): readonly DesktopArch[] | undefined => {
  const values: readonly unknown[] = Array.isArray(raw) ? raw : [raw];
  return raw !== undefined && values.length > 0 && values.every(isDesktopArch) ? values : undefined;
};

export const parseDesktopProfile = (raw: unknown): EasDesktopProfile | undefined => {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  return compact({
    arch: asArchList(record["arch"]),
    appName: asStringValue(record["appName"]),
    bundleIdentifier: asStringValue(record["bundleIdentifier"]),
    version: asStringValue(record["version"]),
    buildNumber: asVersionSlot(record["buildNumber"]),
    minimumSystemVersion: asStringValue(record["minimumSystemVersion"]),
    winSparklePublicKey: asStringValue(record["winSparklePublicKey"]),
  });
};
