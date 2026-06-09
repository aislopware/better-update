import { env } from "cloudflare:test";
import { Effect, Either } from "effect";

import { DeviceRepo, DeviceRepoLive } from "../../../src/repositories/devices";
import { runEitherWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

import type { DeviceRepository } from "../../../src/repositories/devices";

// ── Helpers ───────────────────────────────────────────────────────

const call = <Ret, Err>(use: (repo: DeviceRepository) => Effect.Effect<Ret, Err>) =>
  runWithLayerAndEnv(
    Effect.gen(function* () {
      const repo = yield* DeviceRepo;
      return yield* use(repo);
    }),
    DeviceRepoLive,
    env,
  );

const callEither = <Ret, Err>(use: (repo: DeviceRepository) => Effect.Effect<Ret, Err>) =>
  runEitherWithLayerAndEnv(
    Effect.gen(function* () {
      const repo = yield* DeviceRepo;
      return yield* use(repo);
    }),
    DeviceRepoLive,
    env,
  );

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, id, "2026-01-01T00:00:00Z")
    .run();

const insertDevice = (device: {
  id: string;
  organizationId: string;
  identifier: string;
  name: string;
  deviceClass: string;
  createdAt: string;
}) =>
  env.DB.prepare(
    `INSERT INTO "devices" ("id", "organization_id", "apple_team_id", "identifier", "name", "model", "device_class", "enabled", "apple_device_portal_id", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      device.id,
      device.organizationId,
      null,
      device.identifier,
      device.name,
      null,
      device.deviceClass,
      1,
      null,
      device.createdAt,
      device.createdAt,
    )
    .run();

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg("io-org");
  await insertOrg("io-org-2");
  await insertDevice({
    id: "dev-iphone",
    organizationId: "io-org",
    identifier: "ID-IPHONE-0001",
    name: "Alice iPhone",
    deviceClass: "IPHONE",
    createdAt: "2026-02-03T00:00:00Z",
  });
  await insertDevice({
    id: "dev-ipad",
    organizationId: "io-org",
    identifier: "ID-IPAD-0002",
    name: "Bob iPad",
    deviceClass: "IPAD",
    createdAt: "2026-02-02T00:00:00Z",
  });
  await insertDevice({
    id: "dev-mac",
    organizationId: "io-org",
    identifier: "ID-MAC-0003",
    name: "Carol Mac",
    deviceClass: "MAC",
    createdAt: "2026-02-01T00:00:00Z",
  });
  await insertDevice({
    id: "dev-other",
    organizationId: "io-org-2",
    identifier: "ID-OTHER-0009",
    name: "Other Phone",
    deviceClass: "IPHONE",
    createdAt: "2026-02-04T00:00:00Z",
  });
});

// ── Tests ─────────────────────────────────────────────────────────

describe("DeviceRepo — D1 integration (Kysely + session)", () => {
  it("lists org-scoped devices with total, sort, and pagination", async () => {
    const page = await call((repo) =>
      repo.findByOrg({
        organizationId: "io-org",
        sort: "createdAt",
        order: "desc",
        limit: 2,
        offset: 0,
      }),
    );

    // Org scoping excludes io-org-2's device, so the total is 3, not 4.
    expect(page.total).toBe(3);
    expect(page.items.map((device) => device.id)).toEqual(["dev-iphone", "dev-ipad"]);
    expect(page.items[0]).toMatchObject({
      name: "Alice iPhone",
      deviceClass: "IPHONE",
      enabled: true,
    });
  });

  it("matches via FTS for 3+ char queries and LIKE for short queries", async () => {
    const fts = await call((repo) =>
      repo.findByOrg({
        organizationId: "io-org",
        sort: "createdAt",
        order: "desc",
        limit: 10,
        offset: 0,
        query: "iphone",
      }),
    );
    expect(fts.total).toBe(1);
    expect(fts.items.map((device) => device.id)).toEqual(["dev-iphone"]);

    const short = await call((repo) =>
      repo.findByOrg({
        organizationId: "io-org",
        sort: "createdAt",
        order: "desc",
        limit: 10,
        offset: 0,
        query: "ca",
      }),
    );
    expect(short.total).toBe(1);
    expect(short.items.map((device) => device.id)).toEqual(["dev-mac"]);
  });

  it("finds a device by COALESCE'd identifier match and rejects a team mismatch", async () => {
    const found = await call((repo) =>
      repo.findByIdentifier({
        organizationId: "io-org",
        appleTeamId: null,
        identifier: "ID-IPHONE-0001",
      }),
    );
    expect(found.id).toBe("dev-iphone");

    // The stored apple_team_id is null; a non-null lookup must not COALESCE-match.
    const mismatch = await callEither((repo) =>
      repo.findByIdentifier({
        organizationId: "io-org",
        appleTeamId: "team-x",
        identifier: "ID-IPHONE-0001",
      }),
    );
    expect(Either.isLeft(mismatch)).toBe(true);
    if (Either.isLeft(mismatch)) {
      expect(mismatch.left).toMatchObject({ _tag: "NotFound" });
    }
  });

  it("inserts a device and rejects a duplicate identifier with Conflict", async () => {
    await call((repo) =>
      repo.insert({
        id: "dev-new",
        organizationId: "io-org",
        appleTeamId: null,
        identifier: "ID-NEW-1000",
        name: "Dave Phone",
        model: null,
        deviceClass: "IPHONE",
        enabled: true,
        appleDevicePortalId: null,
        createdAt: "2026-02-05T00:00:00Z",
        updatedAt: "2026-02-05T00:00:00Z",
      }),
    );

    const inserted = await call((repo) => repo.findById({ id: "dev-new" }));
    expect(inserted).toMatchObject({ identifier: "ID-NEW-1000", name: "Dave Phone" });

    const conflict = await callEither((repo) =>
      repo.insert({
        id: "dev-dupe",
        organizationId: "io-org",
        appleTeamId: null,
        identifier: "ID-IPHONE-0001",
        name: "Clashing Device",
        model: null,
        deviceClass: "IPHONE",
        enabled: true,
        appleDevicePortalId: null,
        createdAt: "2026-02-06T00:00:00Z",
        updatedAt: "2026-02-06T00:00:00Z",
      }),
    );
    expect(Either.isLeft(conflict)).toBe(true);
    if (Either.isLeft(conflict)) {
      expect(conflict.left).toMatchObject({ _tag: "Conflict" });
    }
  });

  it("fails with NotFound for an unknown id", async () => {
    const result = await callEither((repo) => repo.findById({ id: "dev-missing" }));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "NotFound" });
    }
  });
});
