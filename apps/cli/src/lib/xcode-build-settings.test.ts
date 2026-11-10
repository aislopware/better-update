import { xcodeCompileSettings } from "./xcode-build-settings";

describe(xcodeCompileSettings, () => {
  it("turns off index-while-building by default", () => {
    expect(xcodeCompileSettings({})).toStrictEqual(["COMPILER_INDEX_STORE_ENABLE=NO"]);
  });

  it("keeps indexing when BETTER_UPDATE_XCODE_INDEX_STORE=1", () => {
    expect(xcodeCompileSettings({ BETTER_UPDATE_XCODE_INDEX_STORE: "1" })).toStrictEqual([]);
  });
});
