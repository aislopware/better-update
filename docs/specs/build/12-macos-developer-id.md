# 12. macOS Developer ID builds

Status: phases 1–3 implemented (2026-10-05) — signer fixes, `macos package`,
bounded notarization with resume, server/web support, and `build --platform
macos` (xcode + custom strategies), each covered by real-codesign E2E tests
(`apps/cli/tests/slow/macos-distribution.test.ts`, `build-macos.test.ts`,
`apps/server/tests/e2e/builds-macos-flow.test.ts`). Phase 4 is done, including
`MAC_APP_DIRECT` profiles (2026-10-06, `macos-provisioning.test.ts` against a
real Apple account); phase 5 ships Sparkle + electron-updater feeds
(`desktop-releases-flow.test.ts`, the release journey in `build-macos.test.ts`).
Every claim marked
**[verified]** was reproduced on Xcode 27.0 (27A266a) / macOS 27.0.1 with a real
G2 Developer ID Application certificate and a real App Store Connect team key;
the rest cites Apple documentation or tool source.

## Goal

`better-update build --platform macos` produces a Developer ID–signed, notarized,
stapled artifact (DMG by default; zip or pkg on request), uploads it as a build,
and — in a later phase — serves it as an auto-update feed. Same vault, same
env-var pipeline, same staging isolation as the iOS/Android builds.

Nobody else does this end to end: EAS Build has no macOS target, Expo prebuild
only supports Android and iOS, and Electron/Tauri/Compose each bring their own
partial signing story.

## What already exists

| Piece                                                                       | Where                                                                               |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Developer ID Application `.p12` in the vault (`certificate_type`, mig 0101) | `credentials generate … --type developer-id`, `credentials upload --platform macos` |
| Inside-out codesign + verify                                                | `apps/cli/src/lib/macos-signing.ts` (`macos sign`)                                  |
| notarytool submit/wait/log + stapler                                        | `apps/cli/src/application/macos-notarize.ts` (`macos notarize`)                     |
| Ephemeral keychain from a `.p12`                                            | `apps/cli/src/lib/ios-keychain.ts`                                                  |
| `MAC_APP_DIRECT` profile type, `BundleIdPlatform.MAC_OS`                    | `@expo/apple-utils` 2.2.1                                                           |

## Verified findings

### Signing

1. **[verified] Bug — `macos sign` skips every Mach-O directly under `Contents/MacOS`.**
   `isSealedByOuterSignature` treats them all as sealed by the outer signature,
   but only `CFBundleExecutable` is. Any other executable there (Tauri
   `externalBin` sidecars land exactly there) stays unsigned and the outer
   `codesign` fails with `code object is not signed at all — In subcomponent:
…/Contents/MacOS/<sidecar>`. With an ad-hoc linker signature (what `cargo`
   emits) the outer sign succeeds but notarization rejects the sidecar. Fix:
   skip only the main executable named by `Info.plist`.
2. **[verified] Bug — re-signing drops entitlements.** `codesign --force`
   without `--entitlements` writes an empty entitlement set, so every nested XPC
   service / helper app (Electron helpers need `cs.allow-jit`; Sparkle's
   `Downloader.xpc` has its own) and the outer app (when `--entitlements` is
   omitted) lose theirs. Fix: per item, read the current entitlements
   (`codesign -d --entitlements - --xml`), drop
   `com.apple.security.get-task-allow`, and sign with that file; an explicit
   `--entitlements` still overrides the outer bundle. `--preserve-metadata` is
   not enough on its own: it keeps `get-task-allow`, and it is ignored for
   linker-signed binaries.
3. **[verified]** Signing identifiers: non-bundled code gets an `-i
<bundleId>.<name>` identifier, otherwise codesign derives one from the file
   name (a DMG named `X-1.2.dmg` gets `Identifier=X-1`).
4. The DTS recipe still holds: inside-out, never `--deep`, `--timestamp`,
   `-o runtime` on executables, entitlements only on executables.

### xcodebuild

5. **[verified]** Export method is still `developer-id` on Xcode 27 (only the
   iOS names were renamed). `ExportOptions.plist`: `method=developer-id`,
   `signingStyle=manual`, `signingCertificate=Developer ID Application` (or the
   SHA-1), `teamID`, and an always-present `provisioningProfiles` dict (Xcode
   < 16 crashes without it).
6. **[verified] Export does not turn on the hardened runtime.** It re-signs
   nested code and strips `get-task-allow`, but it _preserves_ each item's
   runtime flag from the archive. A project without
   `ENABLE_HARDENED_RUNTIME=YES` exports with `flags=0x0(none)` and the notary
   rejects it (`The executable does not have the hardened runtime enabled.`, one
   issue per executable per architecture). The CLI must pass
   `ENABLE_HARDENED_RUNTIME=YES` to `xcodebuild archive` and verify afterwards.
7. **[verified] A target with `SKIP_INSTALL=NO`** (a CLI tool target, or a
   framework/pod) turns the archive into a "Generic Xcode Archive": the archive
   `Info.plist` has no `ApplicationProperties`, and export fails with the opaque
   `exportOptionsPlist error for key "method" expected one {} but found
developer-id`. Detect the missing `ApplicationProperties` and either explain
   it or fall back to taking `Products/Applications/*.app` and signing it with
   the CLI signer.
8. **[verified]** `-destination 'generic/platform=macOS'` builds `x86_64 arm64`
   by default; Xcode 27 drops x86_64 from `ARCHS_STANDARD` once
   `MACOSX_DEPLOYMENT_TARGET ≥ 27`, so a `universal` option passes
   `ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO`. dSYMs land in
   `X.xcarchive/dSYMs/` (one per target) — the iOS debug-artifact capture
   applies unchanged.
9. The ephemeral keychain must be on the user search list for `xcodebuild
-exportArchive` (it has no keychain flag); `acquireKeychain` already does
   this. Apple only requires the `apple:` partition; the existing
   `apple-tool:,apple:,codesign:` is a harmless superset and also covers
   `productbuild`.

### Packaging

10. **[verified]** For a real 22 MB universal Tauri app: UDZO 14.3 MB vs ULFO
    13.7 MB (both ~18 s). The ~4 % saving is not worth dropping UDZO, which
    Apple's packaging guide recommends. Use `-fs HFS+` for old-macOS
    compatibility. `hdiutil` is deprecated on macOS 27 (`diskutil image`
    replaces it) but still works and prints a warning line — never parse its
    stdout.
11. **[verified]** Sign the DMG with the _Application_ identity: `codesign
--timestamp -i <bundleId>.dmg`. Before notarization Gatekeeper reports
    `source=Unnotarized Developer ID`.
12. Notarize only the outermost container (DMG/pkg); the service tickets nested
    code too. Staple the DMG. A zip cannot be stapled: notarize the app zip,
    staple the `.app`, then re-zip with `ditto -c -k --keepParent`.
13. `.pkg` needs a separate **Developer ID Installer** certificate, which the ASC
    API cannot create (no such `certificateType`) — upload-only. `productbuild
--sign … --timestamp`; macOS 27 `pkgbuild` defaults `BundleIsRelocatable`
    to false and `hostArchitecture` to arm64.

### Notarization

14. **[verified]** Team ASC key with `--issuer` notarizes. The rejection log
    (`notarytool log <id>`) is JSON: `status`, `statusSummary`, `statusCode`,
    `issues[]` of `{severity, path, architecture, message, docUrl}`. Group
    issues by path for the CLI output instead of dumping raw JSON.
15. **[verified] Latency is unbounded.** An invalid submission returned
    instantly; the first valid submissions of a freshly issued certificate sat
    in "In Progress" for 40+ minutes (Apple: 98 % finish within 15 minutes, but
    in-depth analysis can take much longer). The build pipeline must not block
    forever: upload first, notarize with `--timeout`, persist the submission id,
    resume with `notarytool wait <id>`. **[verified]** `submit --wait
--timeout` exits **124** with JSON `{"id", "message": "Timeout of N
second(s) was reached before processing completed."}` and the submission
    keeps processing — distinguishable from a rejection (non-zero exit with
    `status: Invalid`). **[verified] That timeout JSON goes to stderr; stdout
    is empty.** `runNotarization` only parses stdout today, so a timed-out
    submission loses its id — parse both streams.
16. `syspolicy_check notary-submission` is not a usable pre-flight: it reported
    a generic "Gatekeeper rejected this file" for a correctly signed,
    not-yet-notarized app. The CLI should do its own pre-flight (below).
    `syspolicy_check distribution` is the right _post_-staple check.
17. "75 per day" is Apple advice, not a documented quota.
18. **[verified]** The first accepted submission of a freshly issued
    certificate took **2 h 20 min** (a DMG submitted alongside an invalid zip
    that was rejected in seconds). Apple's status page showed no incident.

### Keychain

- **[verified]** `security create-keychain` defaults to a 5-minute auto-lock
  (and lock on sleep). A long archive or notarization wait outlives it and
  codesign then pops a GUI password prompt for a keychain whose password only
  the CLI knew. `set-keychain-settings <kc>` with no flags disables both.
- **[verified]** A `.p12` carries only the leaf. On a runner without Apple's
  intermediates (a clean CI image, or a process with its own `HOME`) the
  identity is "not valid" and `find-identity -v` lists nothing. The CLI bundles
  Developer ID G1/G2 and WWDR G2–G6 (`lib/apple-intermediate-cas.ts`, SHA-256
  pinned) and imports them into the ephemeral keychain.
- **[verified]** `security list-keychains -d user -s …` silently does nothing
  when `~/Library/Preferences` does not exist (fresh `HOME`); create it first and
  verify the search list afterwards (by file name — security reports
  `/private/var/…` for `/var/…`).
- Sign with the identity's SHA-1: the same certificate in the login keychain
  and the ephemeral one makes a name ambiguous to codesign.

### Build overrides

- **[verified]** Forcing signing from the `xcodebuild archive` command line —
  `CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=<team> CODE_SIGN_IDENTITY=<CN>
PROVISIONING_PROFILE_SPECIFIER= ENABLE_HARDENED_RUNTIME=YES
OTHER_CODE_SIGN_FLAGS="$(inherited) --keychain <kc>"` — signs every target
  of a project committed with Automatic signing and no team, frameworks and XPC
  services included; no pbxproj edit is needed while no profile is involved.
  `-exportArchive` then takes `signingCertificate=<SHA-1>`.
- **[verified]** `XCODE_XCCONFIG_FILE` with `SKIP_INSTALL = NO` reproduces the
  Generic Xcode Archive on any project; the CLI's fallback (copy
  `Products/Applications/*.app`, sign with the CLI signer) yields an app that
  passes the same audit.

### Credentials

18. Only the Account Holder can create a Developer ID certificate (an App
    Manager ASC key gets 403). The workable flow today is: generate the private
    key + CSR locally, the Account Holder uploads the CSR in the portal and
    returns the `.cer`, then pair it with the key into a vault `.p12`.
19. The original Developer ID Sub-CA expires **2027-02-01**; after that, pkgs
    signed by G1-issued certificates stop installing (timestamped, notarized
    apps keep running). Record the issuing CA (`OU=G2` in the issuer) and warn
    on G1.
20. A Developer ID provisioning profile (`MAC_APP_DIRECT`, no device list,
    18-year validity, embedded at `Contents/embedded.provisionprofile`) is
    needed only for restricted entitlements: everything except
    `get-task-allow`, `application-groups`, App Sandbox keys and
    `com.apple.security.cs.*`. iCloud, Push, Associated Domains,
    `keychain-access-groups`, Network/System Extension, Apple Pay need one. Sign
    in with Apple, Game Center, IAP, HomeKit, WeatherKit are unavailable to
    Developer ID.

## Design

### Server

- New `BuildPlatform = ios | android | macos` used only by builds; the shared
  `Platform` (updates, assets, runtimes) stays `ios | android`.
- `Distribution` gains `developer-id`; `ArtifactFormat` gains `dmg`, `zip`,
  `pkg`. Content types: `application/x-apple-diskimage`, `application/zip`,
  `application/vnd.apple.installer+xml`.
- Migration: `builds.platform/distribution` and `build_artifacts.format` are
  CHECK-constrained (0005). SQLite cannot alter a CHECK, so the tables are
  rebuilt — and `build_artifacts`, `debug_artifacts`, `build_install_artifacts`
  reference `builds` with `ON DELETE CASCADE`, so dropping `builds` would delete
  every artifact row. Rebuild parent and children together (children first),
  stash the `submissions.build_id` SET NULL links as 0100 does, and rehearse
  against an export of production D1 first.
- Notarization state lives in the build's `metadata.macos`
  (`MacosBuildMetadata`: minimum macOS, architectures, team, notarization
  `{status: accepted|pending|skipped, submissionId, stapled}`) rather than new
  columns: it is written once at upload and only displayed. A build whose
  notarization outlives `notarizeTimeout` uploads as `pending`.
- Web: macOS builds download directly (no itms-services); no submit, no
  compatibility matrix.

### eas.json

```jsonc
"production": {
  "macos": {
    "workspace": "macos/App.xcworkspace",   // or "project"
    "scheme": "App-macOS",
    "buildConfiguration": "Release",
    "distribution": "developer-id",
    "artifact": "dmg",                       // dmg | zip | pkg
    "notarize": true,
    "notarizeTimeout": "45m",
    "ascApiKeyId": "<vault key id>",
    "universal": true,
    "entitlements": "macos/App.entitlements",   // optional override
    "bundleIdentifier": "com.example.app"       // fallback only; the built app wins
  },
  "custom": { "macos": { "command": "…", "artifactPath": "…/*.app" } }
}
```

### CLI pipeline

```
resolve profile → credentials (Developer ID .p12 → ephemeral keychain;
Installer identity for pkg; notary key) → pull env → stage → build → audit →
repair (CLI re-sign) → package → notarize (bounded wait) → staple → upload with
metadata.macos
```

- **`xcode` strategy** (native AppKit/SwiftUI, react-native-macos
  `macos/<App>.xcworkspace` + `<App>-macOS`, Flutter `macos/Runner.xcworkspace`
  - `Runner`, Mac Catalyst via `variant=Mac Catalyst`): `xcodebuild archive
-destination generic/platform=macOS ENABLE_HARDENED_RUNTIME=YES
[ARCHS=…]` with manual signing applied to the pbxproj (reuse
    `applyTargetSigning`, filtered to macOS targets by `SDKROOT`/
    `SUPPORTED_PLATFORMS`), then `-exportArchive developer-id`; generic archive →
    fallback to the CLI signer.
- **`custom` strategy** (Tauri, Electron, Compose Desktop, anything else): run
  the user's command with credentials injected, then the CLI takes over from
  the produced `.app` (preferred) or packaged artifact. Inject both neutral and
  tool-native variables so no mapping is needed:

  | Tool             | Signing                                                                           | Notarization                                                             |
  | ---------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
  | neutral          | `BETTER_UPDATE_MACOS_P12_PATH`, `_P12_PASSWORD`, `_SIGNING_IDENTITY`, `_KEYCHAIN` | `BETTER_UPDATE_MACOS_ASC_KEY_PATH`, `_ASC_KEY_ID`, `_ASC_ISSUER_ID`      |
  | Tauri v2         | `APPLE_SIGNING_IDENTITY` (+ keychain on search list)                              | `APPLE_API_KEY` (= key **id**), `APPLE_API_KEY_PATH`, `APPLE_API_ISSUER` |
  | electron-builder | `CSC_LINK`, `CSC_KEY_PASSWORD`, `CSC_INSTALLER_LINK`                              | `APPLE_API_KEY` (= **path**), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`     |
  | Flutter          | `FLUTTER_XCODE_CODE_SIGN_IDENTITY`, `FLUTTER_XCODE_DEVELOPMENT_TEAM`              | —                                                                        |
  | Compose          | `-Pcompose.desktop.mac.signing.identity`, `…signing.keychain`                     | Apple ID only                                                            |

  Implemented with the neutral and signing variables only: notary credentials
  are never exposed to the custom command — the CLI notarizes the final
  container once (Compose and electron-builder cannot use individual ASC keys
  anyway), and skips an artifact `stapler validate` already accepts. A `.app`
  that fails the audit is re-signed; a tool-packaged container is audited in
  place (mounted / unzipped / `pkgutil --expand-full`) and, if it fails, the
  build fails asking for `artifactPath` to name the `.app`.

- **Pre-flight** (before spending a notary round trip), on every Mach-O:
  Developer ID authority + team match, `runtime` flag on executables, secure
  timestamp, no `get-task-allow`, restricted entitlements ⇒ embedded profile
  present and unexpired, `codesign --verify --deep --strict`.
- **Post-flight**: `stapler validate`, `spctl -a -t open --context
context:primary-signature` (DMG) / `spctl -a -t install` (pkg),
  `syspolicy_check distribution` (app).
- Upload metadata for later feeds: `CFBundleIdentifier`, `CFBundleVersion`,
  `CFBundleShortVersionString`, `LSMinimumSystemVersion`, archs (`lipo -archs`),
  signing team, notarization status.

### Credentials UX

- `credentials generate developer-id --request`: create key + CSR locally, write
  an Account Holder hand-off guide; `credentials import developer-id --cer
file.cer` pairs it into a vault `.p12`. (The ASC path stays for Account
  Holder keys.)
- Developer ID Installer: upload-only (`--type macos-certificate` already
  classifies it).
- `MAC_APP_DIRECT` profiles — implemented (2026-10-06). Mig 0107 widens the
  `distribution_type` CHECK with `DEVELOPER_ID` (table rebuild; the bundle
  config links are stashed and restored); the parser classifies a profile with
  `ProvisionsAllDevices` and `Platform: OSX` as `DEVELOPER_ID` and reads
  `com.apple.application-identifier`. Before archiving, the build reads every
  bundle target's id and `CODE_SIGN_ENTITLEMENTS` (`-showBuildSettings -json`),
  and for one claiming entitlements beyond `com.apple.security.*` reuses the
  stored profile for that bundle id + certificate or creates one with the
  build's ASC key, then installs it for the build and selects it per target in
  the staged pbxproj. The export / CLI signer embeds it and adds
  `com.apple.application-identifier` + `com.apple.developer.team-identifier`.
  A fresh profile that still lacks an entitlement means the App ID lacks the
  capability: the build stops and names the `capability enable` command.
  **[verified]** with associated domains: refusal without the capability,
  profile creation once it is on, `codesign --verify --strict`, a launch the
  kernel lets through, and reuse on the next build.
  - **[verified]** Xcode looks profiles up under the account's home directory
    (Directory Services), not `$HOME`; Bun's `os.homedir()` and
    `os.userInfo().homedir` both return `$HOME`, so the CLI resolves the home
    with `dscl`.
  - **[verified]** `security cms -D` needs a default keychain (it imports the
    signer's certificates) and fails without one; the CLI reads the plist out
    of the CMS bytes instead, for iOS profiles too.
  - **[verified]** The public ASC API refuses apple-utils' capability PATCH of
    `bundleIds` ("Unexpected or invalid value at
    `data.relationships.bundleIdCapabilities`"); with a token the CLI enables a
    capability with `POST /v1/bundleIdCapabilities`.
  - **[verified]** The account's Developer ID certificate is listed as
    `DEVELOPER_ID_APPLICATION_G2`; matching or counting by
    `DEVELOPER_ID_APPLICATION` alone misses it, so the CLI queries both.

## Auto-update feeds

The server can render every feed from stored build rows without ever holding a
private key; signatures over archives (and over feeds, when the app opts into
signed feeds) come from the CLI with keys from the vault.

Implemented (2026-10-05): a `desktop_releases` row (mig 0106; one per build +
channel, CASCADE from builds, which GC skips while released) carries the
channel, notes, `critical`, rollout %, `halted`, the CLI-computed sha512 and
Sparkle EdDSA signature. `GET /feeds/:projectId/macos/appcast.xml[?installId]`,
`/:channel-mac.yml`, `/:channel-tauri.json` and `/download/:releaseId/:file` (302 to a presigned R2 URL
with `content-disposition`) are public and routed to the API worker (`/feeds/*`).
`better-update macos release create|list|rollout|halt|resume|delete` drives it.
Mig 0106 also stores `phased_rollout_hours` for Sparkle's own phasing
(`sparkle:phasedRolloutInterval`: 7 random client groups, one more each
interval after `pubDate`; critical updates and manual checks bypass it). An
arm64-only build gets `sparkle:hardwareRequirements arm64` (Sparkle 2.9+) and
an `-arm64` file name; `<channel>-mac.yml` lists the newest version's arm64-only
zip and its newest other zip, which electron-updater splits by `arm64` in the
URL.

Tauri (2026-10-06): `tar.gz` is a macOS artifact format — the CLI notarizes
and staples the `.app`, then archives it (`COPYFILE_DISABLE`, no AppleDouble
entries) as the `.app.tar.gz` the updater unpacks; a `.app.tar.gz` a Tauri
build made is unpacked and finished the same way. The build records the app's
`plugins.updater.pubkey`. `macos release create` signs the stored archive with
minisign exactly as tauri-cli does (scrypt-decrypted secret key, BLAKE2b-512
prehash, trusted comment `timestamp:…\tfile:…\tversion:…`), refusing a key
the app's pubkey does not name. `GET …/:channel-tauri.json` serves the static
form, or the dynamic one with `?arch={{arch}}`; 204 is "no update"; rollout
reads `installId` / `X-Install-Id`. **[verified]** Key decryption and signatures
match tauri-cli 2.12.1 and pass `minisign-verify` (the crate the plugin uses);
`tauri-update.test.ts` builds a real Tauri app with the CLI, releases 1.1.0, and
an installed 1.0.0 (with `requireSignedVersion`) updates itself from both the
static and the `{{arch}}` endpoint. Found on the way: Tauri refuses to update
from a path containing a symlink (`/var` → `/private/var`), and its CLI parses
`CI` as a boolean (`CI=1` fails).
The CLI records the app's `SUPublicEDKey` at build time and refuses a release
the app would reject; both Sparkle key formats sign (32-byte seed, and the
96-byte pre-2.0 expanded key via raw RFC 8032 arithmetic). **[verified]** The
journey test downloads the DMG through the appcast enclosure and checks the
signature with the fixture's `SUPublicEDKey`.

| Updater                                    | Feed                                                                       | Archive            | Signature                                                | Stable install id                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Sparkle 2.10 (also Flutter `auto_updater`) | `appcast.xml`                                                              | dmg/zip/pkg        | Ed25519 `sparkle:edSignature`; signed feed opt-in (2.9+) | none — app must add `installId` via `feedParameters`; built-in time phasing needs none |
| electron-updater                           | `<channel>-mac.yml`                                                        | zip (Squirrel.Mac) | sha512; signed manifest only in v27 / 7.x                | `x-user-staging-id` header                                                             |
| Tauri v2 updater                           | `<channel>-tauri.json` (static, or dynamic with `?arch=`), 204 = no update | `.app.tar.gz`      | minisign `.sig` (mandatory; version-bound)               | none — app adds `X-Install-Id`                                                         |
| Squirrel.Mac raw                           | JSON, 204 = no update                                                      | zip                | —                                                        | none                                                                                   |

- Server-side percentage rollout: bucket on the install id, serve the
  "previous" or "candidate" feed state; no id ⇒ stable.
- Rollback is a halt, not a downgrade: Sparkle never offers older versions, and
  Tauri/electron-updater downgrade only when the app opts in. Recovery =
  publish a higher version.
- Electron blockmaps: the CLI computes them at `release create` (gear-hash
  content-defined chunks, 16/64/256 KiB min/avg/max, 18-byte SHA-256
  checksums; electron-updater matches chunks by checksum string and size, so
  any chunker works as long as both blockmaps come from it). Stored next to
  the artifact (`<r2Key>.blockmap`, deleted with the build) and served gzipped
  as `download/<releaseId>/<file>.blockmap`. electron-updater derives the
  running version's blockmap URL by replacing the new version with the old
  one in the new file's URL, so the route resolves another zip release of
  that version with the same file name. Range requests are answered by the
  Worker (206; several ranges as `multipart/byteranges`, read from R2 in at
  most 200 coalesced ranged gets); a request without `Range` keeps the 302.
  **[verified]** electron-updater 6.8.9's own `GenericDifferentialDownloader`
  rebuilt a 4.2 MB Developer ID zip byte-identically from the previous one,
  downloading 5 % (`tests/slow/electron-differential.test.ts`).

## Phases

1. ✅ **Fix `macos sign`** (findings 1–2) + grouped notary issue output (14),
   `macos package`, bounded notarization + `--submission-id` resume.
2. ✅ **Server**: `BuildPlatform`, `developer-id`, `dmg|zip|pkg`, table rebuild
   (mig 0105), notarization state in metadata; web badges, download link,
   Developer ID card.
3. ✅ **`build --platform macos`**: `xcode` + `custom` strategies, audit +
   repair, DMG/zip/pkg packaging, bounded notarization, upload, `builds
run`/`builds get` support, skill docs.
4. ✅ **Credentials UX**: CSR hand-off flow, G1/G2 tracking, Installer cert +
   `.pkg`, `MAC_APP_DIRECT` profiles.
5. ✅ **Feeds**: Sparkle appcast, electron-updater yml, channel routing,
   server-side rollout, Sparkle phasing, per-architecture items, Tauri
   updater (`.app.tar.gz` + minisign), electron-updater differential
   downloads (blockmaps + Worker range responses), halt, dashboard card.
   Signed appcasts stay
   out: Sparkle signs the exact feed bytes, and this appcast is rendered per
   install (rollout buckets).

## Open questions

- Whether ASC issues a `MAC_APP_DIRECT` profile for an existing iOS-only App
  ID. **[verified]** A bundle id registered with `MAC_OS` today comes back as
  `UNIVERSAL`, so new App IDs serve both.
- Whether `-exportArchive developer-id` accepts Mac Catalyst archives
  unchanged.
- Whether individual ASC keys can notarize (`man notarytool` says yes, the ASC
  key docs say no) — one `notarytool history` call with an individual key
  settles it.
