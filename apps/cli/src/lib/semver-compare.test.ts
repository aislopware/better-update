import { isNewerVersion } from "./semver-compare";

describe(isNewerVersion, () => {
  it("major bump", () => {
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
  });

  it("minor bump", () => {
    expect(isNewerVersion("0.9.0", "0.8.5")).toBe(true);
  });

  it("patch bump", () => {
    expect(isNewerVersion("0.8.2", "0.8.1")).toBe(true);
  });

  it("equal versions", () => {
    expect(isNewerVersion("0.8.1", "0.8.1")).toBe(false);
  });

  it("older latest", () => {
    expect(isNewerVersion("0.8.0", "0.8.1")).toBe(false);
  });

  it("strips prerelease", () => {
    expect(isNewerVersion("0.9.0-beta.1", "0.8.1")).toBe(true);
    expect(isNewerVersion("0.8.1", "0.8.1-beta.1")).toBe(false);
    expect(isNewerVersion("0.8.1-beta.1", "0.8.0")).toBe(true);
  });

  it("missing patch component treated as zero", () => {
    expect(isNewerVersion("1.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.8", "0.8.1")).toBe(false);
  });

  it("non-numeric version parses to zeros (no false-positive warn)", () => {
    expect(isNewerVersion("v1.0.0", "0.9.9")).toBe(false);
  });
});
