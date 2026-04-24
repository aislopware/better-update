import { parseUserAgent } from "./user-agent";

describe(parseUserAgent, () => {
  it("detects Android before generic Linux", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome on Android");
  });

  it("detects iOS before macOS-like mobile tokens", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iOS");
  });
});
