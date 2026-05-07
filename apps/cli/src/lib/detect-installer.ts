import { fileURLToPath } from "node:url";

export type Installer = "bun" | "pnpm" | "yarn" | "npm";

export const detectInstaller = (modulePath: string): Installer => {
  const normalized = modulePath.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("/.bun/")) {
    return "bun";
  }
  if (normalized.includes("/pnpm/")) {
    return "pnpm";
  }
  if (normalized.includes("/.yarn/") || normalized.includes("/yarn/")) {
    return "yarn";
  }
  return "npm";
};

const INSTALL_COMMANDS: Readonly<Record<Installer, string>> = {
  bun: "bun add -g @better-update/cli@latest",
  pnpm: "pnpm add -g @better-update/cli@latest",
  yarn: "yarn global add @better-update/cli@latest",
  npm: "npm install -g @better-update/cli@latest",
};

export const installCommand = (installer: Installer): string => INSTALL_COMMANDS[installer];

export const detectInstallerFromImportMetaUrl = (importMetaUrl: string): Installer =>
  detectInstaller(fileURLToPath(importMetaUrl));
