import { hookScript } from "./build-hooks";

describe(hookScript, () => {
  it("returns the script body when the hook is declared", () => {
    const pkg = { scripts: { "eas-build-pre-install": "echo hi" } };
    expect(hookScript(pkg, "eas-build-pre-install")).toBe("echo hi");
  });

  it("returns undefined when the hook is absent", () => {
    expect(hookScript({ scripts: { build: "tsc" } }, "eas-build-on-success")).toBeUndefined();
  });

  it("returns undefined for empty scripts, missing scripts block, or malformed json", () => {
    expect(
      hookScript({ scripts: { "eas-build-post-install": "" } }, "eas-build-post-install"),
    ).toBeUndefined();
    expect(hookScript({}, "eas-build-post-install")).toBeUndefined();
    expect(hookScript(undefined, "eas-build-post-install")).toBeUndefined();
    expect(hookScript("not-an-object", "eas-build-post-install")).toBeUndefined();
    expect(
      hookScript({ scripts: { "eas-build-post-install": 42 } }, "eas-build-post-install"),
    ).toBeUndefined();
  });
});
