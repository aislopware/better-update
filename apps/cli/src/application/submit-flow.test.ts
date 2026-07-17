import { localPathFromArchiveValue } from "./submit-flow";

describe(localPathFromArchiveValue, () => {
  it("returns a plain filesystem path unchanged", () => {
    expect(localPathFromArchiveValue("/Users/me/app.ipa")).toBe("/Users/me/app.ipa");
    expect(localPathFromArchiveValue("./build/app.ipa")).toBe("./build/app.ipa");
  });

  it("converts a file:// URL to a filesystem path", () => {
    expect(localPathFromArchiveValue("file:///tmp/app.ipa")).toBe("/tmp/app.ipa");
  });
});
