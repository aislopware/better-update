import chalk from "chalk";

import { isWarningLine, styleWarningLine } from "./warning-style";

// Force chalk to emit ANSI even though vitest pipes stdout (no TTY).
chalk.level = 2;

describe(isWarningLine, () => {
  describe("positive matches", () => {
    it.each([
      ["warning:", "warning: 'foo' is deprecated"],
      ["[!] CocoaPods", "[!] CocoaPods could not find compatible versions"],
      ["WARNING: prefix", "WARNING: something happened"],
      ["WARN log level", "WARN  something happened"],
      [
        "is deprecated phrase",
        "Command line name 'app-store' is deprecated. Use 'app-store-connect'",
      ],
      ["DEPRECATION header", "DEPRECATION NOTICE"],
      ["[MT] Xcode tag", `[MT] IDEDistribution: Command line name "app-store" is deprecated.`],
      ["⚠ emoji", "⚠ heads up"],
      ["leading whitespace", "   warning: indented"],
    ])("matches %s", (_label, input) => {
      expect(isWarningLine(input)).toBe(true);
    });

    it("matches lines pre-colored with ANSI yellow", () => {
      const ansiYellow = `[33mwarning: stuff[0m`;
      expect(isWarningLine(ansiYellow)).toBe(true);
    });
  });

  describe("negative matches (false-positive guards)", () => {
    it.each([
      ["status summary", "0 warnings, 1 error"],
      ["path containing word", "/home/user/warnings/foo.txt"],
      ["non-warning info", "Pod install took 19 [s] to run"],
      ["unrelated bracket", "[INFO] Building"],
      ["random text", "Hello, world"],
      ["empty", ""],
    ])("rejects %s", (_label, input) => {
      expect(isWarningLine(input)).toBe(false);
    });
  });
});

describe(styleWarningLine, () => {
  it("colors plain lines fully yellow with ⚠ prefix", () => {
    const styled = styleWarningLine("warning: foo");
    expect(styled).toContain("⚠");
    // Yellow SGR is `[33m`
    expect(styled).toContain("[33m");
    expect(styled).toContain("warning: foo");
  });

  it("preserves existing ANSI in pre-colored lines, only prepends marker", () => {
    const preColored = `[31m[!] something[0m`;
    const styled = styleWarningLine(preColored);
    expect(styled).toContain("⚠");
    // Original red SGR intact
    expect(styled).toContain("[31m");
    // Our marker is yellow
    expect(styled.startsWith(`[33m`)).toBe(true);
  });
});
