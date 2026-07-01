import { env } from "cloudflare:test";
import { Cause, Effect, Exit, Option } from "effect";

import { OrganizationRepo, OrganizationRepoLive } from "../../../src/repositories/organizations";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, OrganizationRepo>) =>
  runWithLayerAndEnv(effect, OrganizationRepoLive, env);

const withRepo = <Ret, Err>(use: (repo: OrganizationRepo["Type"]) => Effect.Effect<Ret, Err>) =>
  run(
    Effect.gen(function* () {
      const repo = yield* OrganizationRepo;
      return yield* use(repo);
    }),
  );

const insertOrg = (id: string, slug: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, slug, "2026-01-01T00:00:00Z")
    .run();

const ORG_A = "org-update-a";
const ORG_B = "org-update-b";

beforeAll(async () => {
  await insertOrg(ORG_A, "org-update-a-slug");
  await insertOrg(ORG_B, "org-update-b-slug");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("OrganizationRepo — D1 integration", () => {
  it("patches name + slug and returns the updated row", async () => {
    const updated = await withRepo((repo) =>
      repo.update({ id: ORG_A, name: "Renamed A", slug: "renamed-a" }),
    );
    expect(updated).toEqual({
      id: ORG_A,
      name: "Renamed A",
      slug: "renamed-a",
      logoUrl: null,
    });
  });

  it("a partial patch (name only) keeps the existing slug", async () => {
    const updated = await withRepo((repo) => repo.update({ id: ORG_A, name: "Renamed Again" }));
    expect(updated?.name).toBe("Renamed Again");
    expect(updated?.slug).toBe("renamed-a");
  });

  it("a duplicate slug fails a TYPED Conflict (the slug column is UNIQUE)", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const repo = yield* OrganizationRepo;
        return yield* repo.update({ id: ORG_A, slug: "org-update-b-slug" });
      }).pipe(Effect.exit),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const failure = Exit.isFailure(exit)
      ? Option.getOrUndefined(Cause.failureOption(exit.cause))
      : undefined;
    expect(failure?._tag).toBe("Conflict");
  });

  it("updating an absent org returns null", async () => {
    const updated = await withRepo((repo) => repo.update({ id: "org-nonexistent", name: "Ghost" }));
    expect(updated).toBeNull();
  });
});
