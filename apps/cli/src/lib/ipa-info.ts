/**
 * Read version identity out of a built `.ipa` without uploading it. An `.ipa` is
 * a zip whose main app bundle carries `Payload/<App>.app/Info.plist`; the
 * `CFBundleVersion` there is the "build number" App Store Connect dedupes on. We
 * read it so a submit can ask ASC "is this build already uploaded?" and stay
 * idempotent — re-running after a metadata failure must not re-upload the binary.
 *
 * macOS-only, like the rest of the iOS submit path: `unzip` is used to list and
 * stream a single entry out of the archive (matching `native-runner.ts`).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Data, Effect } from "effect";

import { parsePlist } from "./plist";

const execFileAsync = promisify(execFile);

export class IpaReadError extends Data.TaggedError("IpaReadError")<{
  readonly message: string;
}> {}

export interface IpaVersionInfo {
  /** `CFBundleVersion` — the build number ASC dedupes on (Build.version). */
  readonly buildVersion: string;
  /** `CFBundleShortVersionString` — the marketing version (preReleaseVersion.version). */
  readonly shortVersion: string | undefined;
}

/** Only the top-level app bundle's Info.plist, never a nested framework/plugin one. */
const APP_INFO_PLIST = /^Payload\/[^/]+\.app\/Info\.plist$/u;

const fail = (message: string) => new IpaReadError({ message });

/**
 * Pick the main app bundle's `Info.plist` from a list of archive entries, ignoring
 * the deeper Info.plists that frameworks, app extensions, and watch apps carry.
 */
export const pickAppInfoPlistEntry = (entries: readonly string[]): string | undefined =>
  entries.map((line) => line.trim()).find((line) => APP_INFO_PLIST.test(line));

/** List archive entries (`unzip -Z1`) and return the main app Info.plist path. */
const findAppInfoPlistEntry = (ipaPath: string) =>
  Effect.tryPromise({
    try: async () => execFileAsync("unzip", ["-Z1", ipaPath], { encoding: "utf8" }),
    catch: (cause) => fail(`Could not read the IPA at ${ipaPath}: ${String(cause)}`),
  }).pipe(
    Effect.flatMap(({ stdout }) => {
      const entry = pickAppInfoPlistEntry(stdout.split("\n"));
      return entry === undefined
        ? Effect.fail(fail(`No app Info.plist (Payload/*.app/Info.plist) found in ${ipaPath}.`))
        : Effect.succeed(entry);
    }),
  );

/** Stream one entry out of the archive (`unzip -p`) as raw bytes. */
const readEntryBytes = (ipaPath: string, entry: string) =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("unzip", ["-p", ipaPath, entry], {
        encoding: "buffer",
        // Info.plist is tiny; lift the default 1 MB cap only as headroom.
        maxBuffer: 16 * 1024 * 1024,
      });
      return stdout;
    },
    catch: (cause) => fail(`Could not extract ${entry} from ${ipaPath}: ${String(cause)}`),
  });

const stringField = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * Read the build identity from an `.ipa`. Fails with {@link IpaReadError} when the
 * archive is unreadable, has no app Info.plist, or that plist omits
 * `CFBundleVersion` — callers degrade to a non-idempotent upload rather than crash.
 */
export const readIpaVersionInfo = (ipaPath: string): Effect.Effect<IpaVersionInfo, IpaReadError> =>
  Effect.gen(function* () {
    const entry = yield* findAppInfoPlistEntry(ipaPath);
    const bytes = yield* readEntryBytes(ipaPath, entry);
    const parsed = yield* Effect.try({
      try: () => parsePlist(bytes),
      catch: (cause) => fail(`Could not parse ${entry}: ${String(cause)}`),
    });
    const buildVersion = stringField(parsed["CFBundleVersion"]);
    if (buildVersion === undefined) {
      return yield* Effect.fail(fail(`CFBundleVersion missing from ${entry} in ${ipaPath}.`));
    }
    return { buildVersion, shortVersion: stringField(parsed["CFBundleShortVersionString"]) };
  });
