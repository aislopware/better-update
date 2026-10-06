# 13. Desktop distribution: Windows, Linux, and finishing macOS

Status: draft (2026-10-06). Extends [12. macOS Developer ID builds](./12-macos-developer-id.md).

## Goal

A desktop app — Electron, Tauri, or native — ships on macOS, Windows and Linux
from one better-update project. Each platform gets the update feeds its
updaters read, differential downloads where the updater supports them, staged
rollout, first-install download links, and adoption numbers. Windows
Authenticode signing is out of scope for now: installers ship unsigned (the
updaters do not require a signature; SmartScreen warns on first install).

## Facts this design rests on

Read from the tools' source at the tags named (2026-10-06).

### electron-updater 6.8.10

- Channel file per platform (`Provider.getChannelFilePrefix`): Windows
  `<channel>.yml` (every arch), macOS `<channel>-mac.yml`, Linux
  `<channel>-linux.yml` for x64 and `<channel>-linux-<process.arch>.yml`
  otherwise (`-arm64`, `-arm` for armv7l, `-ia32`).
- Files are chosen by extension, then by preferring a URL that contains
  `process.arch` (`x64`, `arm64`, `ia32`, `arm`): Windows `exe` only (no MSI
  updater); Linux `AppImage` by default, or `deb` / `rpm` / `pacman` when the app
  carries `resources/package-type`.
- `minimumSystemVersion` (6.3+) is compared with `os.release()` using semver
  `lt`: a **kernel** version — Darwin on macOS (`23.1.0`), `10.0.22631` on
  Windows. A value that is not full semver is ignored with a log line.
  electron-builder never writes it; the server must.
- NSIS differential download: new blockmap at `<file URL>.blockmap`; old one
  from `current.blockmap` in the cache or the new URL with the new version
  replaced by the running one. Same mechanism the macOS zip already uses.
- AppImage differential download reads both blockmaps **embedded** at the end
  of the file (`[gzip blockmap][UInt32BE size]`), needing `size` and
  `blockMapSize` in the yml; otherwise it falls back to a full download.
  deb / rpm / pacman always download in full.
- Staged rollout stays client-side (`stagingPercentage`, `x-user-staging-id`).
- No Authenticode check without `publisherName` in `app-update.yml`: unsigned
  installers update.

### Tauri updater 2.13.1

- Static JSON keys tried in order `{os}-{arch}-{installer}`, `{os}-{arch}`;
  os `darwin|windows|linux`, arch `x86_64|aarch64|i686|armv7`, installer
  `app|nsis|msi|appimage|deb|rpm`.
- Since 2.10.0 installs NSIS `.exe`, `.msi`, `.AppImage`, `.deb`, `.rpm` directly
  (`createUpdaterArtifacts: true` signs those files). The zipped v1 forms
  still install but are deprecated.
- Dynamic endpoint variables `{{target}}` (os), `{{arch}}`,
  `{{current_version}}`, `{{bundle_type}}`; 204 = no update.

### WinSparkle 0.9.4

- `sparkle:os` on the enclosure: `windows`, `windows-x64`, `windows-x86`,
  `windows-arm64`; exact arch preferred. EdDSA `sparkle:edSignature` (0.9.0+),
  Windows-numbered `sparkle:minimumSystemVersion`, `sparkle:installerArguments`.
  An enclosure without `sparkle:os` counts as Windows-compatible, so Windows
  items get their own appcast.

### Sparkle 2.10.0 deltas

- `<sparkle:deltas><enclosure sparkle:deltaFrom="<old CFBundleVersion>" url length
type sparkle:edSignature sparkle:deltaFromSparkleExecutableSize
sparkle:deltaFromSparkleLocales/></sparkle:deltas>` inside the item; the
  client takes the delta whose `deltaFrom` equals its `CFBundleVersion` and
  falls back to the full archive on any failure.
- `bin/BinaryDelta create --version=<n> old.app new.app out.delta` from the
  release tarball; format 4 needs Sparkle ≥ 2.7 in the old app, 3 needs ≥ 2.1.
  Signed with the same EdDSA key as archives.
- `sparkle-cli` left the binary distribution in 2.9.0; it is built from the
  `sparkle-cli` Xcode target for end-to-end tests.

### Not supported, deliberately

- Squirrel.Windows (Electron's built-in `autoUpdater` on Windows): last
  release 2020, unmaintained.
- Velopack (`releases.<channel>.json` + nupkg): small adoption; can be added as
  a feed over the same release rows later.
- MSIX / App Installer, Snap, Flatpak, AppImageUpdate zsync: store- or
  OS-managed channels; electron-updater and Tauri do not use zsync.

## Data model

One build = one artifact stays. A desktop **version** is the set of builds
of one platform that share `app_version`; feeds aggregate them (a Linux x64
version lists its AppImage, deb and rpm; a Windows version its x64 and arm64
installers).

- `BuildPlatform` gains `windows` and `linux`; their distribution is `direct`.
- `ArtifactFormat` gains `exe`, `msi`, `appimage`, `deb`, `rpm`.
  `WindowsArtifactFormat = exe | msi`, `LinuxArtifactFormat = appimage | deb | rpm`.
- `metadata.windows` / `metadata.linux` (`DesktopBuildMetadata`): `appName`,
  `architectures` (`x64 | arm64 | ia32 | armv7l`), `minimumSystemVersion`
  (Windows build number form), `tauriPublicKey`, `winSparklePublicKey`,
  `blockMapSize` (AppImage embedded blockmap), `packageType` (`nsis | msi |
appimage | deb | rpm`), `fileName` (what the tool named the artifact).
- Migration 0108 rebuilds `builds` and `build_artifacts` to widen the CHECKs,
  stashing every child exactly as 0105 did **plus `desktop_releases`** (a
  CASCADE child since 0106).
- Migration 0109: `desktop_release_deltas` (Sparkle binary deltas: release,
  `delta_from` version, R2 key, size, EdDSA signature, Sparkle executable size,
  locales) and `desktop_releases.winsparkle_ed_signature`.

## Feeds

All public, under `/feeds/:projectId/<platform>/` (already exempt from the WAF
lockdown and routed to the API worker). An app's updater base URL is that
directory.

| Platform | Updater          | File                                                                                                           |
| -------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| macos    | Sparkle          | `appcast.xml` (+ `<sparkle:deltas>`)                                                                           |
| macos    | electron-updater | `<channel>-mac.yml` (+ `minimumSystemVersion`)                                                                 |
| windows  | electron-updater | `<channel>.yml`                                                                                                |
| windows  | WinSparkle       | `appcast.xml`                                                                                                  |
| linux    | electron-updater | `<channel>-linux[-arm64\|-arm\|-ia32].yml`                                                                     |
| any      | Tauri            | `<channel>-tauri.json` (static for that platform, or dynamic with `?arch=` / `?bundle_type=`)                  |
| —        | Tauri, all OSes  | `/feeds/:projectId/tauri/<channel>.json` (static across platforms, dynamic with `?target=&arch=&bundle_type=`) |
| any      | download         | `download/:releaseId/:file[.blockmap]`, `download/:releaseId/delta/:from.delta`                                |
| any      | first install    | `latest/download?format=&arch=&channel=` (302), `/feeds/:projectId/releases.json`                              |

- File names follow electron-builder's conventions so electron-updater's arch
  matching and old-blockmap URL substitution work: Windows
  `<App> Setup <version>[-arm64|-ia32].exe` made URL-safe
  (`<App>-Setup-<version>…`), Linux `<App>-<version>[-arm64].AppImage`,
  `<name>_<version>_<amd64|arm64>.deb`, `<name>-<version>.<x86_64|aarch64>.rpm`.
- `minimumSystemVersion`: macOS `LSMinimumSystemVersion` converted to Darwin
  (macOS ≥ 11: major + 9; 10.x: x + 4), always `M.m.p`; Windows taken as given
  and padded to three parts.
- First-install links take the newest **fully rolled out**, non-halted release;
  `releases.json` lists, per platform / channel, the newest version's
  downloads (format, arch, size, sha512, URL) for a website's download page.

## Analytics

A third Analytics Engine dataset (`DESKTOP_ANALYTICS`, deploy key
`BU_DESKTOP_ANALYTICS_DATASET`): one point per feed check (project, platform,
updater, channel, arch, served version, client version when the updater says
it, hashed install id) and per download (release, format, ranged/full, bytes).
The dashboard shows per release downloads and checks by client version over
30 days.

## CLI

- `build --platform windows|linux`: `custom` strategy only (electron-builder,
  Tauri, anything). `custom.<platform>.artifactPath` is a real glob (`**`,
  `{exe,msi}`); every file the command wrote that it matches becomes its own
  build. Each field comes from the first source that knows it: the profile's
  `windows` / `linux` section, then the app's config (`tauri.conf.json` with
  `tauri.<os>.conf.json` over it, else `package.json` / `electron-builder.json`),
  then the file (deb control, rpm header, AppImage ELF header and embedded
  blockmap, the name's arch token). An NSIS installer is a 32-bit stub, so
  Windows architectures come from the name or the profile. A deb's control
  member is read in any compression dpkg writes (xz through `xz-decompress`,
  xz-embedded compiled to WebAssembly, so the single binary needs no `xz`).
- `builds upload --platform windows|linux <file…>`: the same, for artifacts
  built elsewhere (a Windows CI runner); eas.json is optional there.
- `windows release` / `linux release` (`create|list|rollout|halt|resume|delete`)
  share `macos release`'s implementation. `create` without build ids releases
  every build of the newest version not yet on the channel; several ids may be
  given. `--json` keeps printing one release as an object (a list for several).
  Signs Tauri (minisign) and WinSparkle (EdDSA, `$WINSPARKLE_PRIVATE_KEY`)
  locally and computes the NSIS blockmap.
- `macos release create` generates Sparkle deltas from the channel's previous
  three releases (BinaryDelta from a pinned, SHA-256-checked Sparkle tarball;
  format by the old app's Sparkle version), signs and uploads them.

## Testing

- Server e2e (Workers runtime + D1): per-platform feeds, rollout, permalinks,
  releases.json, deltas, analytics writes.
- CLI e2e: windows/linux upload + release journeys with synthetic installers.
- Slow, real clients:
  - Sparkle: a fixture app embedding Sparkle updates itself with
    `sparkle-cli` (built from source), full and delta.
  - Electron macOS: a real Electron app updates through Squirrel.Mac.
  - Linux (Docker): an Electron AppImage and deb, and a Tauri AppImage, update
    themselves against the local server.
  - Windows: no Windows host is available. electron-updater's own provider
    and file selection resolve the Windows feed, and its differential
    downloader rebuilds an NSIS installer; Tauri's JSON is checked against the
    key order above. A real Windows install remains unverified.

## Phases

1. Server: platforms, formats, migration 0108, Windows/Linux feeds, Tauri
   cross-platform feed, WinSparkle, `minimumSystemVersion`, permalinks,
   `releases.json`.
2. CLI: `build --platform windows|linux`, `builds upload`, artifact
   inspection, `windows|linux release`, multi-build releases.
3. Sparkle deltas (migration 0109, CLI generation, appcast).
4. Analytics.
5. Dashboard: desktop releases per platform, Windows/Linux builds, analytics.
6. Real-client end-to-end tests.
7. CLI binary for Windows (needs a Windows host to verify).
