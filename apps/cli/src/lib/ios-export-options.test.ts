import { renderExportOptionsPlist } from "./ios-export-options";

// ── snapshot-style tests for each method ──────────────────────────

describe(renderExportOptionsPlist, () => {
  test("app-store method includes uploadSymbols=true", () => {
    const plist = renderExportOptionsPlist({
      method: "app-store",
      teamId: "ABCD1234EF",
      bundleId: "com.example.app",
      provisioningProfileName: "My AppStore Profile",
    });
    expect(plist).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
      <dict>
      	<key>method</key>
      	<string>app-store</string>
      	<key>teamID</key>
      	<string>ABCD1234EF</string>
      	<key>signingStyle</key>
      	<string>manual</string>
      	<key>compileBitcode</key>
      	<false/>
      	<key>provisioningProfiles</key>
      	<dict>
      		<key>com.example.app</key>
      		<string>My AppStore Profile</string>
      	</dict>
      	<key>uploadSymbols</key>
      	<true/>
      </dict>
      </plist>
      "
    `);
  });

  test("ad-hoc method omits uploadSymbols", () => {
    const plist = renderExportOptionsPlist({
      method: "ad-hoc",
      teamId: "ABCD1234EF",
      bundleId: "com.example.app",
      provisioningProfileName: "My AdHoc Profile",
    });
    expect(plist).toContain("<string>ad-hoc</string>");
    expect(plist).not.toContain("uploadSymbols");
  });

  test("enterprise method omits uploadSymbols", () => {
    const plist = renderExportOptionsPlist({
      method: "enterprise",
      teamId: "XYZ9876543",
      bundleId: "com.enterprise.app",
      provisioningProfileName: "Enterprise Profile",
    });
    expect(plist).toContain("<string>enterprise</string>");
    expect(plist).not.toContain("uploadSymbols");
  });

  test("development method omits uploadSymbols", () => {
    const plist = renderExportOptionsPlist({
      method: "development",
      teamId: "DEV1234567",
      bundleId: "com.dev.app",
      provisioningProfileName: "Dev Profile",
    });
    expect(plist).toContain("<string>development</string>");
    expect(plist).not.toContain("uploadSymbols");
  });

  test("compileBitcode=true renders <true/>", () => {
    const plist = renderExportOptionsPlist({
      method: "ad-hoc",
      teamId: "ABCD1234EF",
      bundleId: "com.example.app",
      provisioningProfileName: "My Profile",
      compileBitcode: true,
    });
    expect(plist).toContain("<key>compileBitcode</key>\n\t<true/>");
  });

  test("XML-escapes &, <, >, ', \" in bundleId and profile name", () => {
    const plist = renderExportOptionsPlist({
      method: "ad-hoc",
      teamId: "T1",
      bundleId: "com.a&b.app",
      provisioningProfileName: '<test & "name">',
    });
    // BundleId escaped
    expect(plist).toContain("com.a&amp;b.app");
    // Profile name escaped
    expect(plist).toContain("&lt;test &amp; &quot;name&quot;&gt;");
    // No raw special chars present inside the escaped segments
    expect(plist).not.toContain("com.a&b.app");
    expect(plist).not.toContain('<test & "name">');
  });
});
