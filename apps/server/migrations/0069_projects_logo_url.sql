-- Optional per-project logo. `logo_url` NULL = no logo (the dashboard falls back to
-- the colour-coded initial avatar). When set, it is an absolute, public URL on the
-- asset CDN (e.g. `${ASSET_CDN_URL}/logos/{projectId}?v=...`); the bytes live in the
-- assets R2 bucket under `logos/{projectId}` and the `?v=` token busts the CDN cache
-- on replace. Additive, nullable column — keeps the live mixed-version CLI/server
-- fleet backward compatible.
ALTER TABLE "projects" ADD COLUMN "logo_url" TEXT;
