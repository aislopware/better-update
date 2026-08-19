import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// eslint-disable-next-line node/no-top-level-await -- vitest awaits setup modules before any test runs; workerd never loads this through require(esm)
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
