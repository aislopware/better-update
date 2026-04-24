import {
  buildDeviceRegistrationProfile,
  parseProfileCallbackPlist,
  renderRegistrationDoneHtml,
  renderRegistrationErrorHtml,
  renderRegistrationLandingHtml,
} from "./mobileconfig";

describe(buildDeviceRegistrationProfile, () => {
  const params = {
    requestId: "abc-123",
    callbackUrl: "https://example.com/register-device/abc-123/callback",
    organization: "Acme Inc",
    profileUuid: "11111111-2222-3333-4444-555555555555",
  };

  it("includes Profile Service payload type", () => {
    const xml = buildDeviceRegistrationProfile(params);
    expect(xml).toContain("<string>Profile Service</string>");
  });

  it("includes callback URL + challenge", () => {
    const xml = buildDeviceRegistrationProfile(params);
    expect(xml).toContain("<string>https://example.com/register-device/abc-123/callback</string>");
    expect(xml).toContain("<string>abc-123</string>");
  });

  it("requests UDID + product + device name attributes", () => {
    const xml = buildDeviceRegistrationProfile(params);
    expect(xml).toContain("<string>UDID</string>");
    expect(xml).toContain("<string>PRODUCT</string>");
    expect(xml).toContain("<string>DEVICE_NAME</string>");
  });

  it("escapes XML special chars in organization + URL", () => {
    const xml = buildDeviceRegistrationProfile({
      ...params,
      organization: "Acme & Co <test>",
      callbackUrl: "https://example.com/?a=1&b=2",
    });
    expect(xml).toContain("Acme &amp; Co &lt;test&gt;");
    expect(xml).toContain("https://example.com/?a=1&amp;b=2");
  });
});

describe(parseProfileCallbackPlist, () => {
  const samplePlist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>UDID</key>
  <string>00008030-001c45663c90802e</string>
  <key>PRODUCT</key>
  <string>iPhone14,2</string>
  <key>VERSION</key>
  <string>17.2</string>
  <key>DEVICE_NAME</key>
  <string>Alex's iPhone</string>
  <key>CHALLENGE</key>
  <string>abc-123</string>
</dict>
</plist>`;

  it("extracts every top-level string key/value", () => {
    const result = parseProfileCallbackPlist(samplePlist);
    expect(result["UDID"]).toBe("00008030-001c45663c90802e");
    expect(result["PRODUCT"]).toBe("iPhone14,2");
    expect(result["DEVICE_NAME"]).toBe("Alex's iPhone");
    expect(result["CHALLENGE"]).toBe("abc-123");
  });

  it("unescapes XML entities in callback values", () => {
    const result = parseProfileCallbackPlist(`<?xml version="1.0"?><plist><dict>
      <key>DEVICE_NAME</key><string>Alex &amp; Sam</string>
    </dict></plist>`);
    expect(result["DEVICE_NAME"]).toBe("Alex & Sam");
  });

  it("ignores nested string values", () => {
    const result = parseProfileCallbackPlist(`<?xml version="1.0"?><plist><dict>
      <key>UDID</key><string>top-level</string>
      <key>Nested</key><dict><key>UDID</key><string>nested</string></dict>
    </dict></plist>`);
    expect(result).toStrictEqual({ UDID: "top-level" });
  });

  it("returns empty record for unrelated body", () => {
    expect(parseProfileCallbackPlist("not xml")).toStrictEqual({});
  });

  it("ignores empty bodies", () => {
    expect(parseProfileCallbackPlist("")).toStrictEqual({});
  });
});

describe("registration HTML renderers", () => {
  it("landing page escapes hint + expiry", () => {
    const html = renderRegistrationLandingHtml({
      profileUrl: "https://host/register-device/abc/profile.mobileconfig",
      deviceNameHint: "Alex <script>alert(1)</script>",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(html).toContain("Alex &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("https://host/register-device/abc/profile.mobileconfig");
  });

  it("done page escapes device name", () => {
    const html = renderRegistrationDoneHtml("A&B");
    expect(html).toContain("A&amp;B");
  });

  it("error page escapes message", () => {
    const html = renderRegistrationErrorHtml("bad <tag>");
    expect(html).toContain("bad &lt;tag&gt;");
  });
});
