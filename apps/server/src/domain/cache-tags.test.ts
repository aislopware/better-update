import { bundleCacheTags, projectCacheTag, updateCacheTag } from "./cache-tags";

// Emit side (handlers/bundle.ts builds Cache-Tag from URL path params) and
// purge side (handlers/update-delete.ts builds tags from D1 row ids) must
// produce identical tags or a purge silently misses the stored copy — the
// lowercasing below is the invariant under test.

describe("cache-tags", () => {
  it("namespaces project and update tags distinctly", () => {
    expect(projectCacheTag("proj-1")).toBe("project:proj-1");
    expect(updateCacheTag("aaaa1111-0000-0000-0000-000000000000")).toBe(
      "update:aaaa1111-0000-0000-0000-000000000000",
    );
  });

  it("lowercases update ids so URL-cased and DB-cased ids purge the same tag", () => {
    expect(updateCacheTag("AAAA1111-0000-0000-0000-000000000000")).toBe(
      updateCacheTag("aaaa1111-0000-0000-0000-000000000000"),
    );
  });

  it("bundleCacheTags emits space-free tags (zone Cache-Tag grammar)", () => {
    const tags = bundleCacheTags({ projectId: "proj-1", updateId: "U-1" });
    expect(tags).toStrictEqual(["project:proj-1", "update:u-1"]);
    for (const tag of tags) {
      expect(tag).not.toMatch(/\s/u);
    }
  });
});
