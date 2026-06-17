import { localPathFromArchiveValue, resolveIosUploadAuth } from "./submit-flow";

describe(localPathFromArchiveValue, () => {
  it("returns a plain filesystem path unchanged", () => {
    expect(localPathFromArchiveValue("/Users/me/app.ipa")).toBe("/Users/me/app.ipa");
    expect(localPathFromArchiveValue("./build/app.ipa")).toBe("./build/app.ipa");
  });

  it("converts a file:// URL to a filesystem path", () => {
    expect(localPathFromArchiveValue("file:///tmp/app.ipa")).toBe("/tmp/app.ipa");
  });
});

describe(resolveIosUploadAuth, () => {
  it("prefers the app-specific password when the env var and appleId are present", () => {
    expect(
      resolveIosUploadAuth({
        appleId: "dev@example.com",
        ascApiKeyId: "key-123",
        hasAppSpecificPassword: true,
      }),
    ).toStrictEqual({ kind: "app-specific-password", appleId: "dev@example.com" });
  });

  it("falls back to the ASC API key when the password lacks an appleId", () => {
    expect(
      resolveIosUploadAuth({
        appleId: undefined,
        ascApiKeyId: "key-123",
        hasAppSpecificPassword: true,
      }),
    ).toStrictEqual({ kind: "asc-api-key", ascApiKeyId: "key-123" });
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
