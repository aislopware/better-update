# Kumo migration — research & plan

Status: P0–P3, P5 and P6 shipped. P4 is in progress — see the phase list for
what landed and what was tried and rejected.
Researched against `github.com/cloudflare/kumo` @ `main` (clone 2026-08-07) and
`@cloudflare/kumo@2.9.1` installed from npm.

Goal: replace the shadcn/base-nova UI layer in `packages/ui` + `apps/web` with
Cloudflare's Kumo, and — beyond a 1:1 swap — adopt the layout, density and
interaction conventions that make the Cloudflare dashboard feel the way it does.

---

## 1. What Kumo actually is

| Fact            | Value                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| Package         | `@cloudflare/kumo`, MIT, public on npm                                     |
| Version         | `2.9.2` latest (`2.9.1` installable today — 24h `minimumReleaseAge` gate)  |
| Primitive layer | **Base UI `^1.6.0`** — the exact dep `packages/ui` already uses            |
| Styling         | Tailwind **v4**, semantic tokens only, `light-dark()` CSS                  |
| Module format   | ESM-only, `"use client"` on 327 dist files, granular subpath exports       |
| Required peer   | `@phosphor-icons/react ^2.1.10`                                            |
| Optional peers  | `echarts ^6` (charts), `zod ^4` (already ours)                             |
| Bundled deps    | `motion`, `shiki`, `react-day-picker ^9`, `d3-geo`                         |
| Components      | 45 (`src/components/`) + 3 installable "blocks"                            |
| Agent docs      | `AGENTS.md`, `skills/kumo-design/SKILL.md`, `npx @cloudflare/kumo doc <X>` |

The single most important finding: **Kumo and our `packages/ui` sit on the same
primitive layer (Base UI 1.6).** Behaviour, ARIA, focus management, `render`-prop
composition and `data-*` state attributes are identical. This is a re-skin plus
an API rename, not a rewrite of interaction logic.

### Feasibility — verified, not assumed

Installed Kumo + Phosphor + echarts into a throwaway worktree of this repo, added
a probe route exercising `Badge / Banner / Button / Empty / LayerCard / Meter /
SensitiveInput / Table / Tabs / Text / Tooltip`, and ran the real app build:

- `bun run build` in `apps/web` → **passed** (Vite 8, TanStack Start SSR, React 19,
  Tailwind 4, Cloudflare Workers target).
- `tsc --noEmit` → **types resolve end-to-end**; the only errors were my four
  wrong API guesses in the probe (`Banner variant="info"` doesn't exist,
  `Meter` requires `label`, `Table.HeaderCell` is really `Table.Header`).
- `bun install` resolved cleanly alongside our existing tree; `react-day-picker`
  v9 (Kumo) and v10 (our calendar) coexist as separate copies.

**One hard constraint discovered:** importing the barrel `@cloudflare/kumo`
pulled a **594 kB** chunk into the probe route. Charts/maps/shiki are all in the
barrel. Granular imports (`@cloudflare/kumo/components/button`) are mandatory,
not a nicety — this should be lint-enforced.

---

## 2. Design system: theirs vs ours

### 2.1 Colour tokens

Kumo's surfaces are a named ladder rather than shadcn's role names:

| Kumo                                                                 | Meaning                                   | Our nearest                                     |
| -------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| `bg-kumo-canvas`                                                     | page background                           | `--background`                                  |
| `bg-kumo-base`                                                       | raised surface (cards)                    | `--card`                                        |
| `bg-kumo-elevated`                                                   | layered card outer shell                  | `--surface`                                     |
| `bg-kumo-recessed`                                                   | inset wells                               | — (we have none)                                |
| `bg-kumo-overlay`                                                    | list-page wash                            | —                                               |
| `bg-kumo-tint`                                                       | hover fill                                | `--accent`                                      |
| `bg-kumo-fill` / `-fill-hover`                                       | control fill                              | `--secondary`                                   |
| `text-kumo-default / -strong / -subtle / -inactive / -placeholder`   | 5-step text ramp                          | `--foreground` / `--muted-foreground` (2 steps) |
| `border-kumo-line` / `ring-kumo-hairline`                            | 2-tier borders                            | `--border-subtle/-/-strong` (3 tiers)           |
| `-tint` suffixed status colours                                      | `info/success/warning/danger` backgrounds | `--info/-success/...`                           |
| `bg-kumo-badge-{red,green,orange,purple,teal,blue,neutral,inverted}` | categorical badges                        | — (we have none)                                |

Notes that matter:

- **Our brand hue already matches Cloudflare's.** Ours is `oklch(0.55 0.2 260)`,
  Kumo's `--color-kumo-brand` is `oklch(0.5772 0.2324 260)`. Same hue family —
  the accent migration is nearly a no-op. (Kumo's _orange_ `#f6821f` is reserved
  for `text-kumo-brand`/logo only.)
- Kumo has a **richer text ramp** (5 steps vs our 2) and **categorical badge
  colours** we simply don't have. Both are direct information-density wins.
- Dark mode is **`data-mode="dark"` + `light-dark()`**, not a `.dark` class and
  not `dark:` variants. Our `lib/theme-server.ts` currently writes `.dark`; it
  must write both during the transition.

### 2.2 Typography — the biggest visual delta

Kumo redefines Tailwind's scale outright:

```
--text-xs: 12px   --text-sm: 13px   --text-base: 14px   --text-lg: 16px
```

So `text-base` = **14px**, and the design rule is: _all_ content text — body,
buttons, table cells, labels — is 14px; 16px+ is reserved for headings. Our app
currently mixes `text-sm` (14px) for content and `text-base` (16px) in places.
Adopting Kumo's scale is what actually produces the tighter, more informative
Cloudflare feel — and it means our existing `text-sm`/`text-base` usages change
meaning, so they must be swept, not left alone.

### 2.3 Rules from `skills/kumo-design/SKILL.md` worth adopting wholesale

These are Cloudflare's own product-design rules. Several contradict what we do now:

1. **14px content text**, sentence-case headings, never `tracking-*`, never `font-bold`
   (use `font-semibold` headings / `font-medium` inline).
2. **Never transition colours on hover** — instant. We currently use
   `transition-colors` in several places; that reads as sluggish.
3. **Never `border` + `shadow` together** — use `ring ring-kumo-line` so edges
   stay sharp. Our cards use `border` + `shadow-xs`.
4. **Concentric radii** — outer radius = inner radius + padding whenever rings
   are ≤8px apart.
5. **Optical text spacing** — vertical padding slightly less than horizontal
   (`px-5 py-4`, never `p-5`).
6. **Related text closer together** — title/description at `gap-1.5` inside a
   `gap-6` block. (Our `PageHeader` already does this.)
7. **Icons aligned to the first line** via `h-lh flex items-center`, not
   `items-center` on the row.
8. **Inline monospace at `0.9em`** when mixed with prose.
9. **Sticky elements get a `border`** to separate from scrolled content.
10. **Never nest `LayerCard` in `LayerCard`** — heading + card, not card + card.
11. **Never conditionally render dialogs** — drive with `open`. (We already
    follow this; see `feedback_dialog_form_no_conditional`.)

Rules 2, 3 and 5 are direct, mechanical changes to our current Graphite styling.

---

## 3. Component mapping

### 3.1 Direct replacements (usage counts from `apps/web`)

| Ours (uses)                                                                                                                                | Kumo                                                                                                                                                       | Notes                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `button` (88)                                                                                                                              | `Button`                                                                                                                                                   | variants: primary/secondary/ghost/destructive/secondary-destructive/outline; `shape` square\|circle; built-in `loading`, `icon`; `LinkButton`, `RefreshButton` |
| `spinner` (52)                                                                                                                             | `Loader`                                                                                                                                                   |                                                                                                                                                                |
| `toast` (44)                                                                                                                               | `Toasty` + `createKumoToastManager()`                                                                                                                      | manager has `add`/`notify`/promise helpers with `success`/`error` — our `toast.success/error` sugar ports directly                                             |
| `card` (39)                                                                                                                                | `LayerCard`                                                                                                                                                | `+ .Primary` / `.Secondary` layered treatment we don't have                                                                                                    |
| `badge` (39)                                                                                                                               | `Badge`                                                                                                                                                    | 17 variants incl. 7 categorical colours + `beta`                                                                                                               |
| `dialog` (33)                                                                                                                              | `Dialog`                                                                                                                                                   | `role="alertdialog"` covers our AlertDialog convention                                                                                                         |
| `field` (29)                                                                                                                               | `Field`                                                                                                                                                    | Input/Select/Combobox auto-wrap when given `label`                                                                                                             |
| `empty` (24)                                                                                                                               | `Empty`                                                                                                                                                    |                                                                                                                                                                |
| `input` (23)                                                                                                                               | `Input`                                                                                                                                                    |                                                                                                                                                                |
| `table` (19)                                                                                                                               | `Table`                                                                                                                                                    | `.Head/.Body/.Row/.Header/.Cell/.Footer/.ResizeHandle/.CheckCell/.CheckHead` — column resize built in                                                          |
| `input-group` (13)                                                                                                                         | `InputGroup`                                                                                                                                               |                                                                                                                                                                |
| `skeleton` (12)                                                                                                                            | `SkeletonLine`                                                                                                                                             |                                                                                                                                                                |
| `select` (12)                                                                                                                              | `Select`                                                                                                                                                   |                                                                                                                                                                |
| `dropdown-menu` (9)                                                                                                                        | `DropdownMenu`                                                                                                                                             |                                                                                                                                                                |
| `tooltip` (6)                                                                                                                              | `Tooltip` + `TooltipProvider`                                                                                                                              |                                                                                                                                                                |
| `alert-dialog` (6)                                                                                                                         | `Dialog role="alertdialog"`                                                                                                                                | not dismissible on outside click                                                                                                                               |
| `textarea` (5)                                                                                                                             | `InputArea` / `Textarea`                                                                                                                                   |                                                                                                                                                                |
| `switch` (5)                                                                                                                               | `Switch`                                                                                                                                                   |                                                                                                                                                                |
| `popover` (5)                                                                                                                              | `Popover`                                                                                                                                                  |                                                                                                                                                                |
| `alert` (5)                                                                                                                                | `Banner`                                                                                                                                                   | variants: default/secondary/alert/error                                                                                                                        |
| `command` (3)                                                                                                                              | `CommandPalette`                                                                                                                                           | 14 sub-components, richer than cmdk                                                                                                                            |
| `sidebar` (2)                                                                                                                              | `Sidebar`                                                                                                                                                  | same shadcn-derived API + `SlidingViews`, `ResizeHandle`, peek state                                                                                           |
| `checkbox` (2)                                                                                                                             | `Checkbox`                                                                                                                                                 |                                                                                                                                                                |
| `label` (2)                                                                                                                                | `Label`                                                                                                                                                    |                                                                                                                                                                |
| `tabs` / `radio-group` / `combobox` / `breadcrumb` / `calendar` / `date-range-picker` / `chart` / `progress` / `toggle` / `sheet` (1 each) | `Tabs` / `Radio`+`RadioGroup` / `Combobox` / `Breadcrumbs` / `DatePicker` / `DatePicker mode="range"` / `Chart` / `Meter` / `primitives/toggle` / `Dialog` |                                                                                                                                                                |

### 3.2 Gaps — Kumo has no equivalent, we keep a local component

- **`avatar`** — only a Base UI primitive re-export. Our `lib/entity-avatar.tsx`
  stays, restyled onto Kumo tokens.
- **`item`** (6 uses) — no Kumo equivalent; rebuild on `LayerCard` + tokens.
- **`kbd`** — build locally (trivial).
- **`separator` / `scroll-area`** — use `@cloudflare/kumo/primitives/*`.
- **`card` sub-parts** (`CardHeader/Title/Description/Content/Footer`) — Kumo's
  `LayerCard` is flatter by design; our `SettingCard` / `StatCard` wrappers
  absorb the structure.

### 3.3 What Kumo gives us that we don't have — the "not 1:1" upside

This is where the migration earns its cost:

| Kumo                                                                                               | What it unlocks here                                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`Meter`**                                                                                        | rollout percentage, storage quota, adoption rate — first-class instead of ad-hoc bars                                                                             |
| **`SensitiveInput`**                                                                               | purpose-built for env-var values and vault secrets (reveal/mask/copy)                                                                                             |
| **`Code` / `CodeBlock`** (Shiki, with a `/code/server` export for SSR)                             | replaces `cli-command-block.tsx` with real syntax highlighting                                                                                                    |
| **`ClipboardText`**                                                                                | inline copy affordance for ids, hashes, bundle identifiers                                                                                                        |
| **`Chart`** — `TimeseriesChart`, `Sankey`, `BubbleMap`/`ChoroplethMap`, sparklines, `ChartPalette` | update-adoption over time; **Sankey for build → publish → channel → device flow**; **geo map of install locations**. ECharts is what the CF dashboard itself uses |
| **`Flow`**                                                                                         | node/connector diagrams — the OTA pipeline visualised                                                                                                             |
| **`Pagination`**                                                                                   | our lists are server-paginated but have no proper pager UI                                                                                                        |
| **`Toolbar`**                                                                                      | the filter/search/action bar above tables                                                                                                                         |
| **`Banner`**                                                                                       | page-level notices (stale profile, vault locked, killswitch)                                                                                                      |
| **`Grid` / `GridItem`**                                                                            | consistent dashboard grids                                                                                                                                        |
| **`TableOfContents`**                                                                              | long settings pages                                                                                                                                               |
| **`Table.ResizeHandle` / `CheckCell`**                                                             | resizable + selectable data tables                                                                                                                                |
| **Blocks**: `PageHeader`, `ResourceListPage`, `DeleteResource`                                     | Cloudflare's own page skeletons — `DeleteResource` is exactly our "type the name to confirm" destructive flow, already built                                      |

---

## 4. Layout & UX conventions to adopt

Read off Kumo's blocks and the design skill, these are the structural patterns:

**Page shell (`ResourceListPage`)** — `max-w-[1400px]`, responsive padding
(`p-6 → md:p-8 → lg:px-10 lg:py-9`), main column + **sticky 380px right rail**
(`xl:sticky top-22`) that collapses below the content on narrow screens. Today
we render a single full-width column; the rail is where usage meters, quick
facts and related links belong. Our container is `max-w-[1416px]` — close enough
to keep.

**Page header (`PageHeader` block)** — breadcrumbs in a bottom-bordered strip,
then title + description, then a tabs row with actions right-aligned, also
bottom-bordered. Our `PageHeader` has title/description/actions but no
breadcrumb strip and no tab integration; breadcrumbs currently live in the app
header instead.

**Cards** — `LayerCard.Secondary` (muted header strip) + `LayerCard.Primary`
(white body) is the layered treatment Cloudflare uses for grouped resources; we
have no equivalent and currently nest bordered divs.

**Density** — 14px everywhere, `h-9` default buttons (`h-6.5` sm, `h-5` xs),
badges `px-2 py-0.5 text-xs`. Meaningfully tighter than our current defaults.

**Destructive flows** — `DeleteResource`: name-echo confirmation, copy-to-clipboard
of the name, inline error banner, disabled-until-matched. Stronger than our
current AlertDialog confirms.

---

## 5. Risks and decisions required

| #   | Issue                                                                                                             | Impact                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Icons**: Kumo renders `@phosphor-icons/react` internally; we use `lucide-react` in ~everything                  | **Resolved**: swept to Phosphor (93 files). `strokeWidth` → `weight="bold"`; `lucide-react` dropped.                                                                                                                                                                                  |
| R2  | **Charts**: Kumo `Chart` needs `echarts`; we use `recharts`                                                       | **Resolved**: analytics moved to Kumo `Chart`/`TimeseriesChart` over ECharts 6; `recharts` dropped.                                                                                                                                                                                   |
| R3  | **Typography scale** changes the meaning of `text-sm`/`text-base`                                                 | Must sweep every usage; cannot be left half-done                                                                                                                                                                                                                                      |
| R4  | **Dark mode** `.dark` class → `data-mode="dark"`                                                                  | `lib/theme-server.ts` must emit both during transition; theme tests (`theme-css-audit.test.ts`) will need updating                                                                                                                                                                    |
| R5  | **Barrel imports cost 594 kB**                                                                                    | Enforce granular imports via lint from day one                                                                                                                                                                                                                                        |
| R6  | `Text` forbids `className` (`DANGEROUS_className` instead)                                                        | Changes how we write one-off text styling; arguably a good constraint                                                                                                                                                                                                                 |
| R7  | Kumo ships no Avatar/Item/Kbd                                                                                     | Keep local components (small)                                                                                                                                                                                                                                                         |
| R8  | Kumo moves fast (2.9.2 published yesterday); `DateRangePicker` and `Surface` already deprecated                   | Pin exactly, avoid deprecated APIs                                                                                                                                                                                                                                                    |
| R9  | `packages/ui` is a shadcn registry surface (`components.json`, `bunx shadcn add`)                                 | Migration retires that workflow; CLAUDE.md's UI rules and the `shadcn` skill guidance must be rewritten                                                                                                                                                                               |
| R10 | 175 route files / ~37k LOC in `apps/web`, 24 component test files, e2e selectors (`[data-slot="dialog-content"]`) | Kumo emits `data-kumo-component`/`data-kumo-part`, and `data-slot` only on `Pagination` (`pagination`, `-info`, `-controls`, `-page-size`). Everywhere else the slot belongs to a hand-written composition, which is why the e2e scoping selector is now `[data-slot="dialog-body"]`. |

---

## 6. Proposed phases

Each phase ends green on `bun run lint` + `bun run test`, so the app is never
half-migrated in a shipped state.

- **P0 Foundation** — add deps; import `@cloudflare/kumo/styles/tailwind`; bridge
  `data-mode` alongside `.dark` in `theme-server`/`theme-context`; wire
  `LinkProvider` to TanStack Router `Link`; `KumoPortalProvider`; toast manager;
  lint rule banning the barrel import. No visual change yet.
- **P1 Token & type cutover** — map our semantic tokens onto Kumo's ladder, adopt
  the 12/13/14/16 type scale, sweep `text-*` usages, apply the ring-not-border
  and no-hover-transition rules.
- **P2 Primitives** — replace `packages/ui` components with Kumo re-exports +
  the few local keepers (Avatar, Item, Kbd). Highest-usage first: Button, Card→
  LayerCard, Badge, Dialog, Field, Input, Table, Toast.
- **P3 Shell** — app sidebar, header, breadcrumbs, command palette onto Kumo
  `Sidebar` + `CommandPalette`; adopt the `PageHeader` block structure.
- **P4 Page redesign** — per surface, not a port. Landed: Kumo's page measure
  (centred at 1400px on its padding ladder), `Toolbar` grouping every list
  filter into one card, `Pagination` as the table footer, and the
  `DeleteResource` name-echo — a copyable chip, `alertdialog`, autofill off.
  Rejected with reasons: a **sticky table header** cannot work against page
  scroll while the table sits in a horizontal scroll container (any non-visible
  overflow axis forces both into a scrollport), and Kumo's own list block
  scrolls the page and sticks the _rail_ instead; a **sticky right rail** wants
  a list-plus-summary page, while our detail pages are card stacks, so adopting
  it is an IA change rather than a restyle; **dot badges** suit a short status,
  but a channel's reads "Rolling out to <branch> 25%", which a pill would wrap.
  The §2.3 rules were then swept one by one. Fixed: **never transition colours
  on hover** (19 sites plus the `Item`/`Table` primitives — the surviving
  `transition-opacity` reveals a control rather than tinting one); **never
  border + shadow together** (one site, the CLI block, now ringed); **never
  `font-bold`** (one site, the org-delete label); **inline monospace at
  `0.9em`** (13 sites written three ways, now an `InlineCode` primitive — the
  ratio is relative so it tracks whatever it is nested in). Checked and left
  alone: **optical padding `px-5 py-4`** — that rule is for text blocks, and
  Kumo's own `LayerCard` pads its sections with a symmetric `p-4`, which our
  `Card` already matches; following the rule literally would move us away from
  the component we compose.
- **P5 Data viz** — timeseries adoption charts, Sankey for the update pipeline,
  geo map of installs.
- **P6 Cleanup** — done bar the `better-update` skill: `shadcn`, `recharts` and
  `lucide-react` are gone, `components.json` is retired, the shadcn colour-role
  aliases in `app.css` are deleted (only `terminal*`/`brand*` survive, which
  Kumo has no word for), `CLAUDE.md`'s UI rules are rewritten and the e2e
  selectors are retargeted. `tw-animate-css` stays: Kumo's
  dropdown draws its enter/exit with `animate-in`/`slide-in-from-*` and ships
  no definitions for them.

---

## 7. Sources

- `github.com/cloudflare/kumo` — `AGENTS.md`, `packages/kumo/AGENTS.md`,
  `packages/kumo/src/components/AGENTS.md`, `skills/kumo-design/SKILL.md`
- `packages/kumo/src/styles/theme-kumo.css`, `kumo-binding.css`
- `packages/kumo/src/blocks/{page-header,resource-list,delete-resource}`
- `packages/kumo-docs-astro/src/pages/colors.mdx`
- Live docs: <https://kumo-ui.com>
