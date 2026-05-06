import { Effect, Exit } from "effect";

import { mockD1 } from "../../tests/helpers/mock-d1";
import { runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { DeviceRepo, DeviceRepoLive } from "./devices";

const makeEnv = (db: unknown) => ({ DB: db }) as unknown as Env;

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, DeviceRepo>, env: Env) =>
  runWithLayerAndEnvExit(effect, DeviceRepoLive, env);

const makeRow = (id: string, createdAt: string) => ({
  id,
  organization_id: "org-1",
  apple_team_id: null,
  identifier: `00008030-${id.padStart(16, "0")}`,
  name: `Device ${id}`,
  model: null,
  device_class: "IPHONE" as const,
  enabled: 1,
  apple_device_portal_id: null,
  created_at: createdAt,
  updated_at: createdAt,
});

describe("deviceRepo — findByOrg page pagination", () => {
  it("returns items + total", async () => {
    const rows = [
      makeRow("z", "2026-01-03T00:00:00.000Z"),
      makeRow("y", "2026-01-02T00:00:00.000Z"),
    ];
    const db = mockD1.forQuery({
      first: async () => ({ count: 3 }),
      all: async () => ({ results: rows }),
    });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* DeviceRepo;
        return yield* repo.findByOrg({
          organizationId: "org-1",
          sort: "createdAt",
          order: "desc",
          limit: 2,
          offset: 0,
        });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.items).toHaveLength(2);
      expect(exit.value.total).toBe(3);
    }
  });

  it("returns empty items when result is empty", async () => {
    const db = mockD1.forQuery({
      first: async () => ({ count: 0 }),
      all: async () => ({ results: [] }),
    });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* DeviceRepo;
        return yield* repo.findByOrg({
          organizationId: "org-1",
          sort: "createdAt",
          order: "desc",
          limit: 10,
          offset: 0,
        });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.items).toHaveLength(0);
      expect(exit.value.total).toBe(0);
    }
  });

  it("accepts filter inputs", async () => {
    const db = mockD1.forQuery({
      first: async () => ({ count: 0 }),
      all: async () => ({ results: [] }),
    });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* DeviceRepo;
        return yield* repo.findByOrg({
          organizationId: "org-1",
          deviceClass: "IPAD",
          appleTeamId: "team-1",
          sort: "name",
          order: "asc",
          limit: 25,
          offset: 25,
        });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });
});
