/**
 * Where Xcode looks for installed provisioning profiles. Xcode resolves them
 * under the account's home directory as the user database records it, not
 * under `$HOME` — and Bun's `os.homedir()` and `os.userInfo().homedir` both
 * return `$HOME`, so the two part ways whenever `HOME` is redirected (a CI job,
 * `sudo -E`, an isolated test home).
 */
import os from "node:os";
import path from "node:path";

import { Effect } from "effect";

import { runTool } from "./exec-tool";

const NFS_HOME = /^NFSHomeDirectory:\s*(?<home>\S.*)$/mu;

/** The account's home directory from Directory Services, else `$HOME`. */
export const accountHomeDirectory = Effect.suspend(() =>
  runTool("dscl", ["/Search", "-read", `/Users/${os.userInfo().username}`, "NFSHomeDirectory"]),
).pipe(
  Effect.map((result) => {
    const home = NFS_HOME.exec(result.stdout)?.groups?.["home"]?.trim();
    return result.exitCode === 0 && home !== undefined ? home : os.homedir();
  }),
);

/** Xcode 16+'s profile directory, then the one earlier versions (and iOS tooling) use. */
export const xcodeProfileDirectories = accountHomeDirectory.pipe(
  Effect.map((home) => ({
    userData: path.join(home, "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles"),
    mobileDevice: path.join(home, "Library", "MobileDevice", "Provisioning Profiles"),
  })),
);
