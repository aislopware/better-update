import {
  buildCliApiKeyName,
  buildCliCallbackRedirect,
  buildCliLoginRedirectTarget,
  isAllowedCliCallbackUrl,
} from "./cli-login";

describe("cli-login helpers", () => {
  it("accepts localhost callback URLs", () => {
    expect(isAllowedCliCallbackUrl("http://127.0.0.1:54321/callback")).toBe(true);
    expect(isAllowedCliCallbackUrl("http://localhost:3000/callback/token")).toBe(true);
  });

  it("rejects non-local or https callback URLs", () => {
    expect(isAllowedCliCallbackUrl("https://127.0.0.1:54321/callback")).toBe(false);
    expect(isAllowedCliCallbackUrl("http://example.com/callback")).toBe(false);
    expect(isAllowedCliCallbackUrl("data:text/plain,evil")).toBe(false);
  });

  it("builds callback redirect with token in hash", () => {
    expect(buildCliCallbackRedirect("http://127.0.0.1:4321/callback", "bu_secret_123")).toBe(
      "http://127.0.0.1:4321/callback#token=bu_secret_123",
    );
    expect(
      buildCliCallbackRedirect("http://127.0.0.1:4321/callback#state=abc", "bu_secret_123"),
    ).toBe("http://127.0.0.1:4321/callback#state=abc&token=bu_secret_123");
  });

  it("builds redirect target back to cli-login route", () => {
    expect(buildCliLoginRedirectTarget("http://127.0.0.1:4321/callback")).toBe(
      "/cli-login?callbackUrl=http%3A%2F%2F127.0.0.1%3A4321%2Fcallback",
    );
  });

  it("formats deterministic CLI API key names", () => {
    expect(buildCliApiKeyName(new Date("2026-04-13T12:34:56.789Z"))).toBe(
      "CLI Login 2026-04-13T12:34:56",
    );
  });
});
