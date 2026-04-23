import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Static analysis guard: ensures app components use semantic CSS tokens
 * instead of hardcoded color values. This prevents dark mode regressions.
 *
 * Scans all .tsx files in apps/web/src (excluding test files).
 */

const APP_SRC = join(import.meta.dirname, "..");
const TEST_SUFFIX = /\.test\.tsx?$/;

const HARDCODED_HEX = /#[0-9a-f]{3,8}\b/gi;
const HARDCODED_RGB = /\b(?:rgb|rgba|hsl|hsla)\s*\(/gi;
const HARDCODED_TAILWIND_COLORS =
  /\b(?:bg|text|border|ring|outline|shadow|accent|fill|stroke|caret|decoration)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

const walk = (dir: string): string[] => {
  const entries: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walk(full));
    } else if (entry.name.endsWith(".tsx")) {
      entries.push(full);
    }
  }
  return entries;
};

const extractClassNames = (content: string): string[] => {
  const matches: string[] = [];
  const patterns = [/className="([^"]+)"/g, /className=\{`([^`]+)`\}/g];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      matches.push(match[1]!);
    }
  }
  return matches;
};

describe("cSS audit: no hardcoded colors in app code", () => {
  const files = walk(APP_SRC).filter((file) => !TEST_SUFFIX.test(file));

  it("found app .tsx files to audit", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no hex color values in className attributes", () => {
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const cn of extractClassNames(content)) {
        const hexMatches = cn.match(HARDCODED_HEX);
        if (hexMatches) {
          violations.push(`${file.replace(APP_SRC, "")}: ${hexMatches.join(", ")}`);
        }
      }
    }

    expect(violations).toStrictEqual([]);
  });

  it("no rgb/rgba/hsl/hsla function calls in className attributes", () => {
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const cn of extractClassNames(content)) {
        const rgbMatches = cn.match(HARDCODED_RGB);
        if (rgbMatches) {
          violations.push(`${file.replace(APP_SRC, "")}: ${rgbMatches.join(", ")}`);
        }
      }
    }

    expect(violations).toStrictEqual([]);
  });

  it("no Tailwind hardcoded color utility classes in className attributes", () => {
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const cn of extractClassNames(content)) {
        const twMatches = cn.match(HARDCODED_TAILWIND_COLORS);
        if (twMatches) {
          violations.push(`${file.replace(APP_SRC, "")}: ${twMatches.join(", ")}`);
        }
      }
    }

    expect(violations).toStrictEqual([]);
  });
});
