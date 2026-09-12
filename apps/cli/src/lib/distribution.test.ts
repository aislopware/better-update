import { detectInstaller, installCommand, pickLatestCliVersion } from "./distribution";

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  ...extra,
});

describe(pickLatestCliVersion, () => {
  it("picks the newest CLI tag, ignoring other packages", () => {
    expect(
      pickLatestCliVersion([
        release("@better-update/server@2.0.0"),
        release("@better-update/cli@0.79.0"),
        release("@better-update/cli@0.80.1"),
        release("@better-update/web@3.1.0"),
        release("@better-update/cli@0.80.0"),
      ]),
    ).toBe("0.80.1");
  });

  it("skips drafts and prereleases", () => {
    expect(
      pickLatestCliVersion([
        release("@better-update/cli@1.0.0", { draft: true }),
        release("@better-update/cli@0.99.0", { prerelease: true }),
        release("@better-update/cli@0.80.0"),
      ]),
    ).toBe("0.80.0");
  });

  it("returns undefined for no CLI releases or a non-array payload", () => {
    expect(pickLatestCliVersion([release("@better-update/server@1.0.0")])).toBeUndefined();
    expect(pickLatestCliVersion({ message: "rate limited" })).toBeUndefined();
    expect(pickLatestCliVersion([{ tag_name: 5 }, "junk"])).toBeUndefined();
  });
});

describe(detectInstaller, () => {
  it("standalone binary outside any node_modules", () => {
    expect(detectInstaller("/Users/me/.better-update/bin/better-update")).toBe("standalone");
    expect(detectInstaller("/usr/local/bin/better-update")).toBe("standalone");
  });

  it("bun global", () => {
    expect(
      detectInstaller(
        "/Users/me/.bun/install/global/node_modules/@better-update/cli-darwin-arm64/better-update",
      ),
    ).toBe("bun");
  });

  it("pnpm global", () => {
    expect(
      detectInstaller(
        "/home/me/.local/share/pnpm/global/5/.pnpm/@better-update+cli-linux-x64@1.0.0/node_modules/@better-update/cli-linux-x64/better-update",
      ),
    ).toBe("pnpm");
  });

  it("yarn global", () => {
    expect(
      detectInstaller(
        "/Users/me/.config/yarn/global/node_modules/@better-update/cli-darwin-arm64/better-update",
      ),
    ).toBe("yarn");
  });

  it("npm global (nested under the package)", () => {
    expect(
      detectInstaller(
        "/opt/homebrew/lib/node_modules/@better-update/cli/node_modules/@better-update/cli-darwin-arm64/better-update",
      ),
    ).toBe("npm");
  });
});

describe(installCommand, () => {
  it("points a standalone install at the repo's install script", () => {
    expect(installCommand("standalone", "acme/tool")).toBe(
      "curl -fsSL https://raw.githubusercontent.com/acme/tool/main/install.sh | sh",
    );
  });

  it("upgrades a package-manager install through that manager", () => {
    expect(installCommand("bun")).toBe("bun add -g @better-update/cli@latest");
    expect(installCommand("npm")).toBe("npm install -g @better-update/cli@latest");
  });
});
