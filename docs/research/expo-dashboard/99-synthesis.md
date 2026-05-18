# Expo dashboard → better-update — Update-focused synthesis

Source: https://expo.dev/accounts/jmango/projects/aaf (captured 2026-05-18).

**Scope locked**: chỉ phân tích các pattern xoay quanh **OTA Update** và những entity bổ trợ vòng đời update — Channels, Branches, Runtimes, Fingerprints, Credentials, Environment variables, (Apple) Devices, Internal-distribution builds.

**Excluded** (scope of better-update theo `project-scope-exclusions`):

- Server-side build queue / retry / streaming logs / cancel
- AI-assisted features ("Copy error as prompt", "Ask AI" search)
- Submissions to App Store / Play Store
- CI workflow orchestration
- Web hosting

## Update lifecycle map

```
                          (build time)                          (publish time)              (runtime)
  app source + native config  ──► fingerprint hash ──► binary (Build) ──► Update group ──► loaded by binaries
                                       │                  │                   │                   sharing runtime
                                       │                  │                   │
                                       └──► determines ──►│   targets ───────►│
                                            runtime version                   ▼
                                                                       Channel → Branch
                                                                       (deploy mapping)
```

Mọi entity Expo hiển thị trên dashboard đều là mảnh ghép trong vòng này:

- **Fingerprint** = hash của native config → quyết định runtime version
- **Runtime** = compatibility key giữa build và update
- **Channel** = release lane mà binary subscribe
- **Branch** = chuỗi update đang phục vụ
- **Channel-branch mapping** = "channel X đang serve branch Y"
- **Build** = binary mang fingerprint + runtime cụ thể
- **Internal distribution build / Devices** = cách phân phối build để QA load updates
- **Credentials** = đầu vào để tạo build hợp lệ trên store / TestFlight / Play Internal
- **Env vars** = inject vào build time hoặc runtime, đổi → thường đổi fingerprint

## Top 10 patterns đáng adopt (đã loại AI + remote-build)

### P1. Preview update dialog (QR + Compatible builds + Deep link)

**Found**: Update detail page → "Preview" button góc phải → modal:

- Tóm tắt: Runtime · Published · Platforms
- **QR code** to scan trong dev/internal build → load update ngay
- **Compatible development builds** list (chỉ những build có cùng runtime/fingerprint)
- Update URL (`https://expo.dev/preview/update?…`) + Copy
- Deep link (`exp+aaf://expo-development-client/?url=…`) + Copy

**Apply to better-update**:

- Update detail thiếu hẳn flow này hôm nay. Đây là khoảng cách "QA workflow" lớn nhất.
- Reuse `-install-link-dialog.tsx` (đã có cho build) → mở rộng cho update.
- Compatible builds list: filter `builds where runtimeVersion=update.runtimeVersion AND distribution=internal AND fingerprint matches (nếu có)`.
- Deep link cần CLI agent (dev client) hỗ trợ scheme tương đương `expo-development-client`.

**Effort**: small-medium. **Impact**: huge — tester không cần CLI để thử update.

### P2. Channel-branch mapping diagram + Rollout dialog

**Found**: `/channels/<name>/<runtime>` → card "Channel-branch mapping" trên grid background:

```
[ Channel: preview  ]  ──►  [ Branch: preview                      ]
[ 80 builds         ]        [ Update "2026-04-28 10:15 OTA update" ]
```

Edit button → modal 2 tab:

- **Default**: chọn branch khác để repoint
- **Rollout**: 2 branch với % editable, tự sinh English summary ("100% nhận update trên branch 'preview', 0% trên 'None'"), button "Create Rollout"

**Apply to better-update**:

- DB schema: thêm `channel_branch_rollout` (channel_id, branch_a, percent_a, branch_b, percent_b, runtime_version).
- Update resolution server (CDN edge) đọc rollout config, hash device-id → bucket.
- UI: SVG nhỏ với 1 hoặc 2 arrow + percent badge. Edit dialog dùng coss Dialog + form.
- Bắt buộc cho production-grade OTA → an toàn rollback.

**Effort**: medium-large (cần backend). **Impact**: critical for production users.

### P3. Per-update metrics card

**Found**: Update detail → "Platform-specific updates" table:

| Platform | ID       | Fingerprint | Downloads (?) | Avg size (?) | [sparkline] | Known launches (?) | Known crashes (?) |
| -------- | -------- | ----------- | ------------- | ------------ | ----------- | ------------------ | ----------------- |
| Android  | 019df7bd | 2aaf987     | 14            | 3.99 MiB     | ▁▂▃         | 4                  | 1 (20.00%)        |
| iOS      | 019df7bd | 51716d3     | 34            | 3.6 MiB      | ▂▄▃         | 4                  | 2 (33.33%)        |

Mỗi metric có `?` tooltip giải thích.

**Apply to better-update**:

- **Downloads** + **Avg size**: tính từ CDN/R2 access logs (đã có). Tooltip: "Số lần manifest này được serve cho client".
- **Known launches / crashes**: cần partner SDK. MVP: log launches qua "telemetry" endpoint từ JS bundle wrapper (better-update-cli inject 1 file vào bundle gọi `POST /api/telemetry/launch`).
- **Crashes**: phase 2 — integrate Sentry/NR API hoặc tự nhận crash report.
- Sparkline cho size distribution: tiny — chỉ cần khi có >5 update cùng group, thường skip.

**Effort**: nhỏ cho downloads/size, lớn cho crashes. **Impact**: cao — đây là feedback loop sau publish.

### P4. Runtime as unified hub (`/runtimes/<version>`)

**Found**: 1 trang gom 3 table cho runtime version đó:

1. **Native deployments** — per-channel snapshot: Deployment · Builds count · Channel pill · Branch + current update msg
2. **Builds** — gần đây trên runtime này + "All builds" link
3. **Updates** — gần đây cùng runtime

**Apply to better-update**:

- Route mới: `/projects/$slug/runtimes` (list) + `/projects/$slug/runtimes/$version` (detail).
- View-layer thuần — DB đã có runtimeVersion trên builds + updates.
- Trả lời câu hỏi tự nhiên: "Update này có chạy trên prod app không?" → vào runtime page → xem builds nào dùng nó → bao nhiêu user.
- Gap lớn nhất hiện tại của better-update.

**Effort**: small (chỉ query + render). **Impact**: cao — IA win mạnh.

### P5. Fingerprint transparency + Compare

**Found**: `/fingerprints/<hash>` show:

- **Files** tree contributed to hash (eas.json, .gitignore, ios/, android/, app.json)
- Card cho mỗi config file (e.g. "Expo autolinking config (iOS)") với JSON content + Copy
- "Show skipped sources" toggle
- **Compare** button → paste fingerprint khác → diff view

Trên update + build cũng có link sang fingerprint detail (clickable hash pill).

**Apply to better-update**:

- Lưu fingerprint inputs vào DB khi CLI compute (hash payload + file list + content hash mỗi file).
- Trang `/projects/$slug/fingerprints/$hash`: file tree + JSON contents + Compare.
- Khi user gặp "OTA không load được trên build cũ" → vào Compare 2 fingerprints → thấy ngay file nào khác.
- **Đây là tool debug số 1 cho OTA compatibility** — hiện better-update chỉ có "runtime version mismatch" message mù.

**Effort**: medium (cần CLI gửi inputs lên + UI). **Impact**: cao — giảm support burden.

### P6. Republish + Pause + per-row actions

**Found**:

- Update row kebab: **Republish** · **Delete**
- Channel row kebab: **Pause channel** · **Delete channel**
- Branch row kebab: **Delete**
- Channel detail header: runtime dropdown + kebab

**Apply to better-update**:

- **Republish update**: copy update group sang một thời điểm mới (bump createdAt, mới lại deployment timestamp) — useful sau rollback hoặc fix branch mapping.
- **Pause channel**: distinct verb với Delete. Channel vẫn còn nhưng resolver trả "no update available" → client giữ embedded. Critical cho emergency stop khi update prod gây crash mà chưa kịp rollback hẳn.
- Khác Delete: Pause reversible.

**Effort**: small backend (status field on channel + resolver check). **Impact**: cao — production safety net.

### P7. Compare action everywhere

**Found**: Trên build / update / fingerprint đều có **Compare** button — nhận ID hoặc URL của entity cùng loại → diff view.

**Apply to better-update**:

- Bắt đầu với **Compare 2 updates**: diff asset list, JS bundle size delta, launchAsset hash, channel, branch, fingerprint, runtime version. Useful cho QA review trước promote.
- Compare 2 fingerprints (P5).
- Compare 2 builds: chỉ cần khi có nhiều build cùng runtime — phase 2.

**Effort**: small (mở dialog + render diff table). **Impact**: medium — tăng confidence khi promote update giữa branch.

### P8. Credentials: distribution tabs + multiple credential sets + service creds

**Found**:

- **iOS** credential per bundle id có tabs **App Store · Development · Enterprise · Ad-hoc** — mỗi tab lưu cert + provisioning profile riêng.
- **Android** credential per package id có **credential set selector** (dropdown chọn nhiều bộ build credentials, 1 default).
- Service credentials tách riêng: Push Key, ASC API key (iOS); FCM V1 service account (Android).
- "Delete configuration" danger button góc phải.

**Apply to better-update**:

- Hiện tại better-update có `-credentials-tables.tsx` ở org-level. Project-level credential cho từng bundle id chưa rõ structure.
- Recommend: schema `BuildCredentialSet { id, app_identifier, distribution_type, default: bool, cert_id, profile_id }`. UI per app id có tabs phân biệt distribution.
- Service creds (push key, ASC, FCM) lưu cùng app id, hiển thị section "Service credentials" rời với "Add" CTA khi empty.

**Effort**: medium-large (schema migration). **Impact**: cao cho user có nhiều flavor (staging/prod/enterprise).

### P9. Environment variables: 3-tier visibility + multi-env per row + .env import

**Found**:

- Visibility: **Plain text** / **Sensitive** (masked, revealable) / **Secret** (write-only, never shown sau save).
- 1 variable target nhiều env (production + preview + development) → multiple pills trên 1 row.
- "Upload .env" bulk import.
- Filters: Environment + Scope (Project/Account level) + search.
- Bulk Edit/Delete khi multi-select.

**Apply to better-update**:

- Schema hiện tại trong `environment-variables/-env-vars-view.tsx` cần check tier visibility. Nếu chỉ binary `is_secret` → add `Sensitive` tier.
- Multi-env per row: store `environments: string[]` array (not 1 row per env). UI: comma-separated pill cluster.
- .env import: parse dotenv file → array of `{name, value, environments[], visibility}` → bulk POST.
- "Scope" filter: account-level (chia sẻ giữa projects) vs project-level. Useful cho team shared secrets.

**Effort**: medium (schema + UI). **Impact**: medium — quality-of-life cho user nhiều env.

### P10. Internal distribution builds + Devices flow

**Found**:

- `/development-builds` = filtered view của builds (chỉ internal distribution), thêm columns **Simulator** ✓ / **Device** ✓.
- iOS internal distribution build có columns này quan trọng vì simulator build ≠ device build (kiến trúc khác).
- Devices ở Expo quản lý qua Apple Developer Portal API — không phải dashboard riêng.

**Apply to better-update**:

- better-update có `apple-devices/` route riêng (org-level, invite flow) — đó là differentiator.
- Add view `/projects/$slug/builds?distribution=internal` hoặc `/projects/$slug/development-builds` để tester tìm nhanh internal builds.
- Cột phụ: Simulator/Device cho iOS. Helps tester chọn đúng artifact.
- Per-build "Compatible updates" link (đối ứng của P1 từ phía build): build detail → list updates cùng runtime → preview/install.

**Effort**: small (filter + cột). **Impact**: medium — QA convenience.

## Cross-cutting UX patterns (apply broadly)

1. **Clickable metadata pills** — channel pill → channel page, fingerprint → FP detail, runtime → runtime hub, branch → branch page. Mọi entity reference phải clickable.
2. **Horizontal metadata table** trên detail header (Profile · Env · Deployment · Version · Fingerprint · Commit · Created by trong 1 row, mỗi cell có Copy hoặc link).
3. **Help icon `?` tooltips** trên column headers metric (Downloads / Crashes / Queue time / Availability / Avg size) — định nghĩa nơi data sống, không tách docs page.
4. **Disabled action reason inline** — ví dụ Expo: "Retry — Builds can only be retried within 180 minutes from completion". Mỗi disabled button/menuitem phải show why dưới label, không phải tooltip.
5. **Status pills 4-state**: success green / error red / warning yellow / neutral grey + extra text tag ("Expired", "Active", "Paused"). Đồng bộ across mọi entity.
6. **Thematic empty states**: GitHub logo trên code-pattern bg, push key empty với muted icon + 1-line explain + CTA. Không bao giờ bare "No data".
7. **Sub-sidebar on detail pages** — Update group detail có sub-nav "Overview / Android / iOS" để drill per-platform mà không cần modal.
8. **Row kebab as standard action surface** — Republish/Delete (update), Pause/Delete (channel), Delete (branch). Không inline 3 button ở mỗi row.
9. **Per-card Save** (không global save bar) — partial edit không risk mất field khác.
10. **Search by ID** modal — "Find update by ID" top-right button trên list — UUID search dedicated, không nhét vào filter bar chung.

## Concrete next steps for better-update (Updates-focus, priority order)

| Priority | Item                                                                | Type        | Effort | Notes                                                                |
| -------- | ------------------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------- |
| P0       | **Preview update dialog với QR + compatible builds + deep links**   | new feature | S-M    | Mở rộng `-install-link-dialog.tsx`; biggest QA workflow win          |
| P0       | **Pause channel** action + resolver respect status                  | new feature | S      | Production safety; backend status field                              |
| P0       | **`/runtimes/$version` unified hub page**                           | new page    | S      | View-layer, DB đã đủ data                                            |
| P1       | **Channel-branch Rollout (percent split)**                          | new feature | M-L    | Cần backend resolver thay đổi; visual mapping diagram dùng SVG       |
| P1       | **Compare 2 updates** dialog                                        | new feature | S      | Đặt next to Republish trên update row kebab                          |
| P1       | **Republish update** action                                         | new feature | S      | Bump createdAt sang update mới reference cùng assets                 |
| P1       | **Per-update Downloads + Avg size** từ CDN logs                     | new feature | S      | Đã có data, chỉ cần aggregation                                      |
| P1       | **Disabled-action inline reason audit**                             | polish      | S      | Sweep current dashboard, thêm reason text dưới mỗi disabled menuitem |
| P2       | **Fingerprint detail + Compare**                                    | new page    | M      | Cần CLI gửi fingerprint inputs lên DB                                |
| P2       | **Env vars: thêm Sensitive tier + multi-env per row + .env import** | enhancement | M      | Schema migration nhẹ                                                 |
| P2       | **iOS credentials: tabs theo distribution type**                    | enhancement | M      | Re-org existing credentials table                                    |
| P2       | **Android credentials: multiple credential sets per app id**        | enhancement | M      | Schema migration                                                     |
| P3       | **Internal distribution builds filtered view + Sim/Device columns** | enhancement | S      | Filter on existing builds page                                       |
| P3       | **Per-update launches/crashes** (cần telemetry SDK hoặc partner)    | new feature | L      | Phase 2, sau khi launches/sessions có data nguồn                     |
| P3       | **Sub-sidebar Overview/Android/iOS** trên update detail             | enhancement | M      | Khi đã có per-platform assets table                                  |

## Screenshot index

Tất cả ở `./screenshots/`:

**Updates flow** (core focus):

- [`04-updates-list.png`](./screenshots/04-updates-list.png) · [`04b-updates-info.png`](./screenshots/04b-updates-info.png) — Update groups list
- [`05-update-detail.png`](./screenshots/05-update-detail.png) — Update group detail (metadata, per-platform metrics, deployments)
- [`05b-preview-dialog.png`](./screenshots/05b-preview-dialog.png) — **Preview update dialog với QR** (P1)

**Channels / Branches / Rollout**:

- [`06-channels.png`](./screenshots/06-channels.png) · [`06b-channel-detail.png`](./screenshots/06b-channel-detail.png) · [`06c-channel-detail-table.png`](./screenshots/06c-channel-detail-table.png) · [`06d-channel-full.png`](./screenshots/06d-channel-full.png) — Channels
- [`09-deployment.png`](./screenshots/09-deployment.png) · [`09b-channel-branch-mapping.png`](./screenshots/09b-channel-branch-mapping.png) · [`09c-channel-branch-vis.png`](./screenshots/09c-channel-branch-vis.png) — Mapping diagram
- [`09d-rollout.png`](./screenshots/09d-rollout.png) — **Rollout config modal** (P2)
- [`07-branches.png`](./screenshots/07-branches.png) — Branches

**Runtimes / Fingerprints**:

- [`08-runtimes.png`](./screenshots/08-runtimes.png) · [`08b-runtime-detail.png`](./screenshots/08b-runtime-detail.png) — **Runtime unified hub** (P4)
- [`12-fingerprint-detail.png`](./screenshots/12-fingerprint-detail.png) · [`12b-fingerprint-detail.png`](./screenshots/12b-fingerprint-detail.png) — **Fingerprint sources + Compare** (P5)

**Credentials**:

- [`15-credentials.png`](./screenshots/15-credentials.png) — List (Android + iOS sections)
- [`15b-credentials-ios-detail.png`](./screenshots/15b-credentials-ios-detail.png) · [`15c-credentials-services.png`](./screenshots/15c-credentials-services.png) · [`15d-credentials-full.png`](./screenshots/15d-credentials-full.png) — iOS detail với distribution tabs
- [`15e-android-creds.png`](./screenshots/15e-android-creds.png) — Android detail với multiple cred sets

**Environment variables**:

- [`16-env-vars.png`](./screenshots/16-env-vars.png) — Table với multi-env pills + visibility tiers
- [`16b-env-new.png`](./screenshots/16b-env-new.png) — Add form với "Upload .env" + visibility dropdown

**Internal builds / Devices**:

- [`14-dev-builds.png`](./screenshots/14-dev-builds.png) — Development builds filtered view với Sim/Device cols

**Notes files** (cùng folder):

- [`00-notes.md`](./00-notes.md) — IA map
- [`04-updates-findings.md`](./04-updates-findings.md) — Updates deep-dive
- [`05-settings-env-credentials-findings.md`](./05-settings-env-credentials-findings.md) — Settings/env/creds
- `99-synthesis.md` — file này
