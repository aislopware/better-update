import { Effect, Exit } from "effect";

import { mockD1 } from "../../tests/helpers/mock-d1";
import { runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { decodeCursor, encodeCursor } from "../lib/cursor";
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

describe("deviceRepo — findByOrg cursor pagination", () => {
  it("returns nextCursor when more rows than limit exist", async () => {
    const rows = [
      makeRow("z", "2026-01-03T00:00:00.000Z"),
      makeRow("y", "2026-01-02T00:00:00.000Z"),
      makeRow("x", "2026-01-01T00:00:00.000Z"),
    ];
    const db = mockD1.forQuery({ all: async () => ({ results: rows }) });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* DeviceRepo;
        return yield* repo.findByOrg({ organizationId: "org-1", cursor: null, limit: 2 });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.items).toHaveLength(2);
      expect(exit.value.nextCursor).toBe(
        encodeCursor({ createdAt: "2026-01-02T00:00:00.000Z", id: "y" }),
      );
    }
  });

  it("returns null nextCursor when fewer rows than limit exist", async () => {
    const rows = [makeRow("a", "2026-01-01T00:00:00.000Z")];
    const db = mockD1.forQuery({ all: async () => ({ results: rows }) });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* DeviceRepo;
        return yield* repo.findByOrg({ organizationId: "org-1", cursor: null, limit: 50 });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.items).toHaveLength(1);
      expect(exit.value.nextCursor).toBeNull();
    }
  });

  it("returns null nextCursor when result is empty", async () => {
    const db = mockD1.forQuery({ all: async () => ({ results: [] }) });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* DeviceRepo;
        return yield* repo.findByOrg({ organizationId: "org-1", cursor: null, limit: 10 });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.items).toHaveLength(0);
      expect(exit.value.nextCursor).toBeNull();
    }
  });

  it("encodes cursor as base64 JSON of last item created_at + id", async () => {
    const rows = [
      makeRow("third", "2026-01-03T00:00:00.000Z"),
      makeRow("second", "2026-01-02T00:00:00.000Z"),
      makeRow("first", "2026-01-01T00:00:00.000Z"),
    ];
    const db = mockD1.forQuery({ all: async () => ({ results: rows }) });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* DeviceRepo;
        return yield* repo.findByOrg({ organizationId: "org-1", cursor: null, limit: 2 });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit) && exit.value.nextCursor) {
      expect(decodeCursor(exit.value.nextCursor)).toStrictEqual({
        createdAt: "2026-01-02T00:00:00.000Z",
        id: "second",
      });
    }
  });

  it("accepts cursor and filter inputs", async () => {
    const db = mockD1.forQuery({ all: async () => ({ results: [] }) });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* DeviceRepo;
        return yield* repo.findByOrg({
          organizationId: "org-1",
          deviceClass: "IPAD",
          appleTeamId: "team-1",
          cursor: { createdAt: "2026-01-15T00:00:00.000Z", id: "mid" },
          limit: 25,
        });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });
});
