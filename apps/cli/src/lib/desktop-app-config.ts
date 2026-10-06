/**
 * What a Windows / Linux app's own config says about it: Tauri's
 * `tauri.conf.json` (with `tauri.<os>.conf.json` over it) or an Electron app's
 * `package.json` / `electron-builder.json`. Read best-effort from the project
 * root, its `src-tauri/`, and a custom command's `cwd` — a field nobody sets
 * stays undefined and the profile or the artifact fills it in.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { asRecord, compact } from "@better-update/type-guards";
import { Effect } from "effect";

import { parseTauriPublicKey } from "./tauri-signature";

export interface DesktopAppConfig {
  readonly appName?: string;
  readonly version?: string;
  readonly bundleId?: string;
  /** A Tauri app's `plugins.updater.pubkey`. */
  readonly tauriPublicKey?: string;
}

const readJson = async (file: string): Promise<Record<string, unknown> | undefined> => {
  try {
    return asRecord(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return undefined;
  }
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/** A config's section by name (Tauri v1 keeps `package` / `tauri`; v2 has `plugins`). */
const v1 = (config: Record<string, unknown>, section: string) => asRecord(config[section]);

const TAURI_OS = { windows: "windows", linux: "linux" } as const;

/** Tauri's `version` may name a package.json to take the version from. */
const tauriVersion = async (configDir: string, value: unknown) => {
  const version = text(value);
  if (version === undefined || !version.endsWith(".json")) {
    return version;
  }
  const manifest = await readJson(path.resolve(configDir, version));
  return text(manifest?.["version"]);
};

/** A Tauri v2 config, a v1 one's `package` / `tauri.*` fields as the fallback. */
const readTauriConfig = async (
  root: string,
  platform: "windows" | "linux",
): Promise<DesktopAppConfig | undefined> => {
  const base = await readJson(path.join(root, "tauri.conf.json"));
  if (base === undefined) {
    return undefined;
  }
  const overlay = (await readJson(path.join(root, `tauri.${TAURI_OS[platform]}.conf.json`))) ?? {};
  const pick = (read: (config: Record<string, unknown>) => unknown) =>
    text(read(overlay)) ?? text(read(base));
  const pubkey = pick(
    (config) =>
      asRecord(v1(config, "plugins")?.["updater"])?.["pubkey"] ??
      asRecord(v1(config, "tauri")?.["updater"])?.["pubkey"],
  );
  return compact({
    appName: pick((config) => config["productName"] ?? v1(config, "package")?.["productName"]),
    version: await tauriVersion(
      root,
      pick((config) => config["version"] ?? v1(config, "package")?.["version"]),
    ),
    bundleId: pick(
      (config) => config["identifier"] ?? asRecord(v1(config, "tauri")?.["bundle"])?.["identifier"],
    ),
    tauriPublicKey:
      pubkey !== undefined && parseTauriPublicKey(pubkey) !== undefined ? pubkey : undefined,
  });
};

/** An Electron app: package.json, with electron-builder's own config file over its `build` key. */
const readElectronConfig = async (root: string): Promise<DesktopAppConfig | undefined> => {
  const manifest = await readJson(path.join(root, "package.json"));
  if (manifest === undefined) {
    return undefined;
  }
  const builder =
    (await readJson(path.join(root, "electron-builder.json"))) ?? asRecord(manifest["build"]);
  return compact({
    appName:
      text(builder?.["productName"]) ?? text(manifest["productName"]) ?? text(manifest["name"]),
    version: text(asRecord(builder?.["extraMetadata"])?.["version"]) ?? text(manifest["version"]),
    bundleId: text(builder?.["appId"]),
  });
};

/**
 * The first Tauri config among `<dir>/src-tauri` and `<dir>` for each given
 * directory, else the first package.json — a Tauri project has both, and its
 * package.json describes the frontend, not the app.
 */
export const readDesktopAppConfig = (
  directories: readonly string[],
  platform: "windows" | "linux",
) =>
  Effect.promise(async (): Promise<DesktopAppConfig> => {
    const roots = directories.flatMap((directory) => [
      path.join(directory, "src-tauri"),
      directory,
    ]);
    const tauri = await Promise.all(roots.map(async (root) => readTauriConfig(root, platform)));
    const found = tauri.find((config) => config !== undefined);
    if (found !== undefined) {
      return found;
    }
    const electron = await Promise.all(directories.map(readElectronConfig));
    return electron.find((config) => config !== undefined) ?? {};
  });
