import { planAscAuth, tokenFallbackNote } from "./asc-auth-plan";

describe(planAscAuth, () => {
  it("prefers the flag over the submit profile", () => {
    expect(planAscAuth({ flagKeyId: "flag-key", profileKeyId: "profile-key" })).toStrictEqual({
      mode: "token",
      ascApiKeyId: "flag-key",
    });
  });

  it("uses the submit profile key when no flag is passed", () => {
    expect(planAscAuth({ profileKeyId: "profile-key" })).toStrictEqual({
      mode: "token",
      ascApiKeyId: "profile-key",
    });
  });

  it("falls back to the cookie path when nothing is configured", () => {
    expect(planAscAuth({})).toStrictEqual({ mode: "cookie" });
    expect(planAscAuth({ flagKeyId: undefined, profileKeyId: undefined })).toStrictEqual({
      mode: "cookie",
    });
  });

  it("treats blank values as absent", () => {
    expect(planAscAuth({ flagKeyId: "  ", profileKeyId: "" })).toStrictEqual({ mode: "cookie" });
    expect(planAscAuth({ flagKeyId: "", profileKeyId: "profile-key" })).toStrictEqual({
      mode: "token",
      ascApiKeyId: "profile-key",
    });
  });

  it("trims the configured key id", () => {
    expect(planAscAuth({ flagKeyId: " flag-key " })).toStrictEqual({
      mode: "token",
      ascApiKeyId: "flag-key",
    });
  });
});

describe(tokenFallbackNote, () => {
  it("names the key and the reason", () => {
    expect(tokenFallbackNote("key-1", "decrypt declined")).toBe(
      "Could not authenticate with App Store Connect API key key-1 (decrypt declined); falling back to Apple ID login.",
    );
  });
});
