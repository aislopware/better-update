import { env } from "cloudflare:test";
import { Effect, Either } from "effect";

import {
  AppleDistributionCertificateRepo,
  AppleDistributionCertificateRepoLive,
} from "../../../src/repositories/apple-distribution-certificates";
import { runEitherWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, AppleDistributionCertificateRepo>) =>
  runWithLayerAndEnv(effect, AppleDistributionCertificateRepoLive, env);

const runEither = <Ret, Err>(effect: Effect.Effect<Ret, Err, AppleDistributionCertificateRepo>) =>
  runEitherWithLayerAndEnv(effect, AppleDistributionCertificateRepoLive, env);

// `apple_distribution_certificates` FKs `organization` + `apple_teams` (both NOT
// NULL) — those parents must exist before any cert row is inserted.
const seedOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`, "2026-01-01T00:00:00Z")
    .run();

const seedAppleTeam = (id: string, orgId: string) =>
  env.DB.prepare(
    `INSERT INTO "apple_teams" ("id", "organization_id", "apple_team_id", "apple_team_type") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, orgId, id, "COMPANY_ORGANIZATION")
    .run();

const seedCert = (
  id: string,
  orgId: string,
  serialNumber: string,
  createdAt = "2026-01-01T00:00:00Z",
) =>
  env.DB.prepare(
    `INSERT INTO "apple_distribution_certificates"
      ("id", "organization_id", "apple_team_id", "serial_number",
       "developer_id_identifier", "valid_from", "valid_until",
       "r2_key", "wrapped_dek", "vault_version", "created_at", "updated_at")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      orgId,
      "TEAM0001",
      serialNumber,
      null,
      "2025-01-01T00:00:00Z",
      "2027-01-01T00:00:00Z",
      `r2/certs/${id}.p12`,
      "wrappeddek==",
      1,
      createdAt,
      createdAt,
    )
    .run();

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await seedOrg("org-dist-1");
  await seedOrg("org-dist-2");
  await seedAppleTeam("TEAM0001", "org-dist-1");
  await seedCert("cert-a1", "org-dist-1", "SN-ALPHA", "2026-01-01T00:00:00Z");
  await seedCert("cert-a2", "org-dist-1", "SN-BETA", "2026-02-01T00:00:00Z");
  await seedCert("cert-b1", "org-dist-2", "SN-GAMMA", "2026-01-15T00:00:00Z");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("AppleDistributionCertificateRepo — D1 integration (Kysely + session)", () => {
  it("listByOrg returns certs for the org ordered by created_at DESC", async () => {
    const certs = await run(
      Effect.gen(function* () {
        const repo = yield* AppleDistributionCertificateRepo;
        return yield* repo.listByOrg({ organizationId: "org-dist-1" });
      }),
    );

    expect(certs).toHaveLength(2);
    expect(certs[0].id).toBe("cert-a2"); // newer first
    expect(certs[1].id).toBe("cert-a1");
    expect(certs[0].serialNumber).toBe("SN-BETA");
  });

  it("listByOrg returns empty array for org with no certs", async () => {
    const certs = await run(
      Effect.gen(function* () {
        const repo = yield* AppleDistributionCertificateRepo;
        return yield* repo.listByOrg({ organizationId: "org-none" });
      }),
    );

    expect(certs).toHaveLength(0);
  });

  it("findById returns the cert model", async () => {
    const cert = await run(
      Effect.gen(function* () {
        const repo = yield* AppleDistributionCertificateRepo;
        return yield* repo.findById({ id: "cert-b1" });
      }),
    );

    expect(cert.id).toBe("cert-b1");
    expect(cert.organizationId).toBe("org-dist-2");
    expect(cert.serialNumber).toBe("SN-GAMMA");
    expect(cert.developerIdIdentifier).toBeNull();
  });

  it("findById fails with NotFound for a missing id", async () => {
    const result = await runEither(
      Effect.gen(function* () {
        const repo = yield* AppleDistributionCertificateRepo;
        return yield* repo.findById({ id: "cert-missing" });
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "NotFound" });
    }
  });

  it("insert adds a cert and fails with Conflict on duplicate serial", async () => {
    const params = {
      id: "cert-new-1",
      organizationId: "org-dist-1",
      appleTeamId: "TEAM0001",
      serialNumber: "SN-UNIQUE",
      developerIdIdentifier: null,
      validFrom: "2025-01-01T00:00:00Z",
      validUntil: "2027-01-01T00:00:00Z",
      r2Key: "r2/certs/cert-new-1.p12",
      wrappedDek: "wrappeddek==",
      vaultVersion: 1,
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-01T00:00:00Z",
    };

    await run(
      Effect.gen(function* () {
        const repo = yield* AppleDistributionCertificateRepo;
        return yield* repo.insert(params);
      }),
    );

    // Verify row is in DB
    const row = await env.DB.prepare(
      `SELECT "serial_number" FROM "apple_distribution_certificates" WHERE "id" = ?`,
    )
      .bind("cert-new-1")
      .first<{ serial_number: string }>();
    expect(row?.serial_number).toBe("SN-UNIQUE");

    // Duplicate serial → Conflict
    const conflict = await runEither(
      Effect.gen(function* () {
        const repo = yield* AppleDistributionCertificateRepo;
        return yield* repo.insert({ ...params, id: "cert-new-2" });
      }),
    );

    expect(Either.isLeft(conflict)).toBe(true);
    if (Either.isLeft(conflict)) {
      expect(conflict.left).toMatchObject({ _tag: "Conflict" });
    }
  });
});
