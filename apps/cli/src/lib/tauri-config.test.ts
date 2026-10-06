import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";

import { readTauriUpdaterPubkey } from "./tauri-config";

// The throwaway fixture key's public half (fixtures/tauri-app/updater-test.key.pub).
const PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE1NzMxMjNDMDkwMzBDMTcKUldRWERBTUpQQkp6cFMvaVVlR1VIbjFzcEx1TjVjcFdValhVWURWVHJFclpsMk9qV1RKT0VzVlIK";

const updaterConfig = (pubkey: string) =>
  JSON.stringify({ plugins: { updater: { pubkey, endpoints: [] } } });

describe(readTauriUpdaterPubkey, () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "tauri-config-"));
    mkdirSync(path.join(root, "src-tauri"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const read = async (directories: readonly string[]) =>
    Effect.runPromise(readTauriUpdaterPubkey(directories));

  it("reads the pubkey from src-tauri/tauri.conf.json", async () => {
    writeFileSync(path.join(root, "src-tauri", "tauri.conf.json"), updaterConfig(PUBKEY));
    await expect(read([root])).resolves.toBe(PUBKEY);
  });

  it("prefers the macOS platform config, which overrides the base one", async () => {
    writeFileSync(path.join(root, "src-tauri", "tauri.conf.json"), updaterConfig("not a key"));
    writeFileSync(path.join(root, "src-tauri", "tauri.macos.conf.json"), updaterConfig(PUBKEY));
    await expect(read([root])).resolves.toBe(PUBKEY);
  });

  it("finds the config from a custom command's cwd inside src-tauri", async () => {
    writeFileSync(path.join(root, "src-tauri", "tauri.conf.json"), updaterConfig(PUBKEY));
    await expect(read([path.join(root, "src-tauri"), root])).resolves.toBe(PUBKEY);
  });

  it("is undefined for a project without a Tauri updater", async () => {
    writeFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "{ not json");
    await expect(read([root])).resolves.toBeUndefined();
  });
});
