import { deriveScopeKey } from "./scope-key";

describe(deriveScopeKey, () => {
  it("reduces an update URL to its origin (path stripped)", () => {
    expect(deriveScopeKey({ updateUrl: "https://updates.example.com/v1/manifest" })).toBe(
      "https://updates.example.com",
    );
  });

  it("strips query and fragment", () => {
    expect(deriveScopeKey({ updateUrl: "https://updates.example.com/manifest?foo=bar#frag" })).toBe(
      "https://updates.example.com",
    );
  });

  it("elides the default https port :443", () => {
    expect(deriveScopeKey({ updateUrl: "https://updates.example.com:443/manifest" })).toBe(
      "https://updates.example.com",
    );
  });

  it("elides the default http port :80", () => {
    expect(deriveScopeKey({ updateUrl: "http://updates.example.com:80/manifest" })).toBe(
      "http://updates.example.com",
    );
  });

  it("keeps a non-default port", () => {
    expect(deriveScopeKey({ updateUrl: "https://updates.example.com:8080/manifest" })).toBe(
      "https://updates.example.com:8080",
    );
  });

  it("lowercases scheme and host", () => {
    expect(deriveScopeKey({ updateUrl: "HTTPS://Updates.Example.COM/manifest" })).toBe(
      "https://updates.example.com",
    );
  });

  it("drops a trailing dot on the host", () => {
    expect(deriveScopeKey({ updateUrl: "https://updates.example.com./manifest" })).toBe(
      "https://updates.example.com",
    );
  });

  it("returns an explicit scopeKey verbatim, ignoring the update URL", () => {
    expect(
      deriveScopeKey({
        updateUrl: "https://updates.example.com/manifest",
        explicitScopeKey: "custom-scope-key",
      }),
    ).toBe("custom-scope-key");
  });

  // The load-bearing assertion: the better-update shape
  // `${PUBLIC_API_URL}/manifest/<projectId>` collapses to the origin only —
  // the `/manifest/<projectId>` path segment does NOT enter the scopeKey, so
  // every project served from one baseUrl shares a device scopeKey.
  it("drops the /manifest/<projectId> path for better-update served projects", () => {
    expect(
      deriveScopeKey({
        updateUrl: "https://updates.better-update.dev/manifest/proj_abc123",
      }),
    ).toBe("https://updates.better-update.dev");
  });

  it("derives the same origin for two different projects on the same baseUrl", () => {
    const first = deriveScopeKey({
      updateUrl: "https://updates.better-update.dev/manifest/proj_a",
    });
    const second = deriveScopeKey({
      updateUrl: "https://updates.better-update.dev/manifest/proj_b",
    });
    expect(first).toBe(second);
  });

  it("derives distinct scopeKeys for distinct origins (custom domain vs default)", () => {
    const custom = deriveScopeKey({ updateUrl: "https://ota.acme.com/manifest/proj_a" });
    const standard = deriveScopeKey({
      updateUrl: "https://updates.better-update.dev/manifest/proj_a",
    });
    expect(custom).not.toBe(standard);
  });

  // Totality guard: a malformed update URL must never throw on the manifest
  // path. It falls back to the raw input verbatim (still opaque + isolating).
  it("returns a malformed update URL verbatim instead of throwing", () => {
    expect(() => deriveScopeKey({ updateUrl: "not a url" })).not.toThrow();
    expect(deriveScopeKey({ updateUrl: "not a url" })).toBe("not a url");
  });
});
