export type ExportMethod = "app-store" | "ad-hoc" | "enterprise" | "development";

export interface ProvisioningProfileMapping {
  readonly bundleId: string;
  readonly profileName: string;
}

export interface RenderExportOptionsPlistInput {
  readonly method: ExportMethod;
  readonly teamId: string;
  readonly provisioningProfiles: readonly ProvisioningProfileMapping[];
  readonly compileBitcode?: boolean;
}

// Xcode 15.3+ renamed the ExportOptions.plist `method` strings; the legacy
// names still work but emit a deprecation warning under xcodebuild. Keep the
// user-facing names (eas.json, CLI flags) and translate at the plist boundary.
const XCODE_METHOD: Record<ExportMethod, string> = {
  "app-store": "app-store-connect",
  "ad-hoc": "release-testing",
  development: "debugging",
  enterprise: "enterprise",
};

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const boolTag = (value: boolean): string => (value ? "<true/>" : "<false/>");

/**
 * Render an Xcode `ExportOptions.plist` for `xcodebuild -exportArchive`.
 *
 * - `signingStyle` is always `manual` (ephemeral keychain + downloaded profile)
 * - `uploadSymbols` is emitted only for `app-store` exports
 * - `provisioningProfiles` dict maps each bundleId → profile name (one entry
 *   per signed target: main app + any extensions like notification service)
 * - `compileBitcode` defaults to `false`
 */
export const renderExportOptionsPlist = ({
  method,
  teamId,
  provisioningProfiles,
  compileBitcode = false,
}: RenderExportOptionsPlistInput): string => {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>method</key>",
    `\t<string>${escapeXml(XCODE_METHOD[method])}</string>`,
    "\t<key>teamID</key>",
    `\t<string>${escapeXml(teamId)}</string>`,
    "\t<key>signingStyle</key>",
    "\t<string>manual</string>",
    "\t<key>compileBitcode</key>",
    `\t${boolTag(compileBitcode)}`,
    "\t<key>provisioningProfiles</key>",
    "\t<dict>",
  ];

  for (const { bundleId, profileName } of provisioningProfiles) {
    lines.push(
      `\t\t<key>${escapeXml(bundleId)}</key>`,
      `\t\t<string>${escapeXml(profileName)}</string>`,
    );
  }
  lines.push("\t</dict>");

  if (method === "app-store") {
    lines.push("\t<key>uploadSymbols</key>", "\t<true/>");
  }

  lines.push("</dict>", "</plist>", "");
  return lines.join("\n");
};
