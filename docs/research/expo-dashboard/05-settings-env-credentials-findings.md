# Settings · Env vars · Credentials · Push · Integrations — UI/UX findings

## Project Settings (`/settings`)

Card-per-concern layout, each card has its own Save button (no global save bar).

Cards:

1. **Display name** — text input + Save (form-validated)
2. **Project icon** — image upload + "Edit app icon" button
3. **Connections** — list of integrations, each row: icon + name + status ("Not connected" / "Connected to ...") + Connect/Disconnect button. Disabled rows include a reason hint. Apps: App Store Connect, Convex, LogRocket, Sentry, Vexo.
4. **Email notifications** — per-event Subscribe buttons (EAS Build / EAS Submit)
5. **Unauthenticated access to internal distribution builds** — switch toggle (lets testers install dev builds without an Expo account)
6. **Danger zone** at bottom:
   - **Transfer project** to another account
   - **Delete project** — Start deletion button (disabled here, probably has live data preconditions)

## Environment variables (`/environment-variables`)

Power-user data table.

Toolbar:

- **Environment** filter combobox: All / production / preview / development
- **Scope** filter combobox (Project / Account level)
- "Filter by name" search
- "Export" button (download all as `.env`)
- "Add Variables" CTA
- Bulk action buttons (Edit / Delete) — activate on row selection

Table columns:

- ☐ checkbox (multi-select)
- Name + last-edited date below
- **Environments** column showing multiple pill badges per row (one var can target multiple environments — display all on one row)
- Value (truncated + copy button)
- Visibility column with **labeled type**: `Plain text` / `Sensitive` / `Secret`
- Row kebab

### Add variables form

- "Upload .env" button — bulk import from dotenv file
- Inline form: Name + Value + Visibility dropdown + Delete row
- "+ Add One More Variable" — multi-row entry in one submit
- Environments: checkboxes (var applies to 1-N envs)

### Visibility model (3 tiers)

| Tier       | UI behavior                            | Use case                      |
| ---------- | -------------------------------------- | ----------------------------- |
| Plain text | Value always shown                     | Public config like `API_HOST` |
| Sensitive  | Value masked, revealable on click      | Internal IDs, GA keys         |
| Secret     | Write-only; never displayed after save | API tokens, signing keys      |

## Credentials (`/credentials`)

Single page with Android + iOS sections, each listing the app identifiers in that project.

### List view

Two sections (Android / iOS), each with:

- Section header + platform icon + "Add Application/Bundle Identifier" CTA
- Table: one row per application/bundle identifier (no nested data)
- Row kebab

### Per-identifier detail

#### iOS (`/credentials/ios/<uuid>`)

Header: bundle id + "Delete configuration" (red outlined danger button).

**Build credentials** section with **distribution-type tabs**: App Store · Development · Enterprise · Ad-hoc — each tab keeps its own cert+profile state.

Per tab:

- **Distribution certificate** table: Serial / Developer ID / Team / Status (Valid green pill) / Uploaded at / kebab
- **Provisioning profile** table: Apple UUID / Developer ID / Team / Status / Uploaded at / kebab

**Service credentials** section: cards for

- Push Key (with "Add a Push Key" CTA if empty + explanation "A push key lets an app send push notifications to Apple devices")
- App Store Connect API key (Identifier · Key ID · Team · Roles · Uploaded at + Issuer ID below)

#### Android (`/credentials/android/<package>`)

Header same pattern.

**Build credentials**:

- Subtitle: "Select saved credentials below or create new one"
- **Credential set selector** dropdown ("Build Credentials KcUL0g-liC" + "Default" pill)
- "+ Create New Build Credentials" button
- **Android upload keystore** table: Key alias + Type (JKS) below / MD5 / SHA-1 / SHA-256 / Uploaded at + kebab. Fingerprints truncated as `F8:50...64:B4` with copy button.

**Service credentials**:

- **FCM V1 service account key** empty state with "Add a service account key" CTA + explanation "A service account key for sending Android push notifications"

## Push notifications (`/push-notifications`)

Analytics dashboard. Single chart "Push notifications sent" with date range dropdown (Last 1 Day default). Empty state: "No data available — No push notifications were sent during the selected time period."

## GitHub integration (`/github`)

Pure empty-state page:

- Centered GitHub logo on subtle pattern background
- Headline: "Connect your GitHub account to continue"
- Explanation: "Connecting your GitHub account makes sure you can only use repositories you have access to on GitHub."
- "Get started" CTA

## Global header

Top-of-screen elements (always present):

- **Expo logo** — back to root
- **🔔 Notifications** — dropdown (build events, submissions)
- **🔍 Search** — Cmd+K modal:
  - Two modes via tab: "Search" / "Ask AI"
  - Algolia-powered, shows recent Projects + Expo concepts as suggestions
  - Keyboard hint footer: ↵ select · ↑↓ navigate · tab to switch mode · esc to close
- **Account switcher** (jmango360)
- **Project switcher** (AAF)
- **User menu** (avatar + name → menu)

## Take-aways for better-update

1. **Cmd+K search with AI mode** — adopt a global search that doubles as a docs-aware AI assistant. Algolia DocSearch + a "Ask AI" tab is approachable; even a stub that opens our existing docs RAG is a win.
2. **Per-card Save vs. global Save bar** — Expo uses per-card; better-update should match so partial edits don't risk losing other fields.
3. **Integrations as a Connections card** — Slack, Discord, Sentry, GitHub releases — list with simple Connect/Disconnect rows instead of a separate Integrations page.
4. **3-tier visibility for env vars** (Plain / Sensitive / Secret) — better than a single "secret" boolean. Today we have only `is_secret`; add Sensitive tier for fields like analytics IDs.
5. **Variable can apply to multiple envs** — show as multiple pills on the row, not duplicate rows per env. Saves database rows and visual noise.
6. **Bulk .env import + export** — power-user feature for migration in/out. Already useful; doesn't need to be MVP.
7. **Distribution-type tabs on iOS credentials** (App Store / Dev / Enterprise / Ad-hoc) — keeps unrelated cert/profile pairs from cluttering each other.
8. **Multiple credential sets per Android app** — supports flavored release configs without forcing a new project.
9. **Empty states with explanation + CTA + thematic art** — every page has rich empty states ("A push key lets an app send..."), never bare "No data". Background patterns reinforce the concept (code icons for GitHub, document icons for docs).
10. **Disabled actions show reason inline** — "Builds can only be retried within 180 minutes", "Sentry — Not connected (Connect [disabled because…])". No silent disable.
11. **Danger zone at bottom of settings** — Transfer + Delete grouped, visually de-emphasized but findable.
12. **Card with header CTA + filter row + table** is the repeated content pattern for list pages. Better-update's data-table primitives already follow this; reinforce consistency.
