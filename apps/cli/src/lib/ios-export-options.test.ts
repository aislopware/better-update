import { renderExportOptionsPlist } from "./ios-export-options";

// ── snapshot-style tests for each method ──────────────────────────

describe(renderExportOptionsPlist, () => {
  it("app-store method includes uploadSymbols=true", () => {
    const plist = renderExportOptionsPlist({
      method: "app-store",
      teamId: "ABCD1234EF",
      provisioningProfiles: [{ bundleId: "com.example.app", profileName: "My AppStore Profile" }],
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

  it("emits one provisioningProfiles entry per signed target", () => {
    const plist = renderExportOptionsPlist({
      method: "app-store",
      teamId: "ABCD1234EF",
      provisioningProfiles: [
        { bundleId: "com.example.app", profileName: "App AppStore" },
        { bundleId: "com.example.app.notification", profileName: "Notif AppStore" },
        { bundleId: "com.example.app.content", profileName: "Content AppStore" },
      ],
    });
    expect(plist).toContain("<key>com.example.app</key>\n\t\t<string>App AppStore</string>");
    expect(plist).toContain(
      "<key>com.example.app.notification</key>\n\t\t<string>Notif AppStore</string>",
    );
    expect(plist).toContain(
      "<key>com.example.app.content</key>\n\t\t<string>Content AppStore</string>",
    );
  });

  it("ad-hoc method omits uploadSymbols", () => {
    const plist = renderExportOptionsPlist({
      method: "ad-hoc",
      teamId: "ABCD1234EF",
      provisioningProfiles: [{ bundleId: "com.example.app", profileName: "My AdHoc Profile" }],
    });
    expect(plist).toContain("<string>ad-hoc</string>");
    expect(plist).not.toContain("uploadSymbols");
  });

  it("enterprise method omits uploadSymbols", () => {
    const plist = renderExportOptionsPlist({
      method: "enterprise",
      teamId: "XYZ9876543",
      provisioningProfiles: [{ bundleId: "com.enterprise.app", profileName: "Enterprise Profile" }],
    });
    expect(plist).toContain("<string>enterprise</string>");
    expect(plist).not.toContain("uploadSymbols");
  });

  it("development method omits uploadSymbols", () => {
    const plist = renderExportOptionsPlist({
      method: "development",
      teamId: "DEV1234567",
      provisioningProfiles: [{ bundleId: "com.dev.app", profileName: "Dev Profile" }],
    });
    expect(plist).toContain("<string>development</string>");
    expect(plist).not.toContain("uploadSymbols");
  });

  it("compileBitcode=true renders <true/>", () => {
    const plist = renderExportOptionsPlist({
      method: "ad-hoc",
      teamId: "ABCD1234EF",
      provisioningProfiles: [{ bundleId: "com.example.app", profileName: "My Profile" }],
      compileBitcode: true,
    });
    expect(plist).toContain("<key>compileBitcode</key>\n\t<true/>");
  });

  it("xML-escapes &, <, >, ', \" in bundleId and profile name", () => {
    const plist = renderExportOptionsPlist({
      method: "ad-hoc",
      teamId: "T1",
      provisioningProfiles: [{ bundleId: "com.a&b.app", profileName: '<test & "name">' }],
    });
    expect(plist).toContain("com.a&amp;b.app");
    expect(plist).toContain("&lt;test &amp; &quot;name&quot;&gt;");
    expect(plist).not.toContain("com.a&b.app");
    expect(plist).not.toContain('<test & "name">');
  });
});
