import { PatchBaseCandidate } from "@better-update/api";

import { selectBaseWindow } from "./patch-base-window";

const candidate = (overrides: Partial<PatchBaseCandidate>): PatchBaseCandidate =>
  PatchBaseCandidate.make({
    updateId: overrides.updateId ?? "00000000-0000-0000-0000-000000000000",
    launchAssetHash: overrides.launchAssetHash ?? "hash",
    runtimeVersion: overrides.runtimeVersion ?? "1.0.0",
    platform: overrides.platform ?? "ios",
    isEmbedded: overrides.isEmbedded ?? false,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  });

const ids = (list: readonly PatchBaseCandidate[]): readonly string[] =>
  list.map((entry) => entry.updateId);

describe(selectBaseWindow, () => {
  it("drops the self-target", () => {
    const bases = [
      candidate({ updateId: "new", createdAt: "2026-01-03T00:00:00.000Z" }),
      candidate({ updateId: "old", createdAt: "2026-01-02T00:00:00.000Z" }),
    ];
    expect(ids(selectBaseWindow(bases, { newUpdateId: "new", maxRecent: 10 }))).toStrictEqual([
      "old",
    ]);
  });

  it("drops candidates missing a launch-asset hash", () => {
    const bases = [
      candidate({ updateId: "a", launchAssetHash: "" }),
      candidate({ updateId: "b", launchAssetHash: "h" }),
    ];
    expect(ids(selectBaseWindow(bases, { newUpdateId: "new", maxRecent: 10 }))).toStrictEqual([
      "b",
    ]);
  });

  it("sorts newest-first by createdAt", () => {
    const bases = [
      candidate({ updateId: "old", createdAt: "2026-01-01T00:00:00.000Z" }),
      candidate({ updateId: "new", createdAt: "2026-01-03T00:00:00.000Z" }),
      candidate({ updateId: "mid", createdAt: "2026-01-02T00:00:00.000Z" }),
    ];
    expect(ids(selectBaseWindow(bases, { newUpdateId: "target", maxRecent: 10 }))).toStrictEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("caps the recent (non-embedded) window to maxRecent", () => {
    const bases = [
      candidate({ updateId: "r1", createdAt: "2026-01-05T00:00:00.000Z" }),
      candidate({ updateId: "r2", createdAt: "2026-01-04T00:00:00.000Z" }),
      candidate({ updateId: "r3", createdAt: "2026-01-03T00:00:00.000Z" }),
    ];
    expect(ids(selectBaseWindow(bases, { newUpdateId: "target", maxRecent: 2 }))).toStrictEqual([
      "r1",
      "r2",
    ]);
  });

  it("always includes the embedded baseline even outside the recent window", () => {
    const bases = [
      candidate({ updateId: "r1", createdAt: "2026-01-05T00:00:00.000Z" }),
      candidate({ updateId: "r2", createdAt: "2026-01-04T00:00:00.000Z" }),
      candidate({
        updateId: "embedded",
        createdAt: "2025-01-01T00:00:00.000Z",
        isEmbedded: true,
      }),
    ];
    const result = ids(selectBaseWindow(bases, { newUpdateId: "target", maxRecent: 1 }));
    expect(result).toContain("embedded");
    expect(result).toStrictEqual(["r1", "embedded"]);
  });

  it("does not duplicate an embedded baseline already in the recent slice", () => {
    const bases = [
      candidate({ updateId: "embedded", createdAt: "2026-01-05T00:00:00.000Z", isEmbedded: true }),
      candidate({ updateId: "r2", createdAt: "2026-01-04T00:00:00.000Z" }),
    ];
    expect(ids(selectBaseWindow(bases, { newUpdateId: "target", maxRecent: 10 }))).toStrictEqual([
      "r2",
      "embedded",
    ]);
  });

  it("dedups by updateId (case-insensitive)", () => {
    const bases = [
      candidate({ updateId: "ABC", createdAt: "2026-01-02T00:00:00.000Z" }),
      candidate({ updateId: "abc", createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(selectBaseWindow(bases, { newUpdateId: "target", maxRecent: 10 })).toHaveLength(1);
  });

  it("maxRecent=0 keeps only the embedded baseline", () => {
    const bases = [
      candidate({ updateId: "r1", createdAt: "2026-01-05T00:00:00.000Z" }),
      candidate({ updateId: "embedded", createdAt: "2026-01-04T00:00:00.000Z", isEmbedded: true }),
    ];
    expect(ids(selectBaseWindow(bases, { newUpdateId: "target", maxRecent: 0 }))).toStrictEqual([
      "embedded",
    ]);
  });
});
