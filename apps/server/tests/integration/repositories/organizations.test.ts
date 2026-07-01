import { env } from "cloudflare:test";
import { Effect, Either } from "effect";

import { OrganizationRepo, OrganizationRepoLive } from "../../../src/repositories/organizations";
import { runEitherWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, OrganizationRepo>) =>
  runWithLayerAndEnv(effect, OrganizationRepoLive, env);

const runEither = <Ret, Err>(effect: Effect.Effect<Ret, Err, OrganizationRepo>) =>
  runEitherWithLayerAndEnv(effect, OrganizationRepoLive, env);

const insertOrg = (id: string, slug: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${slug}`, slug, "2026-01-01T00:00:00Z")
    .run();

const update = (params: { id: string; name?: string; slug?: string }) =>
  run(
    Effect.gen(function* () {
      const repo = yield* OrganizationRepo;
      return yield* repo.update(params);
    }),
  );

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg("org-a", "org-alpha");
  await insertOrg("org-b", "org-bravo");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("OrganizationRepo — D1 integration (Kysely + session)", () => {
  it("patches name + slug and returns the updated row", async () => {
    const updated = await update({ id: "org-a", name: "Renamed", slug: "renamed-alpha" });

    expect(updated).toEqual({ id: "org-a", name: "Renamed", slug: "renamed-alpha", logoUrl: null });

    const row = await env.DB.prepare(`SELECT "name", "slug" FROM "organization" WHERE "id" = ?`)
      .bind("org-a")
      .first<{ name: string; slug: string }>();
    expect(row).toEqual({ name: "Renamed", slug: "renamed-alpha" });
  });

  it("patches only the provided field, leaving the other intact", async () => {
    const updated = await update({ id: "org-b", name: "Only Name Changed" });

    expect(updated).toEqual({
      id: "org-b",
      name: "Only Name Changed",
      slug: "org-bravo",
      logoUrl: null,
    });
  });

  it("returns the unchanged row when no fields are provided", async () => {
    const updated = await update({ id: "org-b" });

    expect(updated).toEqual({
      id: "org-b",
      name: "Only Name Changed",
      slug: "org-bravo",
      logoUrl: null,
    });
  });

  it("returns null when the org does not exist", async () => {
    const updated = await update({ id: "org-missing", name: "Ghost" });

    expect(updated).toBeNull();
  });

  it("fails with Conflict when the new slug collides", async () => {
    const result = await runEither(
      Effect.gen(function* () {
        const repo = yield* OrganizationRepo;
        // "org-bravo" still belongs to org-b → org-a cannot take it.
        return yield* repo.update({ id: "org-a", slug: "org-bravo" });
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "Conflict" });
    }
  });
});

describe("OrganizationRepo — logo (D1 integration)", () => {
  it("findById returns the row with a null logoUrl by default", async () => {
    const org = await run(
      Effect.gen(function* () {
        const repo = yield* OrganizationRepo;
        return yield* repo.findById({ id: "org-a" });
      }),
    );

    expect(org).toMatchObject({ id: "org-a", logoUrl: null });
  });

  it("findById returns null for a missing org", async () => {
    const org = await run(
      Effect.gen(function* () {
        const repo = yield* OrganizationRepo;
        return yield* repo.findById({ id: "org-missing" });
      }),
    );

    expect(org).toBeNull();
  });

  it("updateLogoUrl sets then clears the logo column", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* OrganizationRepo;
        yield* repo.updateLogoUrl({ id: "org-b", logoUrl: "https://cdn.example/logos/org/org-b" });
      }),
    );

    const afterSet = await run(
      Effect.gen(function* () {
        const repo = yield* OrganizationRepo;
        return yield* repo.findById({ id: "org-b" });
      }),
    );
    expect(afterSet?.logoUrl).toBe("https://cdn.example/logos/org/org-b");

    await run(
      Effect.gen(function* () {
        const repo = yield* OrganizationRepo;
        yield* repo.updateLogoUrl({ id: "org-b", logoUrl: null });
      }),
    );

    const afterClear = await run(
      Effect.gen(function* () {
        const repo = yield* OrganizationRepo;
        return yield* repo.findById({ id: "org-b" });
      }),
    );
    expect(afterClear?.logoUrl).toBeNull();
  });
});
