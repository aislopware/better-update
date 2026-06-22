import { dedupeAssetRefsByKey, describeUniqueConstraintConflict } from "./update-row-mapping";

import type { UpdateAssetRefModel } from "../models";

const asset = (key: string, hash: string, isLaunch = false): UpdateAssetRefModel => ({
  key,
  hash,
  isLaunch,
});

describe(dedupeAssetRefsByKey, () => {
  it("collapses a repeated key to a single row (the update_assets PK)", () => {
    const dup = asset("a.png", "h1");
    expect(dedupeAssetRefsByKey([dup, dup, asset("b.png", "h2")])).toHaveLength(2);
  });

  it("keeps distinct keys that share one content-addressed hash", () => {
    expect(dedupeAssetRefsByKey([asset("a.png", "h"), asset("b.png", "h")])).toHaveLength(2);
  });

  it("leaves an already-unique list untouched", () => {
    const launch = asset("bundle.js", "h0", true);
    const refs = [launch, asset("a.png", "h1"), asset("b.png", "h2")];
    expect(dedupeAssetRefsByKey(refs)).toStrictEqual(refs);
  });
});

describe(describeUniqueConstraintConflict, () => {
  it("maps an updates.id PK collision to an id-already-exists message", () => {
    expect(
      describeUniqueConstraintConflict("D1_ERROR: UNIQUE constraint failed: updates.id", "u1"),
    ).toBe('An update with id "u1" already exists');
  });

  it("maps an update_assets collision to a duplicate-asset message, not an id collision", () => {
    const message = describeUniqueConstraintConflict(
      "UNIQUE constraint failed: update_assets.update_id, update_assets.asset_key",
      "u1",
    );
    expect(message).toContain("asset");
    expect(message).not.toContain("already exists");
  });

  it("maps the embedded-baseline index collision to its own message", () => {
    const message = describeUniqueConstraintConflict(
      "UNIQUE constraint failed: updates.branch_id, updates.runtime_version, updates.platform",
      "u1",
    );
    expect(message).toContain("embedded baseline");
  });

  it("returns undefined for non-uniqueness causes so the caller re-dies", () => {
    expect(describeUniqueConstraintConflict("SQLITE_ERROR: no such table", "u1")).toBeUndefined();
  });
});
