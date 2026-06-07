import { Effect } from "effect";

import { parseProvisioningProfile } from "./apple-provisioning-profile-parser";

const buildProfile = (body: string) =>
  new TextEncoder().encode(`binary-prefix<?xml version="1.0"?>\n<plist>${body}</plist>trailer`);

describe(parseProvisioningProfile, () => {
  it("parses app-store profile", async () => {
    const plist = `
      <dict>
        <key>TeamIdentifier</key><array><string>ABCDE12345</string></array>
        <key>TeamName</key><string>Example Corp Ltd</string>
        <key>application-identifier</key><string>ABCDE12345.com.example.app</string>
        <key>Name</key><string>Example Distribution</string>
        <key>UUID</key><string>12345678-1234-1234-1234-123456789012</string>
        <key>ExpirationDate</key><date>2027-01-01T00:00:00Z</date>
        <key>DeveloperCertificates</key><array><string>CERTBASE64</string></array>
      </dict>
    `;
    const result = await Effect.runPromise(parseProvisioningProfile(buildProfile(plist)));
    expect(result.appleTeamId).toBe("ABCDE12345");
    expect(result.teamName).toBe("Example Corp Ltd");
    expect(result.bundleIdentifier).toBe("com.example.app");
    expect(result.distributionType).toBe("APP_STORE");
    expect(result.validUntil).toMatch(/2027/);
    expect(result.certificateSerialNumbers).toStrictEqual(["CERTBASE64"]);
  });

  it("returns null teamName when TeamName key is absent", async () => {
    const plist = `
      <dict>
        <key>TeamIdentifier</key><array><string>ABCDE12345</string></array>
        <key>application-identifier</key><string>ABCDE12345.com.example.app</string>
      </dict>
    `;
    const result = await Effect.runPromise(parseProvisioningProfile(buildProfile(plist)));
    expect(result.teamName).toBeNull();
  });

  it("parses escaped values and application identifier from Entitlements", async () => {
    const plist = `
      <dict>
        <key>TeamIdentifier</key><array><string>ABCDE12345</string></array>
        <key>Entitlements</key>
        <dict>
          <key>application-identifier</key><string>ABCDE12345.com.example.&amp;app</string>
        </dict>
        <key>Name</key><string>Example &amp; Profile</string>
      </dict>
    `;
    const result = await Effect.runPromise(parseProvisioningProfile(buildProfile(plist)));
    expect(result.bundleIdentifier).toBe("com.example.&app");
    expect(result.profileName).toBe("Example & Profile");
  });

  it("infers AD_HOC from ProvisionedDevices", async () => {
    const plist = `
      <dict>
        <key>TeamIdentifier</key><array><string>ABCDE12345</string></array>
        <key>application-identifier</key><string>ABCDE12345.com.example.app</string>
        <key>ProvisionedDevices</key><array><string>00008030-001</string></array>
      </dict>
    `;
    const result = await Effect.runPromise(parseProvisioningProfile(buildProfile(plist)));
    expect(result.distributionType).toBe("AD_HOC");
  });

  it("infers DEVELOPMENT from get-task-allow", async () => {
    const plist = `
      <dict>
        <key>TeamIdentifier</key><array><string>ABCDE12345</string></array>
        <key>application-identifier</key><string>ABCDE12345.com.example.app</string>
        <key>ProvisionedDevices</key><array><string>device</string></array>
        <key>get-task-allow</key><true/>
      </dict>
    `;
    const result = await Effect.runPromise(parseProvisioningProfile(buildProfile(plist)));
    expect(result.distributionType).toBe("DEVELOPMENT");
  });

  it("infers ENTERPRISE from ProvisionsAllDevices", async () => {
    const plist = `
      <dict>
        <key>TeamIdentifier</key><array><string>ABCDE12345</string></array>
        <key>application-identifier</key><string>ABCDE12345.com.example.app</string>
        <key>ProvisionsAllDevices</key><true/>
      </dict>
    `;
    const result = await Effect.runPromise(parseProvisioningProfile(buildProfile(plist)));
    expect(result.distributionType).toBe("ENTERPRISE");
  });

  it("rejects missing plist", async () => {
    const error = await Effect.runPromise(
      Effect.flip(parseProvisioningProfile(new TextEncoder().encode("no-plist"))),
    );
    expect(error.message).toMatch(/plist/);
  });

  it("rejects missing TeamIdentifier", async () => {
    const plist = `<dict><key>application-identifier</key><string>X.com</string></dict>`;
    const error = await Effect.runPromise(
      Effect.flip(parseProvisioningProfile(buildProfile(plist))),
    );
    expect(error.message).toMatch(/TeamIdentifier/);
  });

  it("rejects missing application-identifier", async () => {
    const plist = `<dict><key>TeamIdentifier</key><array><string>ABCDE12345</string></array></dict>`;
    const error = await Effect.runPromise(
      Effect.flip(parseProvisioningProfile(buildProfile(plist))),
    );
    expect(error.message).toMatch(/application-identifier/);
  });
});
