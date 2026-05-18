import { diffAssets } from "./-compare-updates-dialog";

describe(diffAssets, () => {
  it("returns empty diff when both sides are identical", () => {
    const assets = [
      { hash: "h1", key: "a.js" },
      { hash: "h2", key: "b.js" },
    ];
    const result = diffAssets(assets, assets);
    expect(result.addedCount).toBe(0);
    expect(result.removedCount).toBe(0);
    expect(result.unchangedCount).toBe(2);
  });

  it("counts added assets (only in right) and removed assets (only in left)", () => {
    const left = [
      { hash: "h1", key: "a.js" },
      { hash: "h2", key: "b.js" },
      { hash: "h3", key: "c.js" },
    ];
    const right = [
      { hash: "h2", key: "b.js" },
      { hash: "h3", key: "c.js" },
      { hash: "h4", key: "d.js" },
      { hash: "h5", key: "e.js" },
    ];
    const result = diffAssets(left, right);
    expect(result.addedCount).toBe(2);
    expect(result.removedCount).toBe(1);
    expect(result.unchangedCount).toBe(2);
    expect(result.added.map((asset) => asset.hash).toSorted()).toStrictEqual(["h4", "h5"]);
    expect(result.removed.map((asset) => asset.hash).toSorted()).toStrictEqual(["h1"]);
  });

  it("treats identical key but different hash as removed + added", () => {
    const left = [{ hash: "old-hash", key: "bundle.js" }];
    const right = [{ hash: "new-hash", key: "bundle.js" }];
    const result = diffAssets(left, right);
    expect(result.addedCount).toBe(1);
    expect(result.removedCount).toBe(1);
    expect(result.unchangedCount).toBe(0);
    expect(result.added[0]?.hash).toBe("new-hash");
    expect(result.removed[0]?.hash).toBe("old-hash");
  });

  it("handles empty left side (everything added)", () => {
    const result = diffAssets([], [{ hash: "h1", key: "a.js" }]);
    expect(result.addedCount).toBe(1);
    expect(result.removedCount).toBe(0);
    expect(result.unchangedCount).toBe(0);
  });

  it("handles empty right side (everything removed)", () => {
    const result = diffAssets([{ hash: "h1", key: "a.js" }], []);
    expect(result.addedCount).toBe(0);
    expect(result.removedCount).toBe(1);
    expect(result.unchangedCount).toBe(0);
  });
});
