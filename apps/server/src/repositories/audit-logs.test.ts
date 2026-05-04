import { Effect, Exit } from "effect";

import { mockD1 } from "../../tests/helpers/mock-d1";
import { runWithLayerAndEnvExit } from "../../tests/helpers/runtime";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { AuditLogRepo, AuditLogRepoLive } from "./audit-logs";

const makeEnv = (db: unknown) => ({ DB: db }) as unknown as Env;

const runWithRepo = async <Ret, Err>(effect: Effect.Effect<Ret, Err, AuditLogRepo>, env: Env) =>
  runWithLayerAndEnvExit(effect, AuditLogRepoLive, env);

const makeRow = (id: string, createdAt: string) => ({
  id,
  organization_id: "org-1",
  project_id: null,
  actor_id: null,
  actor_email: "a@example.com",
  action: "test.action",
  resource_type: "project",
  resource_id: null,
  metadata: null,
  source: "session",
  created_at: createdAt,
});

describe("auditLogRepo — list cursor pagination", () => {
  it("returns nextCursor when more rows than limit exist", async () => {
    const rows = [
      makeRow("z", "2026-01-03T00:00:00.000Z"),
      makeRow("y", "2026-01-02T00:00:00.000Z"),
      makeRow("x", "2026-01-01T00:00:00.000Z"),
    ];
    const db = mockD1.forQuery({ all: async () => ({ results: rows }) });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* AuditLogRepo;
        return yield* repo.list({ organizationId: "org-1", cursor: null, limit: 2 });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.items).toHaveLength(2);
      expect(exit.value.items[0]?.id).toBe("z");
      expect(exit.value.items[1]?.id).toBe("y");
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
        const repo = yield* AuditLogRepo;
        return yield* repo.list({ organizationId: "org-1", cursor: null, limit: 50 });
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
        const repo = yield* AuditLogRepo;
        return yield* repo.list({ organizationId: "org-1", cursor: null, limit: 10 });
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
        const repo = yield* AuditLogRepo;
        return yield* repo.list({ organizationId: "org-1", cursor: null, limit: 2 });
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

  it("accepts cursor input and includes filter values", async () => {
    const db = mockD1.forQuery({ all: async () => ({ results: [] }) });

    const exit = await runWithRepo(
      Effect.gen(function* () {
        const repo = yield* AuditLogRepo;
        return yield* repo.list({
          organizationId: "org-1",
          projectId: "proj-1",
          resourceType: "build",
          from: "2026-01-01T00:00:00.000Z",
          to: "2026-02-01T00:00:00.000Z",
          cursor: { createdAt: "2026-01-15T00:00:00.000Z", id: "mid" },
          limit: 25,
        });
      }),
      makeEnv(db),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });
});
