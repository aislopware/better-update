#!/usr/bin/env bun
/**
 * Seed the LOCAL dev D1 database with diverse fake data for UI testing.
 *
 * Writes directly to the wrangler-managed SQLite file (same discovery as
 * `db-codegen.ts`, picking the most recently modified database when several
 * exist). Every organization in the database gets the full dataset, so it
 * works no matter which account you are logged in with.
 *
 * Idempotent: every seeded row id starts with `seed-`, and the script deletes
 * all previously seeded rows (child tables first) before re-inserting.
 *
 * Never run against production — this is a local-only convenience.
 */
import { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { resolve } from "node:path";

import { Glob } from "bun";

const serverRoot = resolve(import.meta.dir, "..");
const d1StateDir = resolve(serverRoot, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");

const dataFiles = [...new Glob("*.sqlite").scanSync(d1StateDir)].filter(
  (file) => file !== "metadata.sqlite",
);

if (dataFiles.length === 0) {
  console.error(`No local D1 SQLite file found in ${d1StateDir}. Run \`bun run d1:migrate\`.`);
  process.exit(1);
}

// The live database is the one the dev server keeps writing to.
const databasePath = dataFiles
  .map((file) => resolve(d1StateDir, file))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;

console.log(`Seeding ${databasePath}`);

const db = new Database(databasePath);
db.exec("PRAGMA foreign_keys = ON;");

// ---------------------------------------------------------------------------
// Deterministic PRNG so reseeding produces the same data.
// ---------------------------------------------------------------------------

let prngState = 0x9e3779b9;
const rand = (): number => {
  prngState ^= prngState << 13;
  prngState ^= prngState >>> 17;
  prngState ^= prngState << 5;
  prngState >>>= 0;
  return prngState / 0xffffffff;
};
const pick = <Item>(items: readonly Item[]): Item => items[Math.floor(rand() * items.length)]!;
const hex = (length: number): string =>
  Array.from({ length }, () => "0123456789abcdef"[Math.floor(rand() * 16)]).join("");
/** Random base64 blob — stands in for E2E ciphertexts the web UI never decrypts. */
const fakeBlob = (bytes: number): string => Buffer.from(hex(bytes * 2), "hex").toString("base64");
const uuid = (): string => `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;

const NOW = Date.now();
const DAY = 86_400_000;
const daysAgo = (days: number): string => new Date(NOW - days * DAY).toISOString();
/** Random timestamp within the last `maxDays` days (fractional day precision). */
const spread = (maxDays: number): string => daysAgo(rand() * maxDays);

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

const insert = (table: string, row: Record<string, string | number | null>): void => {
  const keys = Object.keys(row);
  const placeholders = keys.map(() => "?").join(", ");
  db.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`).run(
    ...keys.map((key) => row[key]!),
  );
};

// Wipe previously seeded rows, child tables first.
const wipeStatements = [
  "DELETE FROM project_credential_binding WHERE id LIKE 'seed-%'",
  "DELETE FROM ios_bundle_configurations WHERE id LIKE 'seed-%'",
  "DELETE FROM ios_app_metadata WHERE id LIKE 'seed-%'",
  "DELETE FROM android_build_credentials WHERE id LIKE 'seed-%'",
  "DELETE FROM android_application_identifiers WHERE id LIKE 'seed-%'",
  "DELETE FROM apple_provisioning_profiles WHERE id LIKE 'seed-%'",
  "DELETE FROM apple_distribution_certificates WHERE id LIKE 'seed-%'",
  "DELETE FROM apple_push_keys WHERE id LIKE 'seed-%'",
  "DELETE FROM asc_api_keys WHERE id LIKE 'seed-%'",
  "DELETE FROM android_upload_keystores WHERE id LIKE 'seed-%'",
  "DELETE FROM google_service_account_keys WHERE id LIKE 'seed-%'",
  "DELETE FROM env_var_revisions WHERE id LIKE 'seed-%'",
  "DELETE FROM env_vars WHERE id LIKE 'seed-%'",
  "DELETE FROM env_var_descriptions WHERE id LIKE 'seed-%'",
  "DELETE FROM user_encryption_keys WHERE id LIKE 'seed-%'",
  "DELETE FROM update_assets WHERE update_id LIKE 'seed-%'",
  "DELETE FROM assets WHERE r2_key LIKE 'seed/%'",
  "DELETE FROM updates WHERE id LIKE 'seed-%'",
  "DELETE FROM build_artifacts WHERE build_id LIKE 'seed-%'",
  "DELETE FROM submissions WHERE id LIKE 'seed-%'",
  "DELETE FROM builds WHERE id LIKE 'seed-%'",
  "DELETE FROM channels WHERE id LIKE 'seed-%'",
  "DELETE FROM branches WHERE id LIKE 'seed-%'",
  "DELETE FROM devices WHERE id LIKE 'seed-%'",
  "DELETE FROM apple_teams WHERE id LIKE 'seed-%'",
  "DELETE FROM audit_logs WHERE id LIKE 'seed-%'",
  "DELETE FROM robot_account WHERE id LIKE 'seed-%'",
  "DELETE FROM webhooks WHERE id LIKE 'seed-%'",
  "DELETE FROM invitation WHERE id LIKE 'seed-%'",
  "DELETE FROM project_member WHERE id LIKE 'seed-%'",
  "DELETE FROM member WHERE id LIKE 'seed-%'",
  "DELETE FROM user WHERE id LIKE 'seed-%'",
  "DELETE FROM environments WHERE id LIKE 'seed-%'",
  "DELETE FROM projects WHERE id LIKE 'seed-%'",
];

// ---------------------------------------------------------------------------
// Shared vocabulary.
// ---------------------------------------------------------------------------

const teammates = [
  { id: "seed-user-1", name: "An Nguyen", email: "an.nguyen@example.com", role: "admin" },
  { id: "seed-user-2", name: "Bella Tran", email: "bella.tran@example.com", role: "member" },
  { id: "seed-user-3", name: "Chris Park", email: "chris.park@example.com", role: "member" },
  { id: "seed-user-4", name: "Diego Lopez", email: "diego.lopez@example.com", role: "member" },
  { id: "seed-user-5", name: "Emma Watson", email: "emma.w@example.com", role: "member" },
];

const runtimeVersions = ["1.0.0", "1.1.0", "1.2.0", "2.0.0"];
const messages = [
  "Fix crash when opening cart with expired session",
  "Add dark mode support to settings screen",
  "Improve image caching on product pages",
  "Bump react-native to 0.79",
  "Rework onboarding carousel animations",
  "Fix Android back-gesture on modal screens",
  "Localize checkout flow (vi, nl, de)",
  "Reduce bundle size by lazy-loading barcode scanner",
  "Fix push-notification deep links",
  "Add Apple Pay support behind feature flag",
  "Patch hermes OOM on low-end devices",
  "Refresh empty states and skeleton loaders",
];

// ---------------------------------------------------------------------------
// Per-organization seeding.
// ---------------------------------------------------------------------------

interface OrgRow {
  id: string;
  slug: string;
}

const seedOrg = (org: OrgRow, orgIndex: number): void => {
  const sid = (name: string): string => `seed-o${orgIndex}-${name}`;

  const ownerRow = db
    .query<{ user_id: string; email: string }, [string]>(
      `SELECT member.user_id AS user_id, user.email AS email
       FROM member JOIN user ON user.id = member.user_id
       WHERE member.organization_id = ?
       ORDER BY CASE member.role WHEN 'owner' THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .get(org.id);
  if (!ownerRow) {
    console.warn(`Skipping org ${org.slug}: no members.`);
    return;
  }
  const OWNER = ownerRow.user_id;

  // Teammates become members of every org (+ two pending invitations).
  for (const [index, teammate] of teammates.entries()) {
    insert("member", {
      id: sid(`member-${index + 1}`),
      organization_id: org.id,
      user_id: teammate.id,
      role: teammate.role,
      created_at: daysAgo(120 - index * 14),
    });
  }
  for (const [index, email] of ["frank.miller@example.com", "grace.hopper@example.com"].entries()) {
    insert("invitation", {
      id: sid(`invite-${index + 1}`),
      organization_id: org.id,
      email,
      role: "member",
      status: "pending",
      inviter_id: OWNER,
      created_at: daysAgo(3 + index * 2),
      expires_at: daysAgo(-4 + index),
    });
  }

  // Projects: two active, one archived — each with builtin branches/channels.
  const extraProjects = [
    { key: "storefront", name: "Storefront iOS", slug: "storefront-ios", archived: false },
    { key: "scanner", name: "Warehouse Scanner", slug: "warehouse-scanner", archived: false },
    { key: "kiosk", name: "Legacy Kiosk", slug: "legacy-kiosk", archived: true },
  ];
  for (const [index, project] of extraProjects.entries()) {
    const createdAt = daysAgo(200 - index * 30);
    insert("projects", {
      id: sid(`proj-${project.key}`),
      organization_id: org.id,
      name: project.name,
      slug: project.slug,
      created_at: createdAt,
      last_activity_at: project.archived ? daysAgo(150) : spread(10),
      archived_at: project.archived ? daysAgo(90) : null,
    });
    for (const environment of ["development", "preview", "production"]) {
      const branchId = sid(`branch-${project.key}-${environment}`);
      insert("branches", {
        id: branchId,
        project_id: sid(`proj-${project.key}`),
        name: environment,
        is_builtin: 1,
        created_at: createdAt,
      });
      insert("channels", {
        id: sid(`channel-${project.key}-${environment}`),
        project_id: sid(`proj-${project.key}`),
        branch_id: branchId,
        name: environment,
        is_builtin: 1,
        created_at: createdAt,
      });
    }
  }

  // Anchor project for the data-heavy tables: the org's most recently active
  // real project when it has builtin branches, otherwise the seeded storefront.
  const existingAnchor = db
    .query<{ id: string }, [string]>(
      `SELECT projects.id AS id FROM projects
       WHERE organization_id = ? AND id NOT LIKE 'seed-%' AND archived_at IS NULL
         AND EXISTS (
           SELECT 1 FROM branches
           WHERE branches.project_id = projects.id AND branches.is_builtin = 1
         )
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(org.id);
  const ANCHOR = existingAnchor?.id ?? sid("proj-storefront");
  const anchorBranches = db
    .query<{ id: string; name: string }, [string]>(
      "SELECT id, name FROM branches WHERE project_id = ? AND is_builtin = 1",
    )
    .all(ANCHOR);
  const branchByName = new Map(anchorBranches.map((branch) => [branch.name, branch.id]));

  // Feature branches + extra channels (one rollout, one paused) on the anchor.
  const featureBranches = [
    { id: sid("branch-checkout"), name: "feature/new-checkout" },
    { id: sid("branch-hotfix"), name: "hotfix/crash-on-launch" },
  ];
  for (const branch of featureBranches) {
    insert("branches", {
      id: branch.id,
      project_id: ANCHOR,
      name: branch.name,
      is_builtin: 0,
      created_at: spread(40),
    });
  }

  const rolloutMapping = JSON.stringify({
    data: [
      {
        branchId: sid("branch-checkout"),
        branchMappingLogic: {
          clientKey: "rolloutToken",
          branchMappingOperator: "hash_lt",
          operand: 0.25,
        },
      },
      { branchId: branchByName.get("production"), branchMappingLogic: true },
    ],
  });
  insert("channels", {
    id: sid("channel-beta"),
    project_id: ANCHOR,
    branch_id: sid("branch-checkout"),
    name: "beta",
    is_builtin: 0,
    branch_mapping_json: rolloutMapping,
    created_at: daysAgo(30),
  });
  insert("channels", {
    id: sid("channel-canary"),
    project_id: ANCHOR,
    branch_id: sid("branch-hotfix"),
    name: "canary",
    is_builtin: 0,
    is_paused: 1,
    created_at: daysAgo(20),
  });

  // Updates: ~65 groups on the anchor across branches/platforms/runtimes.
  const anchorBranchIds = [
    ...anchorBranches.map((branch) => branch.id),
    ...featureBranches.map((branch) => branch.id),
  ];
  const environmentByBranch = new Map<string, string>([
    ...anchorBranches.map((branch): [string, string] => [branch.id, branch.name]),
    [sid("branch-checkout"), "development"],
    [sid("branch-hotfix"), "production"],
  ]);

  const updateIds: { id: string; createdAt: string }[] = [];
  for (let group = 0; group < 65; group += 1) {
    const groupId = sid(`group-${group}`);
    const branchId = pick(anchorBranchIds);
    const createdAt = spread(120);
    const runtimeVersion = pick(runtimeVersions);
    const message = pick(messages);
    const gitCommit = hex(40);
    const fingerprint = rand() < 0.5 ? hex(64) : null;
    const isRollback = rand() < 0.06 ? 1 : 0;
    const rollout = rand() < 0.12 ? pick([25, 50, 75]) : 100;
    const platforms = rand() < 0.15 ? [pick(["ios", "android"])] : ["ios", "android"];
    for (const platform of platforms) {
      const id = sid(`update-${group}-${platform}`);
      insert("updates", {
        id,
        group_id: groupId,
        branch_id: branchId,
        platform,
        runtime_version: runtimeVersion,
        message,
        created_at: createdAt,
        git_commit: gitCommit,
        git_dirty: rand() < 0.1 ? 1 : 0,
        fingerprint_hash: fingerprint,
        is_rollback: isRollback,
        rollout_percentage: rollout,
        extra_json: JSON.stringify({
          environment: environmentByBranch.get(branchId) ?? "development",
        }),
      });
      updateIds.push({ id, createdAt });
    }
  }

  // Assets for the 8 most recent updates so detail pages show real sizes.
  const recentUpdates = [...updateIds]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);
  for (const update of recentUpdates) {
    const assetSpecs = [
      { key: "bundles/main.hbc", ext: "hbc", type: "application/octet-stream", launch: 1 },
      { key: "assets/logo.png", ext: "png", type: "image/png", launch: 0 },
      { key: "assets/fonts/Inter.ttf", ext: "ttf", type: "font/ttf", launch: 0 },
    ];
    for (const spec of assetSpecs) {
      const assetHash = hex(64);
      insert("assets", {
        hash: assetHash,
        r2_key: `seed/assets/${assetHash}`,
        content_type: spec.type,
        file_ext: spec.ext,
        byte_size: Math.floor(rand() * 3_500_000) + 150_000,
        created_at: update.createdAt,
      });
      insert("update_assets", {
        update_id: update.id,
        asset_hash: assetHash,
        asset_key: spec.key,
        is_launch: spec.launch,
      });
    }
  }

  // Builds: 45 on the anchor + 5 on Storefront, artifacts on a subset.
  const iosDistributions = ["app-store", "ad-hoc", "development", "enterprise", "simulator"];
  const androidDistributions = ["play-store", "direct", "development"];
  const profiles = ["production", "preview", "development"];
  const appVersions = ["1.4.0", "1.5.0", "1.5.1", "2.0.0", "2.1.0"];

  for (let index = 0; index < 50; index += 1) {
    const projectId = index < 45 ? ANCHOR : sid("proj-storefront");
    const platform = pick(["ios", "android"]);
    const distribution = platform === "ios" ? pick(iosDistributions) : pick(androidDistributions);
    const id = sid(`build-${index}`);
    const createdAt = spread(90);
    insert("builds", {
      id,
      project_id: projectId,
      platform,
      distribution,
      profile: pick(profiles),
      app_version: pick(appVersions),
      build_number: String(100 + index),
      bundle_id: platform === "ios" ? "com.example.demoapp" : "com.example.demoapp.android",
      runtime_version: pick(runtimeVersions),
      git_commit: hex(40),
      git_ref: pick(["main", "release/2.0", "develop"]),
      git_dirty: rand() < 0.08 ? 1 : 0,
      message: pick(messages),
      fingerprint_hash: rand() < 0.5 ? hex(64) : null,
      created_at: createdAt,
    });
    if (index % 3 === 0) {
      insert("build_artifacts", {
        build_id: id,
        format: platform === "ios" ? "ipa" : "aab",
        byte_size: Math.floor(rand() * 60_000_000) + 20_000_000,
        sha256: hex(64),
        r2_key: `seed/artifacts/${id}.${platform === "ios" ? "ipa" : "aab"}`,
        created_at: createdAt,
      });
    }
  }

  // Submissions: success ledger rows on the anchor. `submission_config` must be
  // the full per-platform shape — the API mapper rebuilds a Schema.Class from it
  // and missing fields fail response decoding (500 on the list endpoint).
  const iosSubmissionConfig = JSON.stringify({
    appleId: null,
    ascAppId: String(1_000_000_000 + Math.floor(rand() * 1e9)),
    appleTeamId: `AB12CD34E${orgIndex}`,
    sku: "DEMOAPP1",
    language: "en-US",
    companyName: "Example Corp",
    appName: "Demo App",
    bundleIdentifier: "com.example.demoapp",
    ascApiKeyId: sid("asc-key-1"),
    groups: ["Internal Testers"],
    whatToTest: "Checkout flow and dark mode.",
  });
  const androidSubmissionConfig = JSON.stringify({
    applicationId: "com.example.demoapp",
    track: "production",
    releaseStatus: "completed",
    changesNotSentForReview: false,
    rollout: null,
    googleServiceAccountKeyId: sid("gsa-key-1"),
  });
  for (let index = 0; index < 7; index += 1) {
    const platform = index % 2 === 0 ? "ios" : "android";
    insert("submissions", {
      id: sid(`submission-${index}`),
      organization_id: org.id,
      project_id: ANCHOR,
      platform,
      archive_source: "build",
      build_id: sid(`build-${index}`),
      build_version: String(100 + index),
      profile_name: "production",
      submission_config: platform === "ios" ? iosSubmissionConfig : androidSubmissionConfig,
      metadata_complete: index === 0 ? 0 : 1,
      initiating_user_id: OWNER,
      created_at: spread(60),
    });
  }

  // Apple teams + devices (FTS kept in sync by triggers).
  const teams = [
    {
      id: sid("team-1"),
      appleTeamId: `AB12CD34E${orgIndex}`,
      name: "JMango360 B.V.",
      type: "COMPANY_ORGANIZATION",
    },
    {
      id: sid("team-2"),
      appleTeamId: `ZY98XW76V${orgIndex}`,
      name: "Cong Tran",
      type: "INDIVIDUAL",
    },
  ];
  for (const team of teams) {
    insert("apple_teams", {
      id: team.id,
      organization_id: org.id,
      apple_team_id: team.appleTeamId,
      apple_team_type: team.type,
      name: team.name,
      created_at: daysAgo(180),
    });
  }

  const deviceSpecs = [
    {
      class: "IPHONE",
      count: 12,
      models: ["iPhone 15 Pro", "iPhone 14", "iPhone 16 Pro Max", "iPhone SE (3rd gen)"],
    },
    {
      class: "IPAD",
      count: 6,
      models: ["iPad Pro 13-inch (M4)", "iPad Air 11-inch", "iPad mini (6th gen)"],
    },
    {
      class: "MAC",
      count: 4,
      models: ["MacBook Pro 16-inch", "Mac Studio", "MacBook Air 13-inch"],
    },
    { class: "UNKNOWN", count: 2, models: [null] },
  ];
  const ownerNames = ["An", "Bella", "Chris", "Diego", "Emma", "QA", "Design", "Office"];
  let deviceIndex = 0;
  for (const spec of deviceSpecs) {
    for (let index = 0; index < spec.count; index += 1) {
      deviceIndex += 1;
      const model = pick(spec.models);
      insert("devices", {
        id: sid(`device-${deviceIndex}`),
        organization_id: org.id,
        apple_team_id: rand() < 0.8 ? pick(teams).id : null,
        identifier: `00008120-${hex(12).toUpperCase()}`,
        name: `${pick(ownerNames)}'s ${model ?? "Device"}`,
        model,
        device_class: spec.class,
        enabled: rand() < 0.85 ? 1 : 0,
        created_at: spread(300),
        updated_at: spread(30),
      });
    }
  }

  // Credentials: metadata is real, encrypted blobs are fake — the web
  // credentials view is read-only and never decrypts, so lists render fine.
  const team1 = teams[0]!;
  const team2 = teams[1]!;
  const bundleId = "com.example.demoapp";

  insert("apple_distribution_certificates", {
    id: sid("dist-cert-1"),
    organization_id: org.id,
    apple_team_id: team1.id,
    serial_number: hex(16).toUpperCase(),
    valid_from: daysAgo(200),
    valid_until: daysAgo(-165),
    r2_key: `seed/credentials/${sid("dist-cert-1")}.p12`,
    vault_version: 1,
    wrapped_dek: fakeBlob(48),
    created_at: daysAgo(200),
  });
  // Second team's certificate is about to expire — exercises warning states.
  insert("apple_distribution_certificates", {
    id: sid("dist-cert-2"),
    organization_id: org.id,
    apple_team_id: team2.id,
    serial_number: hex(16).toUpperCase(),
    valid_from: daysAgo(345),
    valid_until: daysAgo(-20),
    r2_key: `seed/credentials/${sid("dist-cert-2")}.p12`,
    vault_version: 1,
    wrapped_dek: fakeBlob(48),
    created_at: daysAgo(345),
  });

  const profileSpecs = [
    { key: "profile-appstore", type: "APP_STORE", name: "Demo App App Store" },
    { key: "profile-adhoc", type: "AD_HOC", name: "Demo App Ad Hoc" },
  ];
  for (const profile of profileSpecs) {
    insert("apple_provisioning_profiles", {
      id: sid(profile.key),
      organization_id: org.id,
      apple_team_id: team1.id,
      apple_distribution_certificate_id: sid("dist-cert-1"),
      bundle_identifier: bundleId,
      distribution_type: profile.type,
      profile_name: profile.name,
      developer_portal_identifier: uuid().toUpperCase(),
      device_roster_hash: profile.type === "AD_HOC" ? hex(64) : null,
      is_managed: 1,
      valid_until: daysAgo(-165),
      r2_key: `seed/credentials/${sid(profile.key)}.mobileprovision`,
      created_at: daysAgo(60),
    });
  }

  insert("apple_push_keys", {
    id: sid("push-key-1"),
    organization_id: org.id,
    apple_team_id: team1.id,
    key_id: hex(10).toUpperCase(),
    r2_key: `seed/credentials/${sid("push-key-1")}.p8`,
    vault_version: 1,
    wrapped_dek: fakeBlob(48),
    created_at: daysAgo(150),
  });

  insert("asc_api_keys", {
    id: sid("asc-key-1"),
    organization_id: org.id,
    apple_team_id: team1.id,
    key_id: hex(10).toUpperCase(),
    issuer_id: uuid(),
    name: "CI submissions key",
    roles: JSON.stringify(["APP_MANAGER"]),
    r2_key: `seed/credentials/${sid("asc-key-1")}.p8`,
    vault_version: 1,
    wrapped_dek: fakeBlob(48),
    created_at: daysAgo(120),
  });

  insert("android_upload_keystores", {
    id: sid("keystore-1"),
    organization_id: org.id,
    name: "Play upload key",
    key_alias: "upload",
    keystore_type: "JKS",
    md5_fingerprint: hex(32).toUpperCase(),
    sha1_fingerprint: hex(40).toUpperCase(),
    sha256_fingerprint: hex(64).toUpperCase(),
    r2_key: `seed/credentials/${sid("keystore-1")}.jks`,
    vault_version: 1,
    wrapped_dek: fakeBlob(48),
    created_at: daysAgo(180),
  });

  insert("google_service_account_keys", {
    id: sid("gsa-key-1"),
    organization_id: org.id,
    client_email: "play-publisher@demo-app-123456.iam.gserviceaccount.com",
    client_id: String(100_000_000_000_000_000_000 + Math.floor(rand() * 1e18)),
    google_project_id: "demo-app-123456",
    private_key_id: hex(40),
    r2_key: `seed/credentials/${sid("gsa-key-1")}.json`,
    vault_version: 1,
    wrapped_dek: fakeBlob(48),
    created_at: daysAgo(140),
  });

  // Project wiring on the anchor: iOS bundle config + Android build credentials.
  insert("ios_bundle_configurations", {
    id: sid("ios-config-1"),
    organization_id: org.id,
    project_id: ANCHOR,
    bundle_identifier: bundleId,
    distribution_type: "APP_STORE",
    apple_team_id: team1.id,
    apple_distribution_certificate_id: sid("dist-cert-1"),
    apple_provisioning_profile_id: sid("profile-appstore"),
    apple_push_key_id: sid("push-key-1"),
    asc_api_key_id: sid("asc-key-1"),
    created_at: daysAgo(60),
  });
  insert("ios_app_metadata", {
    id: sid("ios-meta-1"),
    organization_id: org.id,
    project_id: ANCHOR,
    bundle_identifier: bundleId,
    app_name: "Demo App",
    company_name: "Example Corp",
    sku: "DEMOAPP1",
    asc_app_id: String(1_000_000_000 + Math.floor(rand() * 1e9)),
    created_at: daysAgo(60),
  });
  insert("android_application_identifiers", {
    id: sid("android-appid-1"),
    organization_id: org.id,
    project_id: ANCHOR,
    package_name: bundleId,
    created_at: daysAgo(60),
  });
  insert("android_build_credentials", {
    id: sid("android-creds-1"),
    organization_id: org.id,
    android_application_identifier_id: sid("android-appid-1"),
    android_upload_keystore_id: sid("keystore-1"),
    google_service_account_key_for_submissions_id: sid("gsa-key-1"),
    name: "Play Store",
    is_default: 1,
    created_at: daysAgo(60),
  });

  // Bindings make the org credentials usable inside the anchor project
  // (unbound credentials stay admin-only).
  const bindings = [
    { key: "bind-team", type: "appleTeam", resource: team1.id },
    { key: "bind-keystore", type: "androidUploadKeystore", resource: sid("keystore-1") },
    { key: "bind-gsa", type: "googleServiceAccountKey", resource: sid("gsa-key-1") },
  ];
  for (const binding of bindings) {
    insert("project_credential_binding", {
      id: sid(binding.key),
      organization_id: org.id,
      project_id: ANCHOR,
      resource_type: binding.type,
      resource_id: binding.resource,
      created_at: daysAgo(30),
    });
  }

  // Vault identities: enrolled keys only — no org_vaults row and no key wraps,
  // so real vault init/grant flows in dev stay untouched. Public keys are fake.
  const encryptionKeys = [
    {
      key: "enc-key-1",
      kind: "device",
      userId: teammates[0]!.id,
      label: "An's MacBook Pro",
      revoked: false,
    },
    {
      key: "enc-key-2",
      kind: "device",
      userId: teammates[1]!.id,
      label: "Bella's Mac Studio",
      revoked: true,
    },
    { key: "enc-key-3", kind: "machine", userId: null, label: "ci-deploy robot", revoked: false },
  ];
  for (const encryptionKey of encryptionKeys) {
    insert("user_encryption_keys", {
      id: sid(encryptionKey.key),
      user_id: encryptionKey.userId,
      organization_id: encryptionKey.userId === null ? org.id : null,
      kind: encryptionKey.kind,
      public_key: `age1${hex(58)}`,
      fingerprint: `SHA256:${fakeBlob(24).replaceAll("=", "")}`,
      label: encryptionKey.label,
      last_used_at: encryptionKey.revoked ? null : spread(10),
      revoked_at: encryptionKey.revoked ? daysAgo(25) : null,
      created_at: spread(120),
    });
  }

  // Env vars: real rows with garbage ciphertexts (values are E2E-encrypted with
  // the org vault key we don't have — lists work, decryption will not).
  const envVarSpecs = [
    {
      key: "API_URL",
      scope: "global",
      environments: ["development", "preview", "production"],
      visibility: "plaintext",
      revisions: 3,
    },
    {
      key: "SENTRY_DSN",
      scope: "global",
      environments: ["production"],
      visibility: "sensitive",
      revisions: 1,
    },
    {
      key: "ANALYTICS_WRITE_KEY",
      scope: "global",
      environments: ["staging"],
      visibility: "sensitive",
      revisions: 2,
    },
    {
      key: "DATABASE_URL",
      scope: "project",
      environments: ["production", "preview"],
      visibility: "sensitive",
      revisions: 2,
    },
    {
      key: "FEATURE_FLAG_CHECKOUT",
      scope: "project",
      environments: ["development", "preview"],
      visibility: "plaintext",
      revisions: 1,
    },
    {
      key: "STRIPE_PUBLISHABLE_KEY",
      scope: "project",
      environments: ["production"],
      visibility: "plaintext",
      revisions: 1,
    },
  ];
  for (const [specIndex, spec] of envVarSpecs.entries()) {
    for (const [envIndex, environment] of spec.environments.entries()) {
      const varId = sid(`envvar-${specIndex}-${envIndex}`);
      const createdAt = spread(90);
      insert("env_vars", {
        id: varId,
        organization_id: org.id,
        project_id: spec.scope === "project" ? ANCHOR : null,
        scope: spec.scope,
        environment,
        key: spec.key,
        visibility: spec.visibility,
        created_at: createdAt,
        updated_at: createdAt,
      });
      let lastRevisionId = "";
      for (let revision = 1; revision <= spec.revisions; revision += 1) {
        lastRevisionId = sid(`envrev-${specIndex}-${envIndex}-${revision}`);
        insert("env_var_revisions", {
          id: lastRevisionId,
          env_var_id: varId,
          organization_id: org.id,
          revision_number: revision,
          value_ciphertext: fakeBlob(48),
          wrapped_dek: fakeBlob(48),
          vault_version: 1,
          created_by_user_id: OWNER,
          created_at: createdAt,
        });
      }
      db.query("UPDATE env_vars SET current_revision_id = ? WHERE id = ?").run(
        lastRevisionId,
        varId,
      );
    }
  }
  const descriptions = [
    {
      key: "envdesc-1",
      varKey: "API_URL",
      scope: "global",
      label: "API base URL",
      text: "Base URL the mobile app talks to.",
    },
    {
      key: "envdesc-2",
      varKey: "DATABASE_URL",
      scope: "project",
      label: "Database DSN",
      text: "Postgres connection string for backend jobs.",
    },
  ];
  for (const description of descriptions) {
    insert("env_var_descriptions", {
      id: sid(description.key),
      organization_id: org.id,
      project_id: description.scope === "project" ? ANCHOR : null,
      scope: description.scope,
      key: description.varKey,
      label: description.label,
      description: description.text,
      created_at: daysAgo(20),
    });
  }

  // Robots, webhooks, environments.
  const robots = [
    { key: "robot-1", name: "ci-deploy", role: "developer", revoked: false },
    { key: "robot-2", name: "release-bot", role: "maintainer", revoked: false },
    { key: "robot-3", name: "old-jenkins", role: "developer", revoked: true },
  ];
  for (const robot of robots) {
    insert("robot_account", {
      id: sid(robot.key),
      organization_id: org.id,
      project_id: ANCHOR,
      name: robot.name,
      project_role: robot.role,
      bearer_key_hash: hex(64),
      bearer_start: `bu_r_${hex(8)}`,
      revoked_at: robot.revoked ? daysAgo(15) : null,
      created_at: spread(90),
    });
  }

  insert("webhooks", {
    id: sid("webhook-1"),
    organization_id: org.id,
    project_id: null,
    name: "Slack notifications",
    url: "https://hooks.slack.com/services/T000/B000/example",
    secret: `whsec_${hex(32)}`,
    enabled: 1,
    events: JSON.stringify(["update.published", "build.uploaded"]),
    created_at: daysAgo(60),
    updated_at: daysAgo(60),
  });
  insert("webhooks", {
    id: sid("webhook-2"),
    organization_id: org.id,
    project_id: ANCHOR,
    name: "Legacy CI endpoint",
    url: "https://ci.example.com/hooks/better-update",
    secret: `whsec_${hex(32)}`,
    enabled: 0,
    events: JSON.stringify(["update.published"]),
    created_at: daysAgo(120),
    updated_at: daysAgo(40),
  });

  for (const [index, name] of ["staging", "qa"].entries()) {
    insert("environments", {
      id: sid(`env-${index + 1}`),
      organization_id: org.id,
      name,
      created_at: daysAgo(100),
    });
  }

  // Audit logs: ~90 rows across resource types, actors and sources.
  const auditSpecs = [
    {
      type: "update",
      actions: ["update.publish", "update.rollback", "update.edit"],
      scoped: true,
      weight: 18,
    },
    { type: "build", actions: ["build.upload", "build.delete"], scoped: true, weight: 10 },
    {
      type: "project",
      actions: ["project.create", "project.update", "project.archive"],
      scoped: true,
      weight: 6,
    },
    { type: "branch", actions: ["branch.create", "branch.delete"], scoped: true, weight: 5 },
    {
      type: "channel",
      actions: ["channel.create", "channel.pause", "channel.rollout"],
      scoped: true,
      weight: 5,
    },
    {
      type: "envVar",
      actions: ["envVar.set", "envVar.delete", "envVar.describe"],
      scoped: true,
      weight: 8,
    },
    { type: "device", actions: ["device.register", "device.disable"], scoped: false, weight: 6 },
    {
      type: "robotAccount",
      actions: ["robotAccount.create", "robotAccount.rotate"],
      scoped: true,
      weight: 4,
    },
    { type: "member", actions: ["member.role.update", "member.remove"], scoped: false, weight: 4 },
    {
      type: "invitation",
      actions: ["invitation.create", "invitation.cancel"],
      scoped: false,
      weight: 3,
    },
    {
      type: "vaultAccess",
      actions: ["vault.web.unlock", "vaultAccess.grant"],
      scoped: false,
      weight: 4,
    },
    { type: "webhook", actions: ["webhook.create", "webhook.update"], scoped: false, weight: 2 },
    { type: "submission", actions: ["submission.record"], scoped: true, weight: 3 },
    { type: "organization", actions: ["organization.update"], scoped: false, weight: 2 },
    {
      type: "credentialBinding",
      actions: ["binding.grant", "binding.revoke"],
      scoped: true,
      weight: 3,
    },
    {
      type: "appleCredential",
      actions: ["apple.push-key.upload", "apple.certificate.create"],
      scoped: true,
      weight: 4,
    },
    { type: "environment", actions: ["environment.create"], scoped: false, weight: 2 },
  ];
  const actorEmails = [ownerRow.email, ...teammates.map((teammate) => teammate.email)];

  let auditIndex = 0;
  for (const spec of auditSpecs) {
    for (let index = 0; index < spec.weight; index += 1) {
      auditIndex += 1;
      const fromRobot = rand() < 0.15;
      insert("audit_logs", {
        id: sid(`audit-${auditIndex}`),
        organization_id: org.id,
        project_id: spec.scoped ? ANCHOR : null,
        actor_id: fromRobot ? null : OWNER,
        actor_email: fromRobot ? "robot:ci-deploy" : pick(actorEmails),
        action: pick(spec.actions),
        resource_type: spec.type,
        resource_id: hex(16),
        metadata: rand() < 0.3 ? JSON.stringify({ via: fromRobot ? "ci" : "web" }) : null,
        source: fromRobot ? "robot" : "session",
        created_at: spread(45),
      });
    }
  }

  db.query("UPDATE projects SET last_activity_at = ? WHERE id = ?").run(daysAgo(0.2), ANCHOR);
};

// ---------------------------------------------------------------------------
// Run: wipe, create shared users, then seed every organization.
// ---------------------------------------------------------------------------

const seedAll = db.transaction(() => {
  for (const statement of wipeStatements) {
    db.exec(statement);
  }

  for (const [index, teammate] of teammates.entries()) {
    const createdAt = daysAgo(120 - index * 14);
    insert("user", {
      id: teammate.id,
      email: teammate.email,
      name: teammate.name,
      email_verified: 1,
      approved: 1,
      created_at: createdAt,
      updated_at: createdAt,
    });
  }

  const orgs = db.query<OrgRow, []>("SELECT id, slug FROM organization").all();
  for (const [index, org] of orgs.entries()) {
    console.log(`Seeding org ${org.slug}`);
    seedOrg(org, index);
  }
});

seedAll();

const counts = db
  .query<{ label: string; n: number }, []>(
    `SELECT 'updates' AS label, count(*) AS n FROM updates WHERE id LIKE 'seed-%'
     UNION ALL SELECT 'builds', count(*) FROM builds WHERE id LIKE 'seed-%'
     UNION ALL SELECT 'devices', count(*) FROM devices WHERE id LIKE 'seed-%'
     UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs WHERE id LIKE 'seed-%'
     UNION ALL SELECT 'projects', count(*) FROM projects WHERE id LIKE 'seed-%'
     UNION ALL SELECT 'members', count(*) FROM member WHERE id LIKE 'seed-%'
     UNION ALL SELECT 'submissions', count(*) FROM submissions WHERE id LIKE 'seed-%'`,
  )
  .all();
for (const row of counts) {
  console.log(`${row.label}: ${row.n}`);
}
console.log("Done.");
