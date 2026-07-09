# Native builds, store submission, and fingerprints

OTA updates only work when the native binary on the device matches. When you change native code (a
new dep, a config-plugin update, a runtime-version bump), you need a new build. Command groups:

- **`build`** (singular) — runs a native build on the local machine and (optionally) uploads it.
- **`builds`** (plural) — manages already-uploaded build records (list/get/download/run/install/resign).
- **`submit`** — uploads a build to App Store Connect / Google Play.
- **`fingerprint`** — verifies runtime compatibility between a build and an update.

Signing material (keystores, certs, profiles, APNs/ASC keys) and the E2E vault live in
`references/credentials.md`. Apple device UDID registration (for ad-hoc/development) is in
`references/access-control.md`.

## `build` — local native build

```bash
better-update build                          # platform auto-detected from app.json
better-update build --platform ios --profile production
```

What it does:

1. Stages the project into a temp dir and installs deps there (frozen to the lockfile).
2. Downloads the platform credentials from the server (so they don't live on every dev machine).
   The resolved Apple team / upload keystore must be **bound to the project** (for everyone, org
   admins included) — the error tells you to bind first; see `references/access-control.md` and
   `credentials bindings` in `references/credentials.md`.
3. Resolves a **build strategy** from the detected project type (see below) — for Expo that means
   `expo prebuild --platform <ios|android>` (which installs CocoaPods itself on iOS); for other types
   it skips prebuild and uses the native sources / your custom command as-is.
4. iOS: `xcodebuild archive` + `xcodebuild exportArchive`. Android: `./gradlew :app:<assembleRelease|bundleRelease|…>`. A `custom` profile runs your own command instead.
5. Optionally uploads the resulting `.ipa` / `.apk` / `.aab` to the server (and optionally submits).

### Project types & custom build commands

The build pipeline is **not Expo-only**. The CLI auto-detects the project type from filesystem
markers and picks a per-platform strategy; you can also override the command entirely:

| Project type | Detected by                                 | Build strategy                             |
| ------------ | ------------------------------------------- | ------------------------------------------ |
| `expo`       | `expo` dep / `app.json` with `expo` key     | `expo prebuild` → `xcodebuild` / `gradlew` |
| `bare`       | committed `ios/` + `android/` (no prebuild) | `xcodebuild` / `gradlew` directly          |
| `kmp`        | Kotlin/Compose Multiplatform markers        | `gradlew` (+ Xcode for the iOS app)        |
| `native`     | pure native Android (Gradle) / iOS (Xcode)  | `gradlew` / `xcodebuild` directly          |
| `custom`     | a `custom` block in the `eas.json` profile  | your shell command, full escape hatch      |

For any project — or to override a single platform on any of the above — add a `custom` block to the
build profile in `eas.json`:

```json
{
  "build": {
    "production": {
      "custom": {
        "ios": {
          "command": "xcodebuild -scheme MyApp -configuration Release archive …",
          "cwd": "ios",
          "env": { "CUSTOM_VAR": "value" },
          "artifactPath": "build/MyApp.ipa"
        },
        "android": {
          "command": "./gradlew :app:assembleRelease",
          "artifactPath": "app/build/outputs/apk/release/app-release.apk"
        }
      }
    }
  }
}
```

- **`command`** (required) — the shell command to run. It sees all the `BETTER_UPDATE_BUILD*` env vars.
- **`cwd`** (optional) — working directory, relative to the project root.
- **`env`** (optional) — extra environment variables injected into the command.
- **`artifactPath`** (optional) — where the built `.ipa`/`.apk`/`.aab` lands (relative to `cwd` or
  project root), so the CLI can pick it up for upload/submit.

Everything downstream — credential vault, env vars, upload, submit, fingerprints, OTA — works the same
regardless of project type. OTA JS updates still require an Expo-compatible runtime; native builds,
credentials, and store submission have no such requirement.

### Flags

| Flag                                | Default      | Notes                                                                      |
| ----------------------------------- | ------------ | -------------------------------------------------------------------------- |
| `--platform <ios\|android>`         | auto         | **Optional** — auto-detected from `app.json` when omitted.                 |
| `--profile <name>`                  | `production` | Build profile (matches `eas.json` profile names).                          |
| `--message <text>`                  | —            | Free-form description, stored on the build record.                         |
| `--no-upload`                       | off          | Upload is on by default; `--no-upload` for a dry run.                      |
| `--output <path>`                   | —            | Copy the built artifact to this local path.                                |
| `--raw-output`                      | off          | Stream raw Gradle/Xcode output instead of the formatted spinner.           |
| `--clear-cache`                     | off          | Clear project-scoped build caches before building.                         |
| `--freeze-credentials`              | off          | Fail fast if credentials are missing instead of prompting (CI).            |
| `--allow-dirty`                     | off          | Proceed even with uncommitted git changes.                                 |
| `--auto-submit`, `-s`               | off          | After upload, submit using the `eas.json` submit profile of the same name. |
| `--auto-submit-with-profile <name>` | —            | After upload, submit using a specific submit profile.                      |
| `--what-to-test <text>`             | —            | iOS-only TestFlight changelog when auto-submitting.                        |

### Scaffold build profiles

```bash
better-update build configure [--force]
```

Creates or tops up `eas.json` with default development/preview/production profiles. Without `--force`
it only adds missing default profiles (preserving your keys); `--force` overwrites with the template.

### Lifecycle hooks (EAS-compatible)

The same npm-script hooks EAS Build supports run at the same points, so existing scripts work
unchanged: `eas-build-pre-install`, `eas-build-post-install`, `eas-build-on-success`,
`eas-build-on-error`, `eas-build-on-complete` (the last sees `EAS_BUILD_STATUS` /
`BETTER_UPDATE_BUILD_STATUS` = `finished` or `errored`).

Build subprocesses (including dynamic `app.config.ts`) also see `BETTER_UPDATE_BUILD=1`,
`BETTER_UPDATE_BUILD_PLATFORM`, `BETTER_UPDATE_BUILD_PROFILE`, `BETTER_UPDATE_BUILD_PROJECT_ID`,
`BETTER_UPDATE_BUILD_GIT_COMMIT_HASH`, `BETTER_UPDATE_BUILD_WORKINGDIR`, and the platform version pair
(`BETTER_UPDATE_BUILD_IOS_APP_VERSION`/`_IOS_BUILD_NUMBER` or
`BETTER_UPDATE_BUILD_ANDROID_VERSION_NAME`/`_ANDROID_VERSION_CODE`) — mirroring the `EAS_BUILD*` set.

## `builds` — server-side build records

```bash
better-update builds list [--platform <ios|android>] [--profile <name>] [--runtime-version <v>] \
                          [--distribution <app-store|ad-hoc|development|enterprise|simulator|play-store|direct>] \
                          [--sort <createdAt|platform|distribution|runtimeVersion|appVersion>] [--limit <n>=10]
better-update builds get <id>
better-update builds download <id> [--output <path>]          # download artifact; default ./<id>.<ext>
better-update builds download-symbols <id> [--type <t>] [--output <dir>]  # download stored debug symbols
better-update builds run [<id>] [--latest --platform <ios|android>] [--simulator <name|udid>] \
                         [--device-id <udid>] [--device] [--emulator <serial>] [--package <name>]
better-update builds delete <id>
better-update builds install-link <id>
better-update builds compatibility-matrix
better-update builds upload <artifact-path> --platform <ios|android> [--profile <name>=production] [--message <text>]
better-update builds resign --build <id> [--profile-id <id>] [--cert-id <id>]
```

- `builds list --sort` accepts a `-` prefix for descending (`-createdAt`).
- `builds download-symbols` fetches the crash-symbolication files captured at build time. Types:
  `dsym` (iOS debug symbols, zipped), `js-sourcemap` (sourcemap of the JS bundle embedded in the
  binary), `proguard-mapping` (Android R8 `mapping.txt`), `native-symbols` (Android NDK
  `native-debug-symbols.zip`). Without `--type` all stored types are downloaded as
  `<build-id>-<type>.<ext>` into `--output` (default: current directory). Capture is automatic and
  best-effort during `build` — a missing symbol file never fails a build; what was stored is shown
  in the build summary (`Debug artifacts:` line) and on the dashboard build detail page. If the
  build profile env sets `SOURCEMAP_FILE` (e.g. for a Sentry upload phase), the CLI respects it and
  captures the embedded-bundle sourcemap from that path instead of overriding it.
- `builds run` downloads the artifact and installs + launches it on a simulator/emulator or a real
  device. With no `<id>`, pass `--latest --platform <p>`. `--device` forces a real-device iOS install.
- `builds install-link` returns `artifactUrl`, an iOS `installUrl` (an `itms-services://` manifest),
  and an `expires` timestamp. Send to QA for ad-hoc installs; the signed URL expires.
- `builds compatibility-matrix` answers "if I publish to channel X today, will any device receive
  it?" — prints runtime-version coverage per channel and flags gaps. Run before a publish if unsure.
- `builds resign` prints step-by-step instructions (fastlane sigh / codesign) for re-signing an iOS
  build locally with a new provisioning profile — better-update does not bundle the macOS signing
  toolchain, so it downloads the profile/cert to a tmp path and gives you the commands plus a
  re-upload path (iOS only; the build id is the `--build` flag, not a positional).

## `submit` — upload to the stores

```bash
better-update submit --platform <ios|android> [--profile <name>=production] \
  (--latest | --id <buildId> | --path <ipa/aab|file://> | --url <url>) \
  [--what-to-test <text>] [--service-account-key-id <id>] [--no-wait]
```

Submits a build to App Store Connect (iOS, via `xcrun altool`) or Google Play (Android), straight
from the CLI. Provide exactly one archive source (`--latest`/`--id`/`--path`/`--url`); if several are
passed, precedence is `--path` > `--url` > `--id` > `--latest`. `--what-to-test` is the iOS TestFlight "What to test" changelog;
`--service-account-key-id` overrides the Android service account from the submit profile; `--no-wait`
returns without blocking until a terminal status. (`build --auto-submit` runs build → submit in one
step.) Note: this performs the _upload/submission_ — it does not poll store **review**.

## `fingerprint` — runtime compatibility check

better-update uses Expo's fingerprint to decide whether a build and an update are compatible. Two runs
with the same native sources produce the same hash.

```bash
better-update fingerprint generate [--platform <ios|android>]   # combined hash, or per-platform with --platform
better-update fingerprint compare [hash] [--build-id <id[,id]>] [--update-id <id[,id]>] [--platform <ios|android>]
```

- `generate` prints the hash (and a `<N> sources` line when sources are present). `--platform` yields
  the per-platform hash that matches what's recorded on builds/updates.
- `compare`: the positional `hash` is optional. Two ids (combined `--build-id` + `--update-id` ≤ 2)
  compares both server-side; one id compares that vs the local project; a bare `hash` compares it vs
  local. Exit `0` match, `1` mismatch, `2` resolution/usage error — useful in CI to fail loudly when
  native code changes without a runtime-version bump.

## Putting it together (native-code change)

```bash
# 1. Refresh an expiring credential if needed (see credentials.md)
better-update credentials generate distribution-certificate --asc-key-id <id>
# 2. Build + upload (+ optionally submit)
better-update build --platform ios --profile production --message "Add native module X"
# 3. Confirm the new build covers the channels you care about
better-update builds compatibility-matrix
# 4. Submit to the store
better-update submit --platform ios --latest --what-to-test "New native module"
# 5. Once the binary is on devices, publish OTA against its runtime version (see publishing.md)
```
