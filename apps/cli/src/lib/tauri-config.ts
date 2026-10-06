/**
 * The updater public key a Tauri app is built with (`plugins.updater.pubkey`
 * in `tauri.conf.json`, which `tauri.macos.conf.json` overrides). The built
 * app embeds it, so a release can be refused when its signing key is not the
 * one the installed app will check.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { asRecord } from "@better-update/type-guards";
import { Effect } from "effect";

import { parseTauriPublicKey } from "./tauri-signature";

const CONFIG_FILES = ["tauri.macos.conf.json", "tauri.conf.json"];

const readPubkey = async (configPath: string): Promise<string | undefined> => {
  try {
    const config: unknown = JSON.parse(await readFile(configPath, "utf8"));
    const pubkey = asRecord(asRecord(asRecord(config)?.["plugins"])?.["updater"])?.["pubkey"];
    return typeof pubkey === "string" && parseTauriPublicKey(pubkey) !== undefined
      ? pubkey.trim()
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The first valid updater pubkey among `src-tauri/` (Tauri's layout) and the
 * given directories, macOS config first. Undefined for a non-Tauri project.
 */
export const readTauriUpdaterPubkey = (directories: readonly string[]) =>
  Effect.promise(async () => {
    const candidates = directories.flatMap((directory) =>
      [path.join(directory, "src-tauri"), directory].flatMap((root) =>
        CONFIG_FILES.map((file) => path.join(root, file)),
      ),
    );
    const found = await Promise.all(candidates.map(readPubkey));
    return found.find((pubkey) => pubkey !== undefined);
  });
