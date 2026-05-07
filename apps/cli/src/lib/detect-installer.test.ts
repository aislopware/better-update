import { detectInstaller, installCommand } from "./detect-installer";

describe(detectInstaller, () => {
  it("bun global install", () => {
    expect(
      detectInstaller(
        "/Users/me/.bun/install/global/node_modules/@better-update/cli/dist/index.mjs",
      ),
    ).toBe("bun");
  });

  it("pnpm global on macOS", () => {
    expect(
      detectInstaller(
        "/Users/me/Library/pnpm/global/5/node_modules/@better-update/cli/dist/index.mjs",
      ),
    ).toBe("pnpm");
  });

  it("pnpm global on Linux", () => {
    expect(
      detectInstaller(
        "/home/me/.local/share/pnpm/global/5/node_modules/@better-update/cli/dist/index.mjs",
      ),
    ).toBe("pnpm");
  });

  it("yarn classic global", () => {
    expect(
      detectInstaller(
        "/Users/me/.config/yarn/global/node_modules/@better-update/cli/dist/index.mjs",
      ),
    ).toBe("yarn");
  });

  it("npm Homebrew prefix on macOS", () => {
    expect(
      detectInstaller("/opt/homebrew/lib/node_modules/@better-update/cli/dist/index.mjs"),
    ).toBe("npm");
  });

  it("npm system prefix on Linux", () => {
    expect(detectInstaller("/usr/local/lib/node_modules/@better-update/cli/dist/index.mjs")).toBe(
      "npm",
    );
  });

  it("npm via nvm", () => {
    expect(
      detectInstaller(
        "/Users/me/.nvm/versions/node/v22.0.0/lib/node_modules/@better-update/cli/dist/index.mjs",
      ),
    ).toBe("npm");
  });

  it("unknown path defaults to npm", () => {
    expect(detectInstaller("/some/random/path/index.mjs")).toBe("npm");
  });

  it("bun global install on Windows", () => {
    expect(
      detectInstaller(
        String.raw`C:\Users\me\.bun\install\global\node_modules\@better-update\cli\dist\index.mjs`,
      ),
    ).toBe("bun");
  });

  it("pnpm global on Windows", () => {
    expect(
      detectInstaller(
        String.raw`C:\Users\me\AppData\Local\pnpm\global\5\node_modules\@better-update\cli\dist\index.mjs`,
      ),
    ).toBe("pnpm");
  });

  it("yarn classic global on Windows", () => {
    expect(
      detectInstaller(
        String.raw`C:\Users\me\AppData\Local\Yarn\Data\global\node_modules\@better-update\cli\dist\index.mjs`,
      ),
    ).toBe("yarn");
  });

  it("npm global on Windows", () => {
    expect(
      detectInstaller(
        String.raw`C:\Users\me\AppData\Roaming\npm\node_modules\@better-update\cli\dist\index.mjs`,
      ),
    ).toBe("npm");
  });
});

describe(installCommand, () => {
  it("bun", () => {
    expect(installCommand("bun")).toBe("bun add -g @better-update/cli@latest");
  });
  it("pnpm", () => {
    expect(installCommand("pnpm")).toBe("pnpm add -g @better-update/cli@latest");
  });
  it("yarn", () => {
    expect(installCommand("yarn")).toBe("yarn global add @better-update/cli@latest");
  });
  it("npm", () => {
    expect(installCommand("npm")).toBe("npm install -g @better-update/cli@latest");
  });
});
