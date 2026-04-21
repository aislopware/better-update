export type ExportMethod = "app-store" | "ad-hoc" | "enterprise" | "development";

export interface RenderExportOptionsPlistInput {
  readonly method: ExportMethod;
  readonly teamId: string;
  readonly bundleId: string;
  readonly provisioningProfileName: string;
  readonly compileBitcode?: boolean;
}

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
 * - `provisioningProfiles` dict maps bundleId → profile name
 * - `compileBitcode` defaults to `false`
 */
export const renderExportOptionsPlist = ({
  method,
  teamId,
  bundleId,
  provisioningProfileName,
  compileBitcode = false,
}: RenderExportOptionsPlistInput): string => {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>method</key>",
    `\t<string>${escapeXml(method)}</string>`,
    "\t<key>teamID</key>",
    `\t<string>${escapeXml(teamId)}</string>`,
    "\t<key>signingStyle</key>",
    "\t<string>manual</string>",
    "\t<key>compileBitcode</key>",
    `\t${boolTag(compileBitcode)}`,
    "\t<key>provisioningProfiles</key>",
    "\t<dict>",
    `\t\t<key>${escapeXml(bundleId)}</key>`,
    `\t\t<string>${escapeXml(provisioningProfileName)}</string>`,
    "\t</dict>",
  ];

  if (method === "app-store") {
    lines.push("\t<key>uploadSymbols</key>", "\t<true/>");
  }

  lines.push("</dict>", "</plist>", "");
  return lines.join("\n");
};
