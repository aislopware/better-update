import { parseLipoArchs } from "./macos-app-info";

describe(parseLipoArchs, () => {
  it("splits a universal binary's slices", () => {
    expect(parseLipoArchs("x86_64 arm64\n")).toStrictEqual(["x86_64", "arm64"]);
  });

  it("returns nothing for empty output", () => {
    expect(parseLipoArchs("\n")).toStrictEqual([]);
  });
});
