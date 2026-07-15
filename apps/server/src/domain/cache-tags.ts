// Cache-Tag values for responses stored by Workers Cache (the HTTP cache in
// front of the Worker — `cache.enabled` in wrangler.jsonc). Tagging is what
// makes user-initiated deletion able to actively purge stored copies via
// `ctx.cache.purge({ tags })` (see cloudflare/workers-cache.ts); without a tag
// an immutable-cached bundle would survive until TTL/LRU eviction.
//
// Tag grammar: printable ASCII, no spaces, ≤1024 chars each (zone Cache-Tag
// rules apply to Workers Cache). Update ids are lowercased so the emit side
// (URL path param) and the purge side (D1 row id) always produce the same tag
// regardless of UUID casing.

export const projectCacheTag = (projectId: string) => `project:${projectId}`;

export const updateCacheTag = (updateId: string) => `update:${updateId.toLowerCase()}`;

export const bundleCacheTags = (params: {
  readonly projectId: string;
  readonly updateId: string;
}): readonly string[] => [projectCacheTag(params.projectId), updateCacheTag(params.updateId)];
