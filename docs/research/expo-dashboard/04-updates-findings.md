# Updates / Channels / Branches / Runtimes — UI/UX findings

The OTA area is split into 4 conceptual entities, each with its own list page + detail page:

```
Channel  ↔  Branch  ↔  Update group  ↔  Runtime
                              ↓
                     per-platform Update (Android + iOS)
```

## Update groups (list)

Path: `/updates`. Plain data table, no filters.
Columns: Update (message + relative time) · Commit (8-char SHA + copy) · Platforms (Android/Apple icons) · Runtime · Branch (pill) · row kebab

Header right: "Find update by ID" button (opens search dialog).
Header `?` opens a top-anchored tooltip: "Updates allow you to deliver code directly to your users. Learn more →".

Row kebab actions: **Republish** · **Delete**.

## Update group detail (`/updates/<id>`)

**Sub-sidebar** under "UPDATE GROUP DETAILS": Overview · Android · iOS — drill into per-platform log of bundle assets.

Header card: "Update group" + message subtitle, **Preview** primary button (top-right), kebab.

Metadata table: Group ID · Branch · Runtime · Commit · Created by · Created at · Updated at — every cell linked or copy-able.

**Platform-specific updates** table — the killer feature:
| Platform | ID | Fingerprint | Downloads (?) | Avg size (?) | [mini histogram] | Known launches (?) | Known crashes (?) |

- Per-platform download count, size, crash rate (absolute + %), tiny size-distribution sparkline
- Question-mark tooltips on every header (Downloads / Average size / Known launches / Known crashes — definitions that aren't obvious)

**Deployments** table: where this update is live now.
| Runtime | Builds (count) | Channel (pill) | Branch (with update message) |

### Preview update dialog (the killer feature)

Triggered by Preview button. Contains:

- Summary: Runtime version · Published timestamp · Platforms
- **QR code** to scan in dev client / Expo Go for instant load
- **Compatible development builds** list (clickable cards showing each build that can load this update)
- Update URL with copy: `https://expo.dev/preview/update?message=...&runtimeVersion=...&group=...`
- Deep link with copy: `exp+aaf://expo-development-client/?url=https%3A%2F%2Fu.expo.dev%2F.../group/...`

This puts the QA test loop at one click. No CLI needed for testers/PMs.

## Channels (list)

Path: `/channels`. Table.
Columns: Channel · Status (Active green pill) · Linked branches · ID (+copy) · kebab

Header: "Create channel" CTA + Search input.

Row kebab: **Pause channel** · **Delete channel** — pause is the emergency stop.

## Channel detail (`/channels/<name>` and `/channels/<name>/<runtime>`)

Header: "Channel: <name>" + **Runtime dropdown** (top-right) + kebab.

Below: Status / ID / Created at table.

**Active users** chart card:

- Line chart over time, range selector (Last 1 Day default, dropdown for others)
- `%` toggle button next to range
- "Read more…" expandable explanation

Update history table per-runtime: Update · Commit · Platforms · Unique Users.

### Channel-runtime view (`/channels/<name>/<runtime>`)

Shows specific runtime under specific channel:

- Active users chart (same)
- Embedded update row (the bundle the binary ships with — interesting concept, an OTA update can also be embedded in the binary itself for offline-first)
- **Channel-branch mapping** card with visual diagram on grid background:
  ```
  [ Channel: preview  ]  →  [ Branch: preview                       ]
  [ 80 builds         ]      [ Update "2026-04-28 10:15 | OTA update" ]
  ```
  with **Edit** button at top-right
- **Completed builds** table for this channel-runtime combo

### Edit channel-branch mapping (rollout dialog)

Triggered by Edit on the mapping card. Two-tab dialog:

**Default tab:** single combobox to repoint channel → a different branch.

**Rollout tab** (progressive deployment):

- Runtime version select
- **Branch 1** (current default branch) with editable % textbox (default 100)
- **Branch 2** (new branch) with editable % textbox (default 0)
- "Preview of changes" English summary:
  > Of builds for channel "preview":
  >
  > - 100% will receive the latest update on branch "preview"
  > - 0% will receive the latest update on branch "None"
- "Create Rollout" CTA (disabled until valid)

This is canary/blue-green for OTA. Percent split per build (not per user) — important detail.

## Branches (list)

Path: `/branches`. Table.
Columns: Branch · Runtime (linked) · Latest update (message + author + time) · Latest update ID (+copy) · kebab

Header: "Create branch" + Search.
Row kebab: **Delete** (no pause — branches are passive, channels are the live wire).

## Branch detail (`/branches/<name>`)

Header: "Branch: <name>" + Preview button + kebab.

Metadata: latest update ID (+ copy).

**Updates for branch** section with **Select runtime…** filter combobox.
Then table: each row shows Update message + time, ID, runtime, **Android & Apple icons** (which platforms got it), and 2 buttons.

## Runtimes (list)

Path: `/runtimes`. Simple list of runtime versions with creation date. Each row is a link to that runtime's detail.

## Runtime detail (`/runtimes/<version>`)

Unified hub view = "everything that runs on runtime X":

1. **Native deployments** table — per-channel snapshot:
   | Deployment (runtime + date) | Builds (count) | Channel (pill) | Branch + current update message |
2. **Builds** table — recent builds for this runtime (last 4 + "All builds" link)
3. **Updates** table — recent updates pushed to this runtime

This is the runtime-compatibility-reasoning view. Great for "what binary versions can pick up this OTA update?" thinking.

## Take-aways for better-update

1. **Preview-update dialog with QR + compatible builds list + deep link** — biggest win. Every update detail should have one-tap test loop. Better-update CLI already has channel + runtime + branch concepts; the dashboard needs to surface a QR for the existing dev client.
2. **Per-platform metrics on every update** (downloads, size, launches, crashes %) — built-in observability without a separate analytics page. Better-update doesn't have crash reporting yet; partner with Sentry/NR to ingest these or compute "served" count at least.
3. **Channel-branch mapping diagram** — beats a settings form for understanding routing. Use a small visual canvas (channel → branch arrow) for the deploy view.
4. **Rollout mode** — true canary with percentage split, "Preview of changes" plain-English diff. better-update needs this for safe production OTAs.
5. **Pause channel** — emergency stop on a deploy. Distinct from delete. The channel stays mapped but stops serving updates.
6. **Runtime as a unified hub** — group everything (builds + updates + per-channel deployments) by runtime. Better-update's runtime page should follow this pattern instead of being just a metadata blob.
7. **Republish action** on update — surface as a row kebab on update list. Useful when a branch was incorrectly mapped or to bump a rollback.
8. **No filters on update groups list** — Expo chose to keep the table flat with just a "Find by ID" search. Branches/channels do the categorical filtering implicitly. Worth considering before adding too many filters.
9. **Question-mark inline tooltips** on metric headers (Downloads, Crashes, Availability, Queue time) — embed definitions where data is shown, not in a separate docs page.
10. **Linked branches column** on channels table — explicit data link visualization rather than hiding the relation in metadata.
