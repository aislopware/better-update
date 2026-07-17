import { fallbackPasswordAuth, pickIosUploader, resolveIosUploadAuth } from "./submit-ios-upload";

describe(resolveIosUploadAuth, () => {
  it("prefers the ASC API key even when an app-specific password is configured", () => {
    expect(
      resolveIosUploadAuth({
        appleId: "dev@example.com",
        ascApiKeyId: "key-123",
        hasAppSpecificPassword: true,
      }),
    ).toStrictEqual({ kind: "asc-api-key", ascApiKeyId: "key-123" });
  });

  it("falls back to the app-specific password when no ASC key is configured", () => {
    expect(
      resolveIosUploadAuth({
        appleId: "dev@example.com",
        ascApiKeyId: undefined,
        hasAppSpecificPassword: true,
      }),
    ).toStrictEqual({ kind: "app-specific-password", appleId: "dev@example.com" });
  });

  it("ignores the password when it lacks an appleId", () => {
    expect(
      resolveIosUploadAuth({
        appleId: undefined,
        ascApiKeyId: "key-123",
        hasAppSpecificPassword: true,
      }),
    ).toStrictEqual({ kind: "asc-api-key", ascApiKeyId: "key-123" });
  });

  it("treats a blank ascApiKeyId as absent so the password path can win", () => {
    expect(
      resolveIosUploadAuth({
        appleId: "dev@example.com",
        ascApiKeyId: "  ",
        hasAppSpecificPassword: true,
      }),
    ).toStrictEqual({ kind: "app-specific-password", appleId: "dev@example.com" });
  });

  it("uses the ASC API key when no app-specific password is set", () => {
    expect(
      resolveIosUploadAuth({
        appleId: "dev@example.com",
        ascApiKeyId: "key-123",
        hasAppSpecificPassword: false,
      }),
    ).toStrictEqual({ kind: "asc-api-key", ascApiKeyId: "key-123" });
  });

  it("returns null when neither auth method is configured", () => {
    expect(
      resolveIosUploadAuth({
        appleId: undefined,
        ascApiKeyId: undefined,
        hasAppSpecificPassword: false,
      }),
    ).toBeNull();
    // Env password set but no appleId and no ASC key → still unusable.
    expect(
      resolveIosUploadAuth({
        appleId: undefined,
        ascApiKeyId: undefined,
        hasAppSpecificPassword: true,
      }),
    ).toBeNull();
  });
});

describe(fallbackPasswordAuth, () => {
  it("degrades to the app-specific password when the pair is configured", () => {
    expect(
      fallbackPasswordAuth({ appleId: "dev@example.com", hasAppSpecificPassword: true }),
    ).toStrictEqual({ kind: "app-specific-password", appleId: "dev@example.com" });
  });

  it("returns null when either half of the pair is missing", () => {
    expect(fallbackPasswordAuth({ appleId: undefined, hasAppSpecificPassword: true })).toBeNull();
    expect(
      fallbackPasswordAuth({ appleId: "dev@example.com", hasAppSpecificPassword: false }),
    ).toBeNull();
  });
});

describe(pickIosUploader, () => {
  const ascAuth = { kind: "asc-api-key", ascApiKeyId: "key-123" } as const;
  const ipaInfo = { buildVersion: "42", shortVersion: "1.2.3" };

  it("picks the Build Upload API when the key, creds, and IPA versions are available", () => {
    expect(
      pickIosUploader({ auth: ascAuth, hasAscCredentials: true, ipaInfo, forceAltool: false }),
    ).toBe("asc-build-upload-api");
  });

  it("falls back to altool for the app-specific-password auth", () => {
    expect(
      pickIosUploader({
        auth: { kind: "app-specific-password", appleId: "dev@example.com" },
        hasAscCredentials: false,
        ipaInfo,
        forceAltool: false,
      }),
    ).toBe("altool");
  });

  it("falls back to altool when the IPA versions could not be read", () => {
    expect(
      pickIosUploader({
        auth: ascAuth,
        hasAscCredentials: true,
        ipaInfo: null,
        forceAltool: false,
      }),
    ).toBe("altool");
    expect(
      pickIosUploader({
        auth: ascAuth,
        hasAscCredentials: true,
        ipaInfo: { buildVersion: "42", shortVersion: undefined },
        forceAltool: false,
      }),
    ).toBe("altool");
  });

  it("falls back to altool when the decrypted credentials are missing", () => {
    expect(
      pickIosUploader({ auth: ascAuth, hasAscCredentials: false, ipaInfo, forceAltool: false }),
    ).toBe("altool");
  });

  it("honors the BETTER_UPDATE_IOS_UPLOADER=altool escape hatch", () => {
    expect(
      pickIosUploader({ auth: ascAuth, hasAscCredentials: true, ipaInfo, forceAltool: true }),
    ).toBe("altool");
  });
});
