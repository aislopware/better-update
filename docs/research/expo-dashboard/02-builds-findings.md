# Builds — UI/UX findings

## List page

### Filters (top of list, horizontal toolbar)

1. **Platform** combobox: All / Android / iOS
2. **Channel** button-menu: All / staging / preview / development / production
3. **Runtime version** button-menu: All / dynamic list of versions present in builds
4. **Profile** button-menu: All / dynamic list of profiles present in builds (staging-simulator, preview, staging, production, development)
5. **Build type** combobox: All / Build / Custom / Local / Repack / Resign
6. Help icon `?` (explains filter combo logic)

Two filter visual styles co-exist:

- Form-style **combobox** for orthogonal categorical (Platform, Type)
- Menu-style **button-menu** for tag-based filters where options come from data (Channel, Runtime, Profile)

### List card row

Single horizontal row per build:

```
[Status icon] [Type label "iOS internal distribution build"] [Version "1.0.0 (5)"] [Date + duration "Apr 16, 2026  8m 33s"] [Channel pill] [Runtime pill] [Profile pill]
```

- Status icons: green check (Finished), red X (Errored), yellow ⊘ (Canceled), Expired (text tag, not icon)
- Channel/Runtime/Profile are clickable pills linking to filtered views or their own pages
- Whole row navigates to detail
- "Build from GitHub" CTA button at top of list (disabled if GH not connected)

## Detail page

### Header card

- Title: type label "iOS internal distribution build" + platform icon
- Subtitle: full commit message (truncated, hover/expand for full)
- Top-right: **Compare** button (always), **Copy error as prompt** button (only on errored)
- Right icon button (notebook/document icon, purpose unclear — maybe pin/note)

### Metadata table (horizontal, info-dense)

6-7 columns, single row:
| Profile (?) | Environment | Deployment | Version | Fingerprint | Commit | Created by |

- Each cell has a label + value
- Values are clickable (Profile → filter, Env → env vars page, Deployment → runtime/channel detail, Fingerprint → fingerprint detail, Commit → copy button)
- Avatar + name for "Created by"

### Build artifact card

Header row: "Build artifact" + type tag ("IPA" / "APK") + actions:

- Primary CTA: **Install** (dark button, opens install instructions/page)
- Secondary: **Open with Orbit** (Expo's desktop install helper)
- Kebab menu: Retry, Clear cache and retry, Delete build (disabled actions show _reason inline_: "Builds can only be retried within 180 minutes from completion")

Stats table (horizontal, 6 cols):
| Status | Start time | Wait time | Queue time (?) | Build time | Total time | Availability (?) |

- Help tooltips on ambiguous metrics (Queue time, Availability)
- "Availability" = how long artifact remains downloadable (e.g. "57 days")

### Logs card

Header: "Logs" + kebab menu with toggles:

- Use dark theme (default on)
- Show line numbers (default on)
- Show timestamps (default off)
- Show output stream label (default off)
- Show build annotations (default on)
- Wrap log lines (default on)

Body: list of collapsible step rows. Each step has:

- Status circle (green/red)
- Step name (e.g. "Install pods")
- Duration right-aligned (e.g. "1m 46s")
- Copy button (copies step log)
- Optional warning/error count badge between name and duration (e.g. "1" red badge)

Step content (when expanded): dark terminal panel, monospace, syntax-colored lines, line-numbered.

### Error UX patterns (errored builds)

- Failed step icon turns red ❌
- Below failed step, an auto-generated **"Fail job"** step shows the structured error summary in red text on dark background
- Pre-classified error format:
  ```
  Build failed: The "Run fastlane" step failed ...
  We automatically detected following errors in your Xcode build logs:
  - Provisioning profile "..." doesn't include the Associated Domains capability.
  - ...
  Refer to "Xcode Logs" below for additional, more detailed logs.
  ```
- **"Xcode Logs"** section appears (auto) with notice "logs not displayed by default because too large" + Download + View in browser
- **"Copy error as prompt"** button (top of page) → opens dialog with structured XML prompt for AI coding agent:
  ```xml
  <build id="..." platform="IOS">
    <project fullName="..."/>
    <profile>preview</profile>
    <buildMode>BUILD</buildMode>
    <distribution>INTERNAL</distribution>
    <appVersion>1.0.0</appVersion>
    <sdkVersion>55.0.0</sdkVersion>
    <runtimeVersion>1.0.0</runtimeVersion>
    <fingerprint>...</fingerprint>
    <git commit="..." message="..."/>
    <cliVersion>18.7.0</cliVersion>
  </build>
  <instructions>
    Investigate the build failure and propose a fix.
    Run `npx eas-cli@latest build:view <id> --json` from your project directory for full build metadata, including log file URLs.
  </instructions>
  ```

### Compare builds dialog

Triggered by Compare button. Single textbox accepts build ID or URL, then submits to a diff view.

## Take-aways for better-update

1. **Error→AI handoff is killer**: "Copy error as prompt" is a 2026-grade feature — better-update should have it on failed updates (and CLI build failures) so dev can paste straight into Claude Code. Structure with `<update>`, `<runtimeVersion>`, `<channel>`, `<environment>`, plus a built-in instruction line.
2. **Auto-classified error step**: don't dump raw log; parse out the failure signature and show it on a red panel ("Fail job" pattern), with "view full log" expand.
3. **Disabled-action reason inline**: "Retry — Builds can only be retried within 180 minutes" beats a tooltip — never make user guess why a button is grey.
4. **Log viewer toggles in a single kebab**: dark theme, line numbers, timestamps, stream label, wrap — keep all view preferences together instead of scattering them across a settings page.
5. **Horizontal metadata table** instead of stacked label/value pairs saves a lot of vertical space and works in dense list contexts.
6. **Clickable metadata pills** (channel/runtime/profile/fingerprint) connect everything — every metadata value is a link to that entity's page or a filtered list.
7. **Step-based log with duration per step**: better-update CLI build pipeline already has phases (resolve credentials, run native build, upload artifact, register update). Mirror this step structure in the dashboard build detail.
8. **Artifact retention badge** ("Availability 57 days") sets expectation up front; pair with a "Re-build to refresh artifact" CTA when expired.
9. **Compare builds** — interesting; for updates, a "Compare updates" diff (asset list, JS bundle size delta, runtime version change, channel) would be valuable for QA review.
