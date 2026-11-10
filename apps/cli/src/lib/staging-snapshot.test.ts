import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { it } from "@effect/vitest";
import { Effect } from "effect";

import { commitStagingSnapshot, quoteFastImportPath } from "./staging-snapshot";

const gitStatus = (dir: string): string =>
  execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });

const git = (dir: string, args: readonly string[]): string =>
  execFileSync("git", [...args], { cwd: dir, encoding: "utf8" });

const reflogSubjects = (dir: string): readonly string[] =>
  git(dir, ["reflog", "--format=%gs"])
    .split("\n")
    .filter((line) => line !== "");

const makeDir = (prefix: string): string => realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

const dispose = (dir: string): void => {
  rmSync(dir, { recursive: true, force: true });
};

describe(quoteFastImportPath, () => {
  it("always quotes, escaping quotes, backslashes and control characters", () => {
    expect(quoteFastImportPath("src/App.tsx")).toBe('"src/App.tsx"');
    expect(quoteFastImportPath(String.raw`a "b"\c`)).toBe(String.raw`"a \"b\"\\c"`);
    expect(quoteFastImportPath("line\nbreak\ttab")).toBe(String.raw`"line\012break\011tab"`);
    expect(quoteFastImportPath("ünïcode/文件.txt")).toBe('"ünïcode/文件.txt"');
  });
});

describe(commitStagingSnapshot, () => {
  it.effect("makes a freshly init'd, all-untracked tree read clean (BU-5)", () =>
    Effect.gen(function* () {
      const root = makeDir("staging-commit-");
      try {
        // Mirror staging: a fresh `git init` with copied source but no commit.
        execFileSync("git", ["init", "-q", root]);
        writeFileSync(path.join(root, "App.tsx"), "export default null;\n");
        writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
        mkdirSync(path.join(root, "node_modules"), { recursive: true });
        writeFileSync(path.join(root, "node_modules", "dep.js"), "module.exports = {};\n");

        // This is the dirty state Expo's prebuild git check reads as "dirty"
        // and prompts on (untracked App.tsx + .gitignore).
        expect(gitStatus(root).trim()).not.toBe("");

        yield* commitStagingSnapshot(root);

        // After the snapshot commit the tree reads clean, so `expo prebuild`'s
        // `git status --porcelain` returns empty and it never prompts.
        expect(gitStatus(root).trim()).toBe("");
      } finally {
        dispose(root);
      }
    }),
  );

  it.effect("does not track gitignored paths into the snapshot", () =>
    Effect.gen(function* () {
      const root = makeDir("staging-commit-ignore-");
      try {
        execFileSync("git", ["init", "-q", root]);
        writeFileSync(path.join(root, ".gitignore"), "node_modules\nios/\n");
        writeFileSync(path.join(root, "index.js"), "1;\n");
        mkdirSync(path.join(root, "ios"), { recursive: true });
        writeFileSync(path.join(root, "ios", "Podfile"), "platform :ios\n");

        yield* commitStagingSnapshot(root);

        const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
        expect(tracked).toContain("index.js");
        // Gitignored native dir stays untracked, so a later `expo prebuild`
        // regenerating ios/ never shows up as a dirty change.
        expect(tracked).not.toContain("ios/Podfile");
      } finally {
        dispose(root);
      }
    }),
  );

  it.effect("records modes, symlinks and awkward names exactly as `git add` would", () =>
    Effect.gen(function* () {
      const root = makeDir("staging-commit-modes-");
      try {
        execFileSync("git", ["init", "-q", root]);
        mkdirSync(path.join(root, "android"), { recursive: true });
        writeFileSync(path.join(root, "android", "gradlew"), "#!/bin/sh\n");
        chmodSync(path.join(root, "android", "gradlew"), 0o755);
        writeFileSync(path.join(root, 'a "quoted" name.txt'), "q\n");
        writeFileSync(path.join(root, "line\nbreak.txt"), "n\n");
        symlinkSync("android/gradlew", path.join(root, "link"));

        yield* commitStagingSnapshot(root);

        expect(gitStatus(root)).toBe("");
        expect(git(root, ["log", "--format=%s"]).trim()).toBe("better-update staging snapshot");
        // Committed by fast-import, not by the `git add` + commit fallback.
        expect(reflogSubjects(root)).toStrictEqual(["fast-import"]);
        const entries = git(root, ["ls-files", "-s", "-z"])
          .split("\0")
          .filter((line) => line !== "")
          .map((line) => {
            const [meta = "", file = ""] = line.split("\t");
            return [file, meta.split(" ")[0]] as const;
          });
        expect(Object.fromEntries(entries)).toStrictEqual({
          'a "quoted" name.txt': "100644",
          "android/gradlew": "100755",
          "line\nbreak.txt": "100644",
          link: "120000",
        });
      } finally {
        dispose(root);
      }
    }),
  );

  it.effect("commits files that git's clean filters rewrite, so the tree still reads clean", () =>
    Effect.gen(function* () {
      const root = makeDir("staging-commit-eol-");
      try {
        execFileSync("git", ["init", "-q", root]);
        // fast-import stores the CRLF bytes as-is; `text eol=lf` makes git see
        // the file as modified until `git add` stores the normalized blob.
        writeFileSync(path.join(root, ".gitattributes"), "*.txt text eol=lf\n");
        writeFileSync(path.join(root, "notes.txt"), "one\r\ntwo\r\n");
        writeFileSync(path.join(root, "plain.js"), "1;\n");

        yield* commitStagingSnapshot(root);

        expect(gitStatus(root)).toBe("");
        expect(git(root, ["ls-files"]).split("\n")).toContain("notes.txt");
        // fast-import ran, then the fallback commit picked up the rewritten file.
        expect(reflogSubjects(root)).toStrictEqual([
          "commit: better-update staging snapshot",
          "fast-import",
        ]);
      } finally {
        dispose(root);
      }
    }),
  );
});
