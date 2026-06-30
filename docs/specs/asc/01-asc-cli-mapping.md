# Mapping App Store Connect into the better-update CLI

A design document for extending `@better-update/cli` toward App Store Connect (ASC) parity. Scope: which ASC capabilities to map onto CLI commands, how they route through `@expo/apple-utils`, the auth/CI constraints that gate each one, and a prioritized roadmap.

> **Provenance.** Produced by a gap analysis of the current CLI (`apps/cli/src/commands/{apple,submit,credentials,builds}` + `lib`/`application` Apple files) against the full `@expo/apple-utils` ≅ `@expo/app-store@2.1.21` surface (104 model classes). Findings verified against `app-store.d.ts`. See the verification addendum at the bottom for residual corrections.

> **Status (2026-06-30): SHIPPED — all six waves implemented on branch `feat/asc-cli-app-store`** (Wave 1 `bb581683`, Wave 2 `51a6ff22`, Wave 3 `bbaf2416`, Waves 4–6 `95dea8d7` + cleanup `7ee586a9`). Each wave was lint-clean, unit-tested, and adversarially reviewed before commit. The deliberate exclusions are noted per-wave in §4 and in §5. This document is retained as the design rationale; the per-wave checklists below record what landed.

---

## 1. Executive summary

**What's already covered.** The CLI owns the _signing + pre-release_ slice of ASC well. Today, behind `apple`, `submit`, `credentials`, `devices`, and `builds`, it does: Apple ID cookie auth (`apple login/whoami/logout`), distribution/development **certificate** issuance + revoke, **provisioning-profile** generate/regenerate, **APNs key** create/revoke, **ASC API key** (.p8) minting, **merchant-id** / Apple-Pay capability, **device** sync, and the post-upload **TestFlight** config inside `submit ios` (What-to-Test, internal beta-group assignment, build processing poll, optional ASC-key auto-create). The `.ipa` binary upload itself is `xcrun altool` (apple-utils has no binary-upload model).

**The size of the gap.** Everything _downstream of TestFlight internal beta_ is missing. There is no App Store **release pipeline** (AppStoreVersion / localization / review submission / phased release / manual release), no App Store **metadata** (AppInfo, categories, age rating, privacy nutrition labels), no **store media** (screenshots/previews), no **pricing & availability**, no **customer-review** responses or App-Review **resolution-center** communication, no **user/seat** administration, and TestFlight itself is shallow (groups matched by name only, never created; no tester management; no external-beta review). The good news: a very large fraction of this is already modeled by apple-utils and is headless-capable.

**The cross-cutting constraint: Token vs cookie.** Every command's feasibility is decided by which `RequestContext` apple-utils needs:

| Path                  | How it's built                                                                                               | Endpoint                                                                | CI-safe?                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| **Token / .p8**       | `ascKeyRequestContext(api, ascApiKeyId)` → `new AppleUtils.Token({ key, keyId, issuerId })` from a vault row | public ASC REST `api.appstoreconnect.apple.com/v1` (`ConnectClientAPI`) | **Yes** — headless, no login                           |
| **Cookie / Apple ID** | `AppleAuth.ensureLoggedIn()` → `auth.buildRequestContext(session)`                                           | Iris `appstoreconnect.apple.com/iris/v1` + developer.apple.com portal   | **No** — TTY + 2FA, `InteractiveProhibitedError` in CI |

The decisive, somewhat surprising finding from the gap analyses: **the great majority of the unbuilt high-value surface is Token/CI-safe.** The hybrid `irisClient` in apple-utils switches host on `ctx.token` — so Users/Invitations, App Store versions/localizations/review submission/phased release, age rating, App Privacy, pricing, store media, customer reviews, AND the entire TestFlight beta model all route to the **public REST API with a stored .p8** and need no Apple login. Cookie-only is a _small_ residue: ASC **API-key minting and listing/revoke** (Iris has no public-REST equivalent), the App-Review **Resolution Center** (explicitly JWT-unsupported), App Clip _creation_, and the portal identifier creates (merchant-id, app-groups, cloud-containers). A separate residue needs a **raw ASC client** apple-utils does not model at all (export-compliance declarations, perf metrics, analytics/sales, webhooks).

**Strategic implication.** Wave 1 can deliver the headline publishing capability — _submit a build for App Store review and release it_ — entirely CI-safe on the existing vault-`.p8` path, reusing `wrapConnect`, the `exits` map, `printHuman*`, and `readSubmitProfile`. No new auth machinery required.

---

## 2. Proposed command-group layout

Naming follows existing conventions: flat domain-named top-level groups (like `devices`, `channels`, `webhooks`), `apple` reserved for Apple-account-scoped/auth-adjacent things, and `credentials` for signing assets. ASC `builds` would collide with the native-artifact `builds` group, so ASC builds live under `apple`.

```
better-update
├── apple                         # Apple-account scoped (auth + ASC account ops)
│   ├── login / whoami / logout            [EXISTS — cookie]
│   ├── builds                              # ASC pre-release builds (Token)
│   │   ├── list · get · status · compliance · whats-new
│   │   ├── add-groups · auto-notify · expire · versions
│   ├── users                               # team/seat admin (Token, Admin key)
│   │   ├── list · get · invite · update · remove
│   ├── invitations  (list · cancel · resend)
│   ├── asc-key                             # upstream ASC API keys (cookie/Iris)
│   │   └── list                            # + `credentials revoke asc-key`
│   ├── sandbox  (list · create · delete · configure · clear-history)   # IAP sandbox
│   └── iap      (list · get)               # read-only IAP inventory (Token)
│
├── testflight                    # full beta lifecycle (ALL Token/CI-safe)
│   ├── group     (list · create · update · delete · add-build)
│   ├── build     (list · status · whats-new · auto-notify · expire)
│   ├── tester    (list · add · import · remove · invite)
│   ├── review    (submit · status · withdraw · set-detail)
│   ├── localization (list · set)
│   └── feedback  (crashes · crash-log · screenshots · delete)
│
├── app-store                     # SINGLE App Store namespace (release + listing/commercial)
│   │  # --- release pipeline (Token/CI-safe) ---
│   ├── submit                               # headline: ReviewSubmission flow
│   ├── version   (list · create · set · attach-build · localize)
│   ├── review    (status · cancel)   ·   reject
│   ├── release                                  # manual release of approved version
│   ├── rollout   (start · pause · resume · complete · stop · status)
│   ├── review-detail (set · attach)
│   ├── config    (push · pull)                 # eas-metadata parity aggregator (renamed from `metadata`)
│   ├── rejection · reply                       # Resolution Center (COOKIE-only)
│   │  # --- app listing + commercial metadata (Token, folded in from `appstore`) ---
│   ├── apps         (list · view · create · update)
│   ├── info         (show · localize · set-categories · age-rating · delete-localization)
│   ├── categories   (list)
│   ├── age-rating   (get · set)
│   ├── privacy      (get · set · clear · publish · categories)
│   ├── pricing      (show · points · set · free)
│   ├── availability (show · set)
│   └── territories  (list)
│
├── metadata                      # store media (Token; AssetAPI native upload)
│   ├── media        (list · sync · download)
│   ├── screenshots  (upload · clear · reorder)
│   └── previews     (upload · set-frame · delete)
│
├── reviews                       # public customer reviews (Token/CI-safe)
│   └── list · get · reply · reply-delete
│
├── app-review                    # Resolution Center w/ Apple (COOKIE-only)
│   └── list · view · reply · rejections · attachments · draft
│
└── credentials                   # EXISTING group, extended
    ├── generate (asc-key · distribution-certificate · provisioning-profile · push-key · merchant-id)   [EXISTS]
    ├── revoke   (distribution-certificate · push-key · asc-key⁺ · provisioning-profile⁺ · merchant-id⁺)
    ├── certificate list⁺ · profile list⁺
    ├── bundle-id (list⁺ · create⁺ · delete⁺ · rename⁺)
    ├── capability (list⁺ · enable⁺ · disable⁺)
    ├── cloud-container / service-id⁺          # niche
    └── regenerate-profile · upload-asc-key · configure   [EXISTS]
```

`⁺` = proposed additions to an existing group.

> **Consolidation note — DECIDED.** The earlier draft split `app-store` (release pipeline) from `appstore` (listing/commercial metadata). **Per maintainer decision, these are merged into a single `app-store` namespace** (shown above): release pipeline + app listing + commercial metadata all live under `app-store …`. The per-domain tables in §3 still use the section headings "Apps & App Info", "Pricing & Availability" etc. for readability, but every command they list now reads `app-store <verb>` (e.g. `app-store info localize`, `app-store pricing show`, `app-store age-rating set`).
>
> **Media group — DECIDED.** Store **media** (screenshots/previews) stays a separate top-level `metadata` group (§3.5) — it has a different shape (declarative directory sync, AssetAPI binary upload) from the rest of `app-store`, so it is not folded into `app-store`. The eas-parity push/pull aggregator was renamed `app-store config` to keep the `metadata` name free for media.

---

## 3. Per-domain capability tables

Priority: **P0** = core missing publishing capability; **P1** = high value, mostly CI-safe; **P2** = useful; **P3/out-of-scope** collapsed. Effort: S/M/L. "In CLI" = yes/partial/no.

### 3.1 App Store Versions & Release flow — _the headline gap_ (all Token/CI-safe unless noted)

| Capability                                                      | apple-utils backing                                                                                             | In CLI | Proposed command                 | Pri    | Eff | Caveat                                                                                                                                                                                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------- | ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Submit build for App Store review (modern flow)                 | `App.createReviewSubmissionAsync` → `ReviewSubmission.addAppStoreVersionToReviewItems` → `submitForReviewAsync` | no     | `app-store submit`               | **P0** | L   | Orchestration-heavy: version+build+localization+review-detail must all be valid. Guard idempotency via `getInProgressReviewSubmissionAsync`. Use ReviewSubmission, **not** deprecated `AppStoreVersionSubmission`. |
| List/inspect App Store versions + state                         | `App.getAppStoreVersionsAsync`, `getEditAppStoreVersionAsync`/`getLiveAppStoreVersionAsync`                     | no     | `app-store version list`         | P1     | S   | Resolve `ascAppId` via `App.findAsync(bundleId)`; reuse `readSubmitProfile`.                                                                                                                                       |
| Create/ensure editable version                                  | `AppStoreVersion.createAsync` / `App.ensureVersionAsync`                                                        | no     | `app-store version create`       | P1     | M   | `versionString` must match build's CFBundleShortVersionString; 409 if edit version exists → prefer ensure semantics.                                                                                               |
| Update release config (type/date/copyright)                     | `AppStoreVersion.updateAsync`                                                                                   | no     | `app-store version set`          | P1     | S   | Mutable only in `PREPARE_FOR_SUBMISSION`; `SCHEDULED` needs `earliestReleaseDate`.                                                                                                                                 |
| Bind uploaded build to version                                  | `AppStoreVersion.updateBuildAsync`                                                                              | no     | `app-store version attach-build` | P1     | S   | Build must be `processingState=VALID`; export-compliance can block. Binary upload stays altool.                                                                                                                    |
| Version localization (What's New/desc/keywords)                 | `AppStoreVersion.createLocalizationAsync` / `AppStoreVersionLocalization.updateAsync`                           | no     | `app-store version localize`     | P1     | M   | This is **AppStoreVersionLocalization**, not TestFlight's BetaBuildLocalization — don't conflate. Long copy via `--from-file`.                                                                                     |
| App Review contact + demo account + notes                       | `AppStoreVersion.createReviewDetailAsync` / `AppStoreReviewDetail.updateAsync`                                  | no     | `app-store review-detail set`    | P2     | S   | `demoAccountPassword` is secret — never echo/log; source from env/vault.                                                                                                                                           |
| Review-submission status                                        | `App.getInProgressReviewSubmissionAsync` / `ReviewSubmission.getReviewSubmissionItemsAsync`                     | no     | `app-store review status`        | P1     | S   | `--watch` polls. Read-only.                                                                                                                                                                                        |
| Cancel in-progress review                                       | `ReviewSubmission.cancelSubmissionAsync`                                                                        | no     | `app-store review cancel`        | P2     | S   | Destructive — confirm.                                                                                                                                                                                             |
| Developer-reject / resolve rejected item                        | `AppStoreVersion.rejectAsync` / `ReviewSubmissionItem.resolveAsync`                                             | no     | `app-store reject`               | P2     | S   | Two underlying paths; detect via `canReject()`.                                                                                                                                                                    |
| Manual release of approved version                              | `AppStoreVersion.createReleaseRequestAsync`                                                                     | no     | `app-store release`              | P1     | S   | Only valid when `PENDING_DEVELOPER_RELEASE`. Pairs with `version set --release-type MANUAL`.                                                                                                                       |
| Phased (staged) rollout start/pause/resume/complete/stop/status | `AppStoreVersion.createPhasedReleaseAsync`; `AppStoreVersionPhasedRelease.pause/resume/complete/deleteAsync`    | no     | `app-store rollout <verb>`       | P1     | M   | High value — mirrors better-update's own staged-rollout model. `complete`=100%; `stop`=delete=full availability. Surface `currentDayNumber`.                                                                       |
| Metadata push/pull from config (`eas metadata` parity)          | `AppStoreVersion.getLocalizationsAsync` + `AppStoreReviewDetail.*`                                              | no     | `app-store config <push\|pull>`  | P2     | L   | Aggregator over granular commands; keep pricing/age-rating/screenshots out. Named `config` (not `metadata`) to avoid colliding with the top-level `metadata` media group.                                          |

**P3 / poor fit:** `review-detail attach` (AssetAPI multi-step), `version reset-ratings` (irreversible, niche), `app-store screenshots` (belongs in `metadata`). **Cookie-only:** `app-store rejection` + `app-store reply` (Resolution Center — see §3.7; `.d.ts` states these are NOT available with JWT auth).

### 3.2 TestFlight / Beta testing — _entire domain is Token/CI-safe_

| Capability                                            | apple-utils backing                                                                                          | In CLI     | Proposed command                                            | Pri    | Eff | Caveat                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------- | ------ | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create a beta group**                               | `BetaGroup.createAsync` / `App.createBetaGroupAsync`                                                         | no         | `testflight group create`                                   | **P0** | M   | Directly closes the submit hard-fail: `applyGroups` errors `TESTFLIGHT_GROUP_NOT_FOUND` today when a configured group doesn't pre-exist. Use `--type` enum + positive `--public-link/--feedback` booleans. |
| List beta groups                                      | `BetaGroup.getAsync` / `App.getBetaGroupsAsync`                                                              | partial    | `testflight group list`                                     | P1     | S   | Already fetched internally by submit; never surfaced.                                                                                                                                                      |
| Update/rename group, public link, limits              | `BetaGroup.updateAsync`                                                                                      | no         | `testflight group update`                                   | P2     | M   | Enabling public link exposes app to anyone with URL — gate.                                                                                                                                                |
| Delete group                                          | `BetaGroup.deleteAsync`                                                                                      | no         | `testflight group delete`                                   | P2     | S   | Destructive (revokes member access) — `--yes`.                                                                                                                                                             |
| Assign build to groups (standalone)                   | `Build.addBetaGroupsAsync`                                                                                   | partial    | `testflight group add-build`                                | P2     | S   | Currently only inside submit. Build must be VALID.                                                                                                                                                         |
| List testers (state/invite type)                      | `BetaTester.getAsync/findAsync`                                                                              | no         | `testflight tester list`                                    | P1     | S   | Read-only.                                                                                                                                                                                                 |
| Add/invite single tester                              | `BetaTester.createAsync` / `BetaGroup.createBetaTesterAsync`                                                 | no         | `testflight tester add`                                     | P1     | S   | Side effect: emails invite. Internal groups need existing ASC users.                                                                                                                                       |
| Bulk-import testers from file                         | `BetaGroup.createBulkBetaTesterAssignmentsAsync`                                                             | no         | `testflight tester import`                                  | P2     | M   | Apple returns per-tester `assignmentResult` — surface PARTIAL success in human + JSON.                                                                                                                     |
| Remove tester (group or account)                      | `BetaTester.deleteAsync` / `deleteBetaGroupsAsync`                                                           | no         | `testflight tester remove`                                  | P2     | S   | Destructive — confirm.                                                                                                                                                                                     |
| Submit build for **external** beta review             | `Build.createBetaAppReviewSubmissionAsync`                                                                   | no         | `testflight review submit`                                  | P1     | M   | The whole missing half of TestFlight. Needs BetaAppReviewDetail + BetaAppLocalization feedbackEmail + What-to-Test + compliance.                                                                           |
| Set beta review detail (contact/demo)                 | `App.updateBetaAppReviewDetailAsync`                                                                         | no         | `testflight review set-detail`                              | P1     | M   | Prereq for external review. Demo creds sensitive — prompt, don't log.                                                                                                                                      |
| Beta-review status / withdraw                         | `Build.getBetaAppReviewSubmissionAsync` / `deleteAsync`                                                      | no         | `testflight review status` / `withdraw`                     | P2     | S   | Withdraw destructive.                                                                                                                                                                                      |
| App-level beta metadata (feedback email etc.)         | `App.createBetaAppLocalizationAsync`                                                                         | no         | `testflight localization set`                               | P2     | M   | feedbackEmail is an external-review prereq.                                                                                                                                                                |
| Set What-to-Test (multi-locale, edit after upload)    | `BetaBuildLocalization.create/updateAsync`                                                                   | partial    | `testflight build whats-new`                                | P2     | S   | Submit does single en-US at upload; add repeatable `--locale` + `--text-file`.                                                                                                                             |
| TestFlight build list / status / expire / auto-notify | `Build.getAsync`, `BuildBetaDetail.*`, `Build.expireAsync`                                                   | partial/no | `testflight build <verb>`                                   | P2–P3  | S   | Read/lifecycle. Expire destructive.                                                                                                                                                                        |
| Tester crash + screenshot feedback, crash logs        | `App.getBetaFeedbackCrashSubmissionsAsync`, `BetaCrashLog.getCrashLogAsync`, `...ScreenshotSubmissionsAsync` | no         | `testflight feedback crashes` / `crash-log` / `screenshots` | P2     | M   | High-value triage. Screenshot download = presigned expiring URL (raw fetch, not AssetAPI). Paginate.                                                                                                       |

**P3 / poor fit:** `tester invite` (resend), `feedback delete`, `capacity`. **Skip:** `build metrics` — `BetaBuildMetric` has **no** apple-utils fetch method (only a type string); needs raw HTTP, breaks the convention, low value.

### 3.3 Apps & App Info / categories / age rating / privacy — _Token/CI-safe via irisClient host-switch_

| Capability                                                      | apple-utils backing                                                   | In CLI  | Proposed command                | Pri | Eff | Caveat                                                                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------- | ------- | ------------------------------- | --- | --- | ------------------------------------------------------------------------------------------------------------------------------- |
| List app records                                                | `App.getAsync`                                                        | no      | `app-store apps list`           | P1  | S   | Pure Token read.                                                                                                                |
| Show store name/subtitle/privacy URLs + categories + age rating | `App.getEditAppInfoAsync` + `AppInfo.getLocalizationsAsync`           | no      | `app-store info show`           | P1  | M   | Pick editable `PREPARE_FOR_SUBMISSION` AppInfo, not live.                                                                       |
| Set store name/subtitle/privacy-policy URL per locale           | `AppInfo.createLocalizationAsync` / `AppInfoLocalization.updateAsync` | no      | `app-store info localize`       | P1  | M   | Where the on-store name + required privacy URL live; submission prereq.                                                         |
| Set primary/secondary categories                                | `AppInfo.updateCategoriesAsync`                                       | no      | `app-store info set-categories` | P1  | M   | Ids from `categories list`; invalid combos rejected.                                                                            |
| List valid category ids                                         | `AppCategory.getAsync`                                                | no      | `app-store categories list`     | P2  | S   | Static reference.                                                                                                               |
| Read age-rating declaration                                     | `AppInfo.getAgeRatingDeclarationAsync`                                | no      | `app-store age-rating get`      | P1  | S   | Relationship moved appStoreVersion→appInfo; `AppStoreVersion.getAgeRatingDeclarationAsync` is deprecated.                       |
| Set age-rating content declaration                              | `AgeRatingDeclaration.updateAsync`                                    | no      | `app-store age-rating set`      | P1  | M   | ~24 props — author via `--from JSON` + a few override flags, not 24 flags. Submission prereq, set-once.                         |
| Read App Privacy nutrition label + publish state                | `App.getAppDataUsagesAsync` / `getAppDataUsagesPublishStateAsync`     | no      | `app-store privacy get`         | P1  | S   | Read-only.                                                                                                                      |
| Declare/apply App Privacy data usages                           | `App.createAppDataUsageAsync` (looped)                                | no      | `app-store privacy set`         | P1  | L   | 35×6×4 matrix — author DECLARATIVELY from `privacy.json`, diff-apply. `DATA_NOT_COLLECTED` exclusive; tracking supersedes IDFA. |
| Publish App Privacy label                                       | `AppDataUsagesPublishState.updateAsync`                               | no      | `app-store privacy publish`     | P1  | S   | Makes label public; submission prereq; no un-publish.                                                                           |
| Clear privacy declarations                                      | `AppDataUsage.deleteAsync`                                            | no      | `app-store privacy clear`       | P2  | S   | Re-publish after or live label is stale.                                                                                        |
| Register app record                                             | `App.createAsync` (cookie in practice)                                | partial | `app-store apps create`         | P1  | M   | **Cookie/Iris** — App Manager role, NOT CI-safe. Promotes existing `ensureAscAppForSubmit`.                                     |
| Update app-level settings                                       | `App.updateAsync`                                                     | no      | `app-store apps update`         | P2  | M   | Keep scope to simple attrs; no legacy pricing here.                                                                             |

**P3 / poor fit:** `info age-rating` per-country full questionnaire, custom product pages, app clips, app groups (cookie/portal), providers list (redundant), privacy `categories` reference, `ratings reset` (destructive/niche). **Do NOT implement:** `app-store idfa` — `IdfaDeclaration` is `@deprecated 1.6` and `usesIdfa` is `never`; superseded by App Privacy `DATA_USED_TO_TRACK_YOU`.

### 3.4 Pricing & Availability — _Token/CI-safe; no Apple login anywhere_

| Capability                     | apple-utils backing                                             | In CLI | Proposed command              | Pri | Eff | Caveat                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------- | ------ | ----------------------------- | --- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read current price schedule    | `App.getPriceScheduleAsync` / `AppPriceSchedule.getForAppAsync` | no     | `app-store pricing show`      | P1  | S   | `null` when never priced → render "no schedule".                                                                                                    |
| Show territory availability    | `App.getAvailableTerritoriesAsync`                              | no     | `app-store availability show` | P1  | S   | ~175 rows — count + `--json` full.                                                                                                                  |
| List app-specific price points | `App.getAppPricePointsAsync`                                    | no     | `app-store pricing points`    | P2  | S   | Use _ForApp_ helper, NOT legacy `AppPricePoint.getAsync` (deprecated iris).                                                                         |
| Set/schedule price             | `App.createPriceScheduleAsync`                                  | no     | `app-store pricing set`       | P2  | M   | **DESTRUCTIVE: createAsync REPLACES whole schedule.** Read-modify-write to preserve other prices. Needs signed Paid Apps Agreement (403 otherwise). |
| Make app free                  | `App.createPriceScheduleAsync` ($0 point)                       | no     | `app-store pricing free`      | P2  | S   | Sugar over `pricing set`.                                                                                                                           |
| Set territory availability     | **NONE** — raw `POST /v2/appAvailabilities`                     | no     | `app-store availability set`  | P2  | M   | No apple-utils model — hand-rolled raw POST (Token bearer). Read-modify-write; removing territory delists.                                          |
| List territories               | `Territory.getAsync`                                            | no     | `app-store territories`       | P3  | S   | Static helper.                                                                                                                                      |

**Do NOT implement:** legacy `AppPriceTier` (dead stub — Apple killed global tiers late 2023). **Out of scope:** pre-orders, custom EULA, unlisted distribution (no models; website tasks).

### 3.5 Store media (screenshots/previews) — _Token/CI-safe; apple-utils DOES expose native binary upload via AssetAPI_

| Capability                                               | apple-utils backing                                                                                                                                       | In CLI | Proposed command                                 | Pri | Eff | Caveat                                                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------ | --- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Declarative directory sync** (fastlane-deliver parity) | `AppStoreVersionLocalization.createAppScreenshotSetAsync` + `AppScreenshotSet.uploadScreenshot` + `reorderScreenshotsAsync` + `AppScreenshot.deleteAsync` | no     | `metadata media sync`                            | P1  | L   | Flagship CLI-shaped surface: `screenshots/<locale>/<device>/*.png`. `--prune` destructive. Couples to edit-version management. Ship `screenshots upload` first. |
| Upload screenshots to a locale/device set                | `AppScreenshotSet.uploadScreenshot` (reserve→PUT→commit→poll internal)                                                                                    | no     | `metadata screenshots upload`                    | P1  | L   | High value, CI-safe. ~30 `ScreenshotDisplayType` with exact pixel rules; needs editable version (find-or-create). `--replace` destructive.                      |
| List/inspect media                                       | `getAppScreenshotSetsAsync` / `getAppPreviewSetsAsync`                                                                                                    | no     | `metadata media list`                            | P2  | M   | Read. Falls back to live version when no edit version.                                                                                                          |
| Upload preview videos                                    | `AppPreviewSet.uploadPreview`                                                                                                                             | no     | `metadata previews upload`                       | P2  | L   | Apple-side transcode wait (minutes); strict `HH:MM:SS:FF` frame time.                                                                                           |
| Clear / delete media                                     | `AppScreenshot.deleteAsync` / `AppPreview.deleteAsync`                                                                                                    | no     | `metadata screenshots clear` / `previews delete` | P2  | M/S | Destructive — `--yes`.                                                                                                                                          |
| Download existing media (seed sync tree)                 | `AppScreenshot.getImageAssetUrl` / `AppPreview.getVideoUrl` + raw fetch                                                                                   | no     | `metadata media download`                        | P3  | M   | Bytes via public mzstatic CDN (raw HTTP).                                                                                                                       |

**P3:** `screenshots reorder`, `previews set-frame`, custom-product-page media.

### 3.6 Customer reviews — _Token/CI-safe_

| Capability                | apple-utils backing                  | In CLI | Proposed command       | Pri | Eff | Caveat                                                                                          |
| ------------------------- | ------------------------------------ | ------ | ---------------------- | --- | --- | ----------------------------------------------------------------------------------------------- |
| List customer reviews     | `App.getCustomerReviewsAsync`        | no     | `reviews list`         | P2  | M   | Filters: rating + territory only; default sort `-createdDate`, includes `response`. Paginate.   |
| Reply to a review         | `CustomerReview.createResponseAsync` | no     | `reviews reply`        | P2  | S   | Publishes publicly; moderation `PENDING_PUBLISH→PUBLISHED`. No update → edit = delete+recreate. |
| Delete developer response | `CustomerReviewResponse.deleteAsync` | no     | `reviews reply-delete` | P3  | S   | Destructive; doubles as "edit" primitive.                                                       |
| View single review        | `CustomerReview.infoAsync`           | no     | `reviews get`          | P3  | S   | Subsumed by list.                                                                               |

### 3.7 App Review communication (Resolution Center) — _COOKIE-ONLY, not CI-safe_

> apple-utils doc-comment on every class here: _"require session auth (Iris API). NOT available with API key (JWT) authentication."_ So `AppleAuth.ensureLoggedIn()` (2FA) is mandatory; degrade gracefully under `InteractiveMode`. Natural close-the-loop companion to `submit ios`.

| Capability                               | apple-utils backing                                       | In CLI | Proposed command         | Pri  | Eff | Caveat                                                                                            |
| ---------------------------------------- | --------------------------------------------------------- | ------ | ------------------------ | ---- | --- | ------------------------------------------------------------------------------------------------- |
| List review threads                      | `App.getResolutionCenterThreadsAsync`                     | no     | `app-review list`        | P1\* | M   | \*P1 within its cookie-only tier. Iris is unstable/undocumented.                                  |
| View thread transcript                   | `ResolutionCenterThread.getResolutionCenterMessagesAsync` | no     | `app-review view`        | P1\* | M   | `messageBody` is full HTML — render plain for humans, raw in JSON.                                |
| Reply to App Review                      | `ResolutionCenterThread.sendReplyAsync`                   | no     | `app-review reply`       | P1\* | M   | Writes to Apple App Review (affects live submission). **TEXT-ONLY** — no attachment-upload model. |
| Show rejection reasons (guideline codes) | `ResolutionCenterThread.fetchRejectionReasonsAsync`       | no     | `app-review rejections`  | P1\* | S   | High signal: `reasonSection`/`reasonCode`/`reasonDescription`.                                    |
| List/download Apple's attachments        | `ResolutionCenterMessageAttachment.getAsync` + raw fetch  | no     | `app-review attachments` | P2   | M   | Inbound only; signed expiring URL.                                                                |

**P3:** `app-review draft` (niche; `reply` already does create-draft-and-send atomically).

### 3.8 Signing credentials & identifiers — _extends existing `credentials`; all Token/CI-safe except App Clip create_

| Capability                                                  | apple-utils backing                                              | In CLI     | Proposed command                             | Pri   | Eff | Caveat                                                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------- | ---------- | -------------------------------------------- | ----- | --- | ------------------------------------------------------------------------------------------------ |
| List certificates + cap usage                               | `Certificate.getAsync`                                           | partial    | `credentials certificate list`               | P1    | S   | Surfaces 2-3 cert cap proactively (today only on limit-recovery).                                |
| List App IDs                                                | `BundleId.getAsync`                                              | no         | `credentials bundle-id list`                 | P1    | S   | Read.                                                                                            |
| Enable App ID capability (push/domains/groups/iCloud/SIWA…) | `BundleId.updateBundleIdCapabilityAsync`                         | partial    | `credentials capability enable`              | P1    | M   | Today only APPLE_PAY reachable. ~70 `CapabilityType` w/ per-type option rules; validate pairing. |
| List/disable capabilities                                   | `getBundleIdCapabilitiesAsync` / `deleteBundleIdCapabilityAsync` | no         | `credentials capability list` / `disable`    | P2    | S   | Disable can break dependent profiles.                                                            |
| List provisioning profiles upstream                         | `Profile.getAsync`                                               | no         | `credentials profile list`                   | P2    | S   | Complements regenerate-profile.                                                                  |
| Propagate device enable/disable/rename to Apple             | `Device.updateAsync`                                             | partial    | `devices … --apple`                          | P2    | M   | Today `devices enable/disable/rename` only mutate the better-update server; Apple status drifts. |
| Create/delete/rename App ID                                 | `BundleId.createAsync/deleteAsync/updateAsync`                   | partial/no | `credentials bundle-id create/delete/rename` | P2–P3 | S   | Auto-created inside profile gen today.                                                           |
| Delete provisioning profile                                 | `Profile.deleteAsync`                                            | no         | `credentials revoke provisioning-profile`    | P3    | S   | Destructive.                                                                                     |

**Cookie-only:** `credentials bundle-id create --app-clip` (`BundleId.createAppClipAsync` — doc says session-auth-only). **P3 niche:** merchant-id list/delete, CloudContainer, Service IDs (SIWA web), Mac/Developer-ID cert types.

### 3.9 ASC API keys & Users / seats

| Capability                           | apple-utils backing                               | In CLI  | Proposed command                       | Pri   | Eff | Caveat                                                                                                    |
| ------------------------------------ | ------------------------------------------------- | ------- | -------------------------------------- | ----- | --- | --------------------------------------------------------------------------------------------------------- |
| Create ASC API key (.p8)             | `ApiKey.createAsync/downloadAsync`                | **yes** | `credentials generate-asc-key`         | P0    | S   | EXISTS. Cookie/Iris only. One-shot download.                                                              |
| List upstream ASC keys               | `ApiKey.getAsync`                                 | partial | `apple asc-key list`                   | P1    | S   | **Cookie/Iris only** — Apple has no public-REST `/apiKeys`. Distinct from local-vault `credentials list`. |
| Revoke ASC key upstream              | `ApiKey.revokeAsync`                              | no      | `credentials revoke asc-key`           | P1    | M   | **Cookie/Iris only.** IRREVERSIBLE; reconcile local vault row. Baseline gap #4.                           |
| List team users/seats                | `User.getAsync`                                   | no      | `apple users list`                     | P1    | M   | **CI-safe via Token** but key MUST carry `UserRole.ADMIN` (else 403).                                     |
| Invite user (roles + app visibility) | `UserInvitation.createAsync`                      | no      | `apple users invite`                   | P1    | M   | CI-safe (Admin key). Emails real invite; can't grant ACCOUNT_HOLDER. High value for onboarding IaC.       |
| Update user roles/visibility         | `User.updateAsync`                                | no      | `apple users update`                   | P2    | M   | Three-state PATCH care; sensitive.                                                                        |
| Remove user                          | `User.deleteAsync`                                | no      | `apple users remove`                   | P2    | S   | Destructive — `--yes`.                                                                                    |
| List/cancel/resend invitations       | `UserInvitation.getAsync/deleteAsync/resendAsync` | no      | `apple invitations list/cancel/resend` | P2–P3 | S   | CI-safe (Admin key).                                                                                      |

**P3:** `apple users get`, `apple actors list` (niche audit).

### 3.10 In-App Purchases & Sandbox

| Capability                                 | apple-utils backing                                       | In CLI | Proposed command                        | Pri   | Eff | Caveat                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------- | ------ | --------------------------------------- | ----- | --- | ------------------------------------------------------------------------------------------------------------ |
| Create sandbox tester                      | `SandboxTester.createAsync`                               | no     | `apple sandbox create`                  | P1    | M   | Lots of PII; Token fast-path may 404 (public serves `/v2`) → realistically cookie.                           |
| List/delete sandbox testers                | `SandboxTester.getAsync/deleteAsync`                      | no     | `apple sandbox list/delete`             | P1/P2 | S   | Same endpoint-parity caveat.                                                                                 |
| List/get IAP products (read-only)          | `App.getInAppPurchasesAsync` / `InAppPurchase.infoAsync`  | no     | `apple iap list/get`                    | P2/P3 | M/S | Modeled relationship is Apple's DEPRECATED v1 `inAppPurchases`. Read-only — no create/update in apple-utils. |
| Sandbox subscription renewal/clear-history | **NONE** — raw `/v2/sandboxTesters` PATCH / clear-history | no     | `apple sandbox configure/clear-history` | P2    | M   | High value for sub testing but unbacked — raw ASC.                                                           |

**Out of scope (no apple-utils, poor CLI fit):** IAP create/pricing/localization/screenshot/submit, the entire **subscriptions** family (groups/prices/offers), offer-code generation (the one decent automation fit, but only after a sub exists). Use ASC web UI.

---

## 4. Consolidated prioritized roadmap (waves)

Each wave is internally shippable; later waves carry progressively worse auth/fit characteristics.

### Wave 1 — Core App Store release pipeline (P0, Token/CI-safe, apple-utils-backed) — ✅ SHIPPED (`bb581683`)

**Why:** turns better-update from "TestFlight internal beta" into "ship to the App Store," entirely on the existing vault-`.p8` path. No new auth.

- `testflight group create` (S–M) — unblocks the current `submit ios` hard-fail (`TESTFLIGHT_GROUP_NOT_FOUND`).
- `app-store version create / set / attach-build / localize` (S–M each) — assemble a releasable version.
- `app-store submit` (L) — the headline: `ReviewSubmission` flow, idempotency-guarded.
- `app-store review status` (S) + `app-store release` (S) + `app-store rollout` (M) — track, manual-release, staged rollout (maps to better-update's own rollout model).

_Rough effort: ~1 L + several S/M. The biggest single piece is `app-store submit` orchestration; everything else reuses `wrapConnect`/`ascKeyRequestContext`/`readSubmitProfile`._

### Wave 2 — TestFlight depth + submission prerequisites (P1, Token/CI-safe) — ✅ SHIPPED (`51a6ff22`)

**Why:** external beta + the metadata Apple _requires before review_ (so Wave 1's submit doesn't bounce).

- `testflight group list / add-build`, `testflight tester list / add / import`, `testflight review submit / set-detail`, `testflight build whats-new`.
- `app-store info localize / set-categories`, `app-store age-rating get/set`, `app-store privacy get/set/publish` (privacy + age-rating authored from `--from JSON`, not flag matrices).
- `app-store review-detail set`, `app-store review cancel`, `app-store reject`.

### Wave 3 — Visibility / read & inventory commands (P1–P2, Token/CI-safe, low effort) — ✅ SHIPPED (`bbaf2416`)

**Why:** cheap, high-leverage "inspect from CI" wins; mostly thin wrappers.

- `apple builds list/get/status/compliance` (export-compliance `--no-uses-encryption` is the #1 CI build-stranding fix), `apple builds whats-new/add-groups`.
- `credentials certificate list`, `credentials bundle-id list`, `credentials profile list`, `credentials capability list/enable`.
- `apple users list/invite` + `app-store apps list`, `app-store pricing show`, `app-store availability show`, `reviews list/reply`.

### Wave 4 — Store media (P1–P2, Token/CI-safe, but L effort) — ✅ SHIPPED (`95dea8d7`)

**Why:** real value (declarative media sync) but large and self-contained; depends on Wave 1's edit-version helpers.

- `metadata screenshots upload` first, then `metadata media sync` (`--prune`, `--dry-run`) and `previews upload`.
- apple-utils provides native AssetAPI binary upload here (unlike the `.ipa`), so no altool-style shell-out — just the display-type/pixel-dimension matrix and processing polls.

_Landed: top-level `metadata` group — `media list/sync`, `screenshots upload/clear`, `previews upload`. `media sync` uses **numeric-aware** filename order, rejects two dirs that resolve to the same device, and scopes `--prune` to locally-present locales. `lib/asc-display-types.ts` resolves `--device` (exact `APP_IPHONE_67` / `IPHONE_67` or alias `iphone-67`). **Deferred (P3):** `metadata media download` (raw mzstatic CDN fetch)._

### Wave 5 — Cookie-only (interactive, degrade-in-CI) flows — ✅ SHIPPED (`95dea8d7`)

**Why:** genuinely useful but gated on Apple ID + 2FA; must return-null/instruct under `InteractiveMode`.

- `apple asc-key list` + `credentials revoke asc-key` (completes the key lifecycle the CLI already half-owns).
- `app-review list / view / reply / rejections` (Resolution Center; text-only) — wire a rejected `submit ios` to print the matching thread id + guideline codes.
- `app-store apps create` standalone, App Clip bundle-id create, sandbox tester create.

_Landed: `app-review list/view/rejections/reply` (threads anchored on `getInProgressReviewSubmissionAsync`, which covers the rejected `UNRESOLVED_ISSUES` state), `apple asc-key list`, `credentials revoke asc-key`, `app-store apps create`, `credentials bundle-id create [--app-clip]`, `apple sandbox list/create/delete`. Cookie session resolution lives in `application/asc-cookie-session.ts` and degrades with `InteractiveProhibitedError` (exit 4) in CI. `reply` posts text-only and rejects an empty body. The `App.createAsync` hint map was made to fire off `error.code` (shared `lib/apple-app-create-error.ts`)._

### Wave 6 — Raw-ASC, niche, or out-of-scope (build on explicit demand only) — ✅ SHIPPED in part (`95dea8d7`)

- **App Encryption Declarations** (`appEncryptionDeclarations`) — the _one_ raw-API capability worth doing (P1 fit): unblocks "Missing Compliance." Prefer injecting `ITSAppUsesNonExemptEncryption` at prebuild for most apps; raw API only for already-uploaded/non-exempt cases.
- `app-store availability set` (raw `POST /v2/appAvailabilities`), sandbox renewal controls (raw `/v2`).
- `app-store config push/pull` aggregator (convenience over Wave 1–2 granular commands).

_Landed: `app-store availability set` (via the **deprecated-but-working** `App.updateAsync({ territories })` rather than a hand-rolled raw `/v2` POST — `--territories` replaces, `--add`/`--remove` read-modify-write, refuses an empty set), `app-store territories list`, and `app-store config pull/push` (per-locale version copy only, as a JSON document). **Not built (build on demand):** the full document-based **App Encryption Declaration** flow — not modeled in apple-utils@2.1.21 (raw-only); the exempt/non-exempt boolean already ships as Wave 3's `apple builds compliance`. Sandbox renewal / clear-history (raw `/v2`) also deferred._

---

## 5. Out of scope / needs raw ASC API

These are **not** modeled by apple-utils and/or conflict with project constraints. Build only on explicit, specific user demand.

| Area                                                                                                        | Why excluded                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Xcode Cloud** (`ciProducts/ciWorkflows/ciBuildRuns/scm*`)                                                 | Hard conflict with the project's "NO remote/hosted build, CI workflow" exclusion — this CLI does _local_ builds. Do not build.                                    |
| **App Store Server API** (`api.storekit.itunes.apple.com` transactions/subscriptions/notifications/refunds) | Runtime IAP/commerce, not publishing. Different host **and** different key type (In-App-Purchase key). Whole separate credential + client.                        |
| **Sales & Finance Reports** (`salesReports`/`financeReports`)                                               | Accounting domain; needs Finance/Sales role + vendor number. Raw gzipped TSV. Dedicated reporting tool's job.                                                     |
| **App Store Connect Analytics Reports** (`analyticsReportRequests`/`analyticsReports`)                      | Async multi-hour request→poll→download CSV workflow; awkward for a CLI; name collides with OTA `analytics` group.                                                 |
| **ASC Webhooks** (`webhooks`/`webhookDeliveries`)                                                           | Token-capable but the _consumer_ is server-side; config-only with no local consumer; overlaps better-update's own `webhooks` group.                               |
| **Power/Performance metrics** (`perfPowerMetrics`/`diagnosticSignatures`)                                   | Raw API, diagnostics not publishing; only populates days post-release; complex Organizer JSON.                                                                    |
| **Marketplace / Alternative distribution (EU DMA)**, **Game Center**, **Nominations/Featuring**             | No apple-utils models; niche operator/game/editorial concerns; heavy or human-curated.                                                                            |
| **IAP create/pricing/localization/submit + subscriptions family**                                           | No apple-utils write models; large, review/media-heavy; poor CLI fit. ASC web UI. (`InAppPurchase` is read-only; `SandboxTester` is the only writable IAP model.) |
| Legacy **`AppPriceTier`** and **`IdfaDeclaration`**                                                         | Dead/deprecated by Apple (tiers removed 2023; IDFA superseded by App Privacy tracking). Do not build.                                                             |

**The single raw-API exception worth pursuing:** **App Encryption Declarations** (Wave 6) — directly unblocks the submit/TestFlight flow the CLI already owns. Everything else here stays on the ASC website.

---

### Cross-cutting implementation reminders (apply to every command above)

- Headless reads/writes take `--asc-key-id` → `ascKeyRequestContext(api, ascApiKeyId)` (Token); cookie writes sit behind `const mode = yield* InteractiveMode; if (!mode.allow) …` and degrade to `null`/instruct, never crash.
- Resolve ids via `readProjectId` / `readSubmitProfile(projectRoot, profile).ios.{ascAppId,ascApiKeyId,bundleIdentifier}`; persist newly resolved ids with `setSubmitProfileAscApiKeyId` / `setSubmitProfileAscAppId`.
- Wrap every apple-utils promise: `wrapConnect("step", () => AppleUtils.X.yAsync(ctx, …))` → tagged `AppleConnectError`; map tags → exit codes in the `runEffect` `exits` option.
- Machine output via `return value` + `json:"value"`; human output via `printHuman*` (silent in JSON). citty: positive booleans + `negativeDescription`, never `--no-*` flags. Gate destructive ops on confirm / `--yes`.
- Per the project's keep-in-sync rule, every new command must land with matching `skills/better-update/` doc updates (SKILL.md + cli.md + topic ref) in the same change.

---

## 6. Verification addendum (corrections from the review pass)

A dedicated verification agent re-checked every `appleUtilsBacking` claim and priority call against `app-store.d.ts`. Net: the tables above are sound; the following residual nuances apply.

- **Resolution Center / review-reply / rejection-reasons are cookie-only — confirmed.** `ResolutionCenterMessage`, `ResolutionCenterDraftMessage`, `ResolutionCenterThread`, and `ReviewRejection` are doc-annotated _"NOT available with API key (JWT) authentication"_ (d.ts:3651-3652, 3680, 3738-3739, 3779-3780). §3.7 and the §3.1 `app-store rejection`/`app-store reply` rows are correctly in the cookie-only tier; do **not** attempt these on a Token key.
- **Screenshots/previews + version-localization metadata ARE Token-capable — confirmed.** `AppScreenshotSet.uploadScreenshot`, `AppPreviewSet.uploadPreview`, `AppStoreVersionLocalization.updateAsync`, `AppStoreReviewDetail`/`AppStoreReviewAttachment` carry no cookie-only marker — they ride the official ASC API + AssetAPI. §3.5 is correct; the earlier "media might be cookie-only" hypothesis is wrong.
- **Export compliance is feasible AND high-value (elevate).** `usesNonExemptEncryption` is part of `BuildProps` and settable via `Build.updateAsync({ attributes })` (d.ts:3858, 3908). The simple exempt/non-exempt boolean does **not** need the raw `appEncryptionDeclarations` API — only the full document-based declaration flow does. Treat `apple builds compliance --no-uses-encryption` as **near-P0** (it is the #1 cause of builds stranded in `MISSING_EXPORT_COMPLIANCE`), and keep raw `AppEncryptionDeclaration` (Wave 6) only for the already-uploaded/non-exempt cases.
- **Territory availability has a legacy apple-utils path too.** §3.4 lists `app-store availability set` as raw `POST /v2/appAvailabilities` (correct for the modern API), but a working **deprecated** path also exists: `App.updateAsync({ territories })` (d.ts:5666-5678, JSDoc at :4967). Acceptable fallback if avoiding a hand-rolled raw POST.
- **Priority re-bucketing (for a publish/build OTA CLI):**
  - _Elevate:_ export-compliance toggle (above) — near-P0.
  - _Demote hard:_ the entire **IAP & Subscriptions** family — almost everything resolves to "NONE — raw ASC API" in apple-utils@2.1.21 and is orthogonal to shipping OTA/native builds. `SandboxTester` is the only writable IAP model.
  - _Demote:_ **customer-review replies** + **Resolution Center** (cookie-only, can't run in CI, orthogonal to publish/build) below the metadata/submission flow.
  - _Demote:_ App Clip, custom product pages, pricing/availability — configure-once niche surfaces, below the real release-loop primitives.
  - _Confirmed-high (the real hot path):_ `AppStoreVersion` create/update + `AppStoreVersionLocalization` (`whatsNew`), `updateBuildAsync`, `ReviewSubmission` submit/cancel, phased release, and `BetaBuildLocalization` + `Build.addBetaGroupsAsync` — all Token/CI-safe.
- **Minor coverage note:** the unified `BetaFeedback` base model (d.ts:6195, returns crash+screenshot feedback in one query) is a convenience superset of the two already-covered feedback submission models; not separately needed.
