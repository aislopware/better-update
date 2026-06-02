# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.20.0](https://github.com/better-update/better-update/compare/@better-update/server@0.19.0...@better-update/server@0.20.0) (2026-06-02)

### Features

* **auth:** superadmin-gated user approval for dev phase ([69f97e3](https://github.com/better-update/better-update/commit/69f97e3ab39436f97decd3fca454d63e9ec794bb)) - by @trancong12102

## [0.19.0](https://github.com/better-update/better-update/compare/@better-update/server@0.18.0...@better-update/server@0.19.0) (2026-06-01)

### Features

* **auth:** add Google OAuth sign-in alongside GitHub ([3606f0b](https://github.com/better-update/better-update/commit/3606f0be72e8b16031411dd71391af552ddecdc0)) - by @trancong12102

## [0.18.0](https://github.com/better-update/better-update/compare/@better-update/server@0.17.0...@better-update/server@0.18.0) (2026-06-01)

### Features

* **ota:** server-side signature policy, bundle-diffing hardening, self-verify harness ([6caca42](https://github.com/better-update/better-update/commit/6caca42031007cdffb7bd4e86896c1c4a82d16d1)) - by @trancong12102
* **server:** add clock-skew guard, scope-key + signed-update recency invariant ([ae0eec5](https://github.com/better-update/better-update/commit/ae0eec571e0216b420aea77ac32acf389186df63)) - by @trancong12102
* **server:** bsdiff A-IM patch content-negotiation + static R2 patch serving ([30c60ab](https://github.com/better-update/better-update/commit/30c60ab088df1b2c85ac503095d41ccd61f49ca5)) - by @trancong12102
* **server:** manifest serving — filters, anti-brick skip, full branch-mapping evaluator ([9e44fa7](https://github.com/better-update/better-update/commit/9e44fa722c63bde47c9c25387ca195cab647cece)) - by @trancong12102
* **server:** OTA retention reaper (updates + assets + patch blobs) ([72a0e25](https://github.com/better-update/better-update/commit/72a0e2531b29dd94978793efdd68eb62e2856d5e)) - by @trancong12102
* **server:** per-scopeKey metadata storage + tenant-isolated manifest cache ([589103c](https://github.com/better-update/better-update/commit/589103cad29f2174878d7a6c7e533d240ae8e162)) - by @trancong12102
* **server:** publish-time code-signing verify + embedded-id pinning + git provenance + opt-in 226 ([b135fa1](https://github.com/better-update/better-update/commit/b135fa12e7c78d3863f5b5564b950ad414d3a53e)) - by @trancong12102

### Bug Fixes

* **lint:** use default node:path import for oxlint 1.67 import-style ([3983aba](https://github.com/better-update/better-update/commit/3983aba521b86b54813c7756b99ed4d8ef39627e)) - by @trancong12102

## [0.17.0](https://github.com/better-update/better-update/compare/@better-update/server@0.16.0...@better-update/server@0.17.0) (2026-05-28)

### ⚠ BREAKING CHANGES

* **env-vars:** migration 0049 recreates env_vars without a plaintext value
column; existing env var data is dropped and must be re-set via the CLI.
* **env-vars:** env vars are keyed by (scope, key, environment) with a
per-environment value; existing rows are recreated empty (no data migration).

### Features

* **env-vars:** end-to-end encrypt + version environment variables ([#9](https://github.com/better-update/better-update/issues/9)) ([7062a44](https://github.com/better-update/better-update/commit/7062a4448d8640bdcc41de7d2dcf86cb8259662a)) - by @trancong12102
* **env-vars:** scope env var uniqueness to (key, environment) ([8394cab](https://github.com/better-update/better-update/commit/8394cab2aee4d97f9146a439e09096ba5ab0ef48)) - by @trancong12102

## [0.16.0](https://github.com/better-update/better-update/compare/@better-update/server@0.15.2...@better-update/server@0.16.0) (2026-05-27)

### Features

* **auth:** authenticate the CLI with Better Auth sessions ([61444d2](https://github.com/better-update/better-update/commit/61444d28ad50acf60d37877f7ccb10b38c33df0f)) - by @trancong12102

## [0.15.2](https://github.com/better-update/better-update/compare/@better-update/server@0.15.1...@better-update/server@0.15.2) (2026-05-21)

**Note:** Version bump only for package @better-update/server

## [0.15.1](https://github.com/better-update/better-update/compare/@better-update/server@0.15.0...@better-update/server@0.15.1) (2026-05-21)

**Note:** Version bump only for package @better-update/server

## [0.15.0](https://github.com/better-update/better-update/compare/@better-update/server@0.14.0...@better-update/server@0.15.0) (2026-05-21)

### Features

* client-side E2E encrypted credential vault ([6e36671](https://github.com/better-update/better-update/commit/6e3667168e57a90a422b389f3e6337a13f8dddc4)) - by @trancong12102

## [0.14.0](https://github.com/better-update/better-update/compare/@better-update/server@0.13.0...@better-update/server@0.14.0) (2026-05-19)

### Features

* store submissions, iOS app metadata, credentials EAS-parity rework ([4198f66](https://github.com/better-update/better-update/commit/4198f66c7171ba065c2712e0d0007a6166d4983e)) - by @trancong12102

## [0.13.0](https://github.com/better-update/better-update/compare/@better-update/server@0.12.0...@better-update/server@0.13.0) (2026-05-19)

### Features

* **server:** seed production/staging/preview branches and channels on project create ([cb5bc4b](https://github.com/better-update/better-update/commit/cb5bc4b512dd0c7212a2c1df6893dc8c67e8c1f8)) - by @trancong12102

## [0.12.0](https://github.com/better-update/better-update/compare/@better-update/server@0.11.0...@better-update/server@0.12.0) (2026-05-19)

### Features

* **builds:** mark dirty git working tree on build records ([e5d99cf](https://github.com/better-update/better-update/commit/e5d99cf2c5522ea1de04222849bc7e5c5d444ca5)) - by @trancong12102

## [0.11.0](https://github.com/better-update/better-update/compare/@better-update/server@0.10.1...@better-update/server@0.11.0) (2026-05-19)

### Features

* android multi credential sets resolvable by build profile ([7e71890](https://github.com/better-update/better-update/commit/7e718901a77df5bb180417a459870acb5751a212)) - by @trancong12102
* dashboard parity wave (fingerprints, env vars, build audience, update detail) ([d9930d7](https://github.com/better-update/better-update/commit/d9930d7575f435c120e153237dcee7f35b191d57)) - by @trancong12102
* per-update bundle size + downloads stats ([9ff1b14](https://github.com/better-update/better-update/commit/9ff1b1410104dcb0fe4fa5ddbf1b1c82ffae5959)) - by @trancong12102

## [0.10.1](https://github.com/better-update/better-update/compare/@better-update/server@0.10.0...@better-update/server@0.10.1) (2026-05-18)

### Bug Fixes

* **server,cli:** fall back to org+team ASC key when bundle config has none bound ([41671aa](https://github.com/better-update/better-update/commit/41671aaed30332a133138b47dac5e4d9311030ac)) - by @trancong12102

## [0.10.0](https://github.com/better-update/better-update/compare/@better-update/server@0.9.0...@better-update/server@0.10.0) (2026-05-18)

### Features

* **cli:** unblock multi-target iOS builds with per-target signing + auto-provision ([b8af83b](https://github.com/better-update/better-update/commit/b8af83be500cfaca7a2532a5160afe74e6fa914a)) - by @trancong12102

## [0.9.0](https://github.com/better-update/better-update/compare/@better-update/server@0.8.0...@better-update/server@0.9.0) (2026-05-18)

### ⚠ BREAKING CHANGES

* **env-vars:** drop encryption, render sensitive values with reveal + copy

### Features

* **cli:** add Apple ID iOS credentials flow + env lookup-by-key + interactive publish picker ([4dd34d3](https://github.com/better-update/better-update/commit/4dd34d3895ea8613eb4f2a9cd03f07001bea0b67)) - by @trancong12102
* **env-vars:** drop encryption, render sensitive values with reveal + copy ([4176a46](https://github.com/better-update/better-update/commit/4176a46cb642a0ef611e12f0a28bd548de0fc8ef)) - by @trancong12102

## [0.8.0](https://github.com/better-update/better-update/compare/@better-update/server@0.7.1...@better-update/server@0.8.0) (2026-05-18)

### Features

* **env-vars:** rewrite to EAS-style multi-env + org-scoped vars ([ddd0995](https://github.com/better-update/better-update/commit/ddd099505d513f73b3b93a339fa64b4be819737c)) - by @trancong12102

## [0.7.1](https://github.com/better-update/better-update/compare/@better-update/server@0.7.0...@better-update/server@0.7.1) (2026-05-15)

**Note:** Version bump only for package @better-update/server

## [0.7.0](https://github.com/better-update/better-update/compare/@better-update/server@0.6.1...@better-update/server@0.7.0) (2026-05-13)

### Features

* **cli:** fill remaining EAS-parity gaps in build, credentials, update ([ea80a9d](https://github.com/better-update/better-update/commit/ea80a9d72fb0d2ccd6b045d6ae819a77deb40cd8)) - by @trancong12102
* fill EAS CLI parity gaps (P0/P1) for builds, env, credentials, devices ([6b6b12d](https://github.com/better-update/better-update/commit/6b6b12d4ed7d1aa02f13a0de91379e3e249d2fd2)) - by @trancong12102
* move build credential generation client-side and expand CLI surface ([d1ee3b2](https://github.com/better-update/better-update/commit/d1ee3b227708cf92585070749800ce905d21e7a0)) - by @trancong12102

## [0.6.1](https://github.com/better-update/better-update/compare/@better-update/server@0.6.0...@better-update/server@0.6.1) (2026-05-07)

### Bug Fixes

* **server:** correct gc-utils cutoff bounds assertion ([ffaf417](https://github.com/better-update/better-update/commit/ffaf41736727ace0337c927f707c734dae7e8ca6)) - by @trancong12102

## [0.6.0](https://github.com/better-update/better-update/compare/@better-update/server@0.5.0...@better-update/server@0.6.0) (2026-05-07)

### Features

* send transactional invite emails via Cloudflare Email Service ([3b4e80c](https://github.com/better-update/better-update/commit/3b4e80c4e05d97a4f670db0ac29c95bc36ef6e85)) - by @trancong12102

## [0.5.0](https://github.com/better-update/better-update/compare/@better-update/server@0.4.1...@better-update/server@0.5.0) (2026-05-07)

### Features

* page-numbered pagination with sort across list endpoints ([ff90874](https://github.com/better-update/better-update/commit/ff90874474fb138e9aed36294de2029abce94d7a)) - by @trancong12102

## [0.4.1](https://github.com/better-update/better-update/compare/@better-update/server@0.4.0...@better-update/server@0.4.1) (2026-05-06)

### Bug Fixes

* **web:** harden route error handling and drop route loaders ([72808c1](https://github.com/better-update/better-update/commit/72808c17fbae3753e6f8252c626933af07d79f2f)) - by @trancong12102

## [0.4.0](https://github.com/better-update/better-update/compare/@better-update/server@0.3.3...@better-update/server@0.4.0) (2026-05-06)

### ⚠ BREAKING CHANGES

* merge api + web onto single domain (better-update.dev)
* **web:** server env vars ACCOUNTS_URL and CONSOLE_URL are
replaced by WEB_URL. CLI config key accountsUrl and env
BETTER_UPDATE_ACCOUNTS_URL are replaced by webUrl and
BETTER_UPDATE_WEB_URL.

### Features

* cursor pagination, FTS search, and compatibility-matrix refactor ([b03ac24](https://github.com/better-update/better-update/commit/b03ac24288274621a035b069c413194f0a179441)) - by @trancong12102
* **ui:** migrate to @coss/ui ([7b00e3a](https://github.com/better-update/better-update/commit/7b00e3aedb10317e1df5b3bfb259930c3f2f3e92)) - by @trancong12102

### Bug Fixes

* **server:** harden credential plist parsing ([562e9ac](https://github.com/better-update/better-update/commit/562e9acd81936c87f515c7c5b7c89155d350f35b)) - by @trancong12102

### Code Refactoring

* merge api + web onto single domain (better-update.dev) ([63acb2e](https://github.com/better-update/better-update/commit/63acb2ec54d3cfaafbfc68baebf9c0a770ced7c0)) - by @trancong12102
* **web:** merge accounts + dashboard into apps/web TanStack Start SSR ([98c4e10](https://github.com/better-update/better-update/commit/98c4e10b7040f60f0a909145fc320f2bf1355907)) - by @trancong12102

## [0.3.3](https://github.com/better-update/better-update/compare/@better-update/server@0.3.2...@better-update/server@0.3.3) (2026-04-22)

### Bug Fixes

* **server:** use PUBLIC_API_URL for install/registration origins ([395bfae](https://github.com/better-update/better-update/commit/395bfae8d70cb193de9b72c9df1d23a2b3f86087)) - by @trancong12102

## [0.3.2](https://github.com/better-update/better-update/compare/@better-update/server@0.3.1...@better-update/server@0.3.2) (2026-04-22)

**Note:** Version bump only for package @better-update/server

## [0.3.1](https://github.com/better-update/better-update/compare/@better-update/server@0.3.0...@better-update/server@0.3.1) (2026-04-22)

**Note:** Version bump only for package @better-update/server

## [0.3.0](https://github.com/better-update/better-update/compare/@better-update/server@0.2.1...@better-update/server@0.3.0) (2026-04-22)

### Features

* **apps:** add repository metadata to app manifests ([c9cd84b](https://github.com/better-update/better-update/commit/c9cd84b8dd8c0f57f262d92b76cc19aa4fcdf6d9)) - by @trancong12102

## [0.2.2](https://github.com/better-update/better-update/compare/@better-update/server@0.2.1...@better-update/server@0.2.2) (2026-04-22)

**Note:** Version bump only for package @better-update/server

## [0.2.1](https://github.com/better-update/better-update/compare/@better-update/server@0.2.0...@better-update/server@0.2.1) (2026-04-22)

**Note:** Version bump only for package @better-update/server

## [0.2.0](https://github.com/better-update/better-update/compare/@better-update/server@0.1.0...@better-update/server@0.2.0) (2026-04-22)

### Features

* **accounts:** github-only login redesign + dashboard→console split cleanup ([121f822](https://github.com/better-update/better-update/commit/121f822bcfd9e379d23d4d6b3e5c01849cf625d1)) - by @trancong12102
* **deploy:** auto-deploy wrangler apps on release tag ([4e1912c](https://github.com/better-update/better-update/commit/4e1912c0d59d52a5028d6ddd61e4407309584643)) - by @trancong12102

### Bug Fixes

* **server:** disable Vite dev CORS so Worker owns preflight ([5ada572](https://github.com/better-update/better-update/commit/5ada572e2065004aeb6ff74a16ddd0c421717811)) - by @trancong12102

## 0.1.0 (2026-04-21)

### Features

* add audit log dashboard page and handler integration ([9227ed2](https://github.com/better-update/better-update/commit/9227ed2fc2fc02e10b0885a81c415098b343914a)) - by @trancong12102
* add branch deletion with cascade cleanup ([6447b0b](https://github.com/better-update/better-update/commit/6447b0b1a0ea81684a6d4904f28a499787626ce1)) - by @trancong12102
* add branch/channel delete UI, rollout target guard, and E2E tests ([9a3f26d](https://github.com/better-update/better-update/commit/9a3f26d7a3c775fd96e963f99d970eaace41dcc5)) - by @trancong12102
* add branches CRUD with project detail page and E2E tests ([624ceed](https://github.com/better-update/better-update/commit/624ceed9b000ea026ed50b2be00b5ccab47ad44c)) - by @trancong12102
* add build install link API endpoint and fix create org button ([513dbbb](https://github.com/better-update/better-update/commit/513dbbb7c8b31cfbd5199010da65ddaddacc958b)) - by @trancong12102
* add build registry with presigned URL upload and artifact management ([69a0ad0](https://github.com/better-update/better-update/commit/69a0ad0fd54c1273614185bf475489b4a30af717)) - by @trancong12102
* add bundle diffing data layer (migration, repos, protocol headers, extensions) ([31f8311](https://github.com/better-update/better-update/commit/31f8311917b07e69b76db8c9e4d7bcc02903f0ef)) - by @trancong12102
* add channel deletion with cache invalidation ([7586cbb](https://github.com/better-update/better-update/commit/7586cbb0cfc9a0793993e15936aa241956719323)) - by @trancong12102
* add channels CRUD with project detail UI and E2E tests ([a953ed6](https://github.com/better-update/better-update/commit/a953ed66d59d7cdd23e5d9abf79ee02dbd0a124c)) - by @trancong12102
* add CLI update publish command ([5f4268a](https://github.com/better-update/better-update/commit/5f4268a90bacb8a231bbc98ca92bd70452bcf02c)) - by @trancong12102
* add credential repository, handler, and wire into server entry point ([d69c919](https://github.com/better-update/better-update/commit/d69c919e06be5e5c35c30f78cf2bd844a726d3a4)) - by @trancong12102
* add credential vault foundation (migration, encryption, RBAC) ([59dc591](https://github.com/better-update/better-update/commit/59dc591640c27c01ce6b0f8cec536a2e18ca5edd)) - by @trancong12102
* add deployment analytics with WAE tracking, query API, and dashboard charts ([1b3c730](https://github.com/better-update/better-update/commit/1b3c730cea3158d57b4b1d4a7ea5331a27466f55)) - by @trancong12102
* add environment variables (Phase 2) ([e88b91f](https://github.com/better-update/better-update/commit/e88b91f1569c5a0f8176213c9d09f1f104140eb6)) - by @trancong12102
* add Expo Updates protocol manifest serving with E2E tests ([3d4fec7](https://github.com/better-update/better-update/commit/3d4fec79f56f0bab37610ac961cf2b809eed480b)) - by @trancong12102
* add L1 Cache API for manifest response caching ([32404fe](https://github.com/better-update/better-update/commit/32404feff6821a46c590f016c3a1976d980cfc93)) - by @trancong12102
* add per-update rollout resolution domain layer and repository methods ([1d78352](https://github.com/better-update/better-update/commit/1d78352357173ffd63611cc9b5155ad5a3c53c6f)) - by @trancong12102
* add project deletion with cascade cleanup ([5f494d5](https://github.com/better-update/better-update/commit/5f494d5cff7309bcb18a8a5eb7a3c378ebb546d7)) - by @trancong12102
* add project rename endpoint, pagination UI, and E2E tests ([c49a45c](https://github.com/better-update/better-update/commit/c49a45c89794dc7aa982459ceaf3ac4acc9f8a0e)) - by @trancong12102
* add public asset download endpoint with edge caching ([3cc7a77](https://github.com/better-update/better-update/commit/3cc7a77535a98fd546c288125de8517a97e80b23)) - by @trancong12102
* add user account management page ([6216644](https://github.com/better-update/better-update/commit/6216644b8fb8cb82ce12ab3fa5cce04812e3edc9)) - by @trancong12102
* **cli,server,dashboard:** close EAS Update feature gaps ([#4](https://github.com/better-update/better-update/issues/4), [#6](https://github.com/better-update/better-update/issues/6), [#7](https://github.com/better-update/better-update/issues/7), [#2](https://github.com/better-update/better-update/issues/2)) ([ecdc224](https://github.com/better-update/better-update/commit/ecdc22423f4117ab27ddac15e175329bf50c1031)) - by @trancong12102
* **cli,server:** integrate EAS CLI libraries, Apple auto-provisioning, and content-type-namespaced asset hashing ([ff3d881](https://github.com/better-update/better-update/commit/ff3d8812a27387e2331cc9e01741f4c01195e31a)) - by @trancong12102
* evaluate branch mapping in manifest resolution ([6273f5b](https://github.com/better-update/better-update/commit/6273f5b3918b3a5a36bf99884cae19bd760ac0d2)) - by @trancong12102
* implement branch rollout management API ([bfa16f9](https://github.com/better-update/better-update/commit/bfa16f97d6b81483e024717000d253973ca2968c)) - by @trancong12102
* implement bundle diffing handler integration ([6d644ac](https://github.com/better-update/better-update/commit/6d644acb88ee4de2e6e64cbb54fc9d80fdc7ca12)) - by @trancong12102
* implement extra params parsing, echo, and analytics tracking ([f258ad6](https://github.com/better-update/better-update/commit/f258ad6c336fd5a46925cf85ac2422928c08fdb2)) - by @trancong12102
* implement updates and assets CRUD with R2 uploads and dashboard UI ([70c7940](https://github.com/better-update/better-update/commit/70c7940eaf87878842f91069e21a8f7c69e844f4)) - by @trancong12102
* integrate per-update rollout resolution into manifest serving ([77305c8](https://github.com/better-update/better-update/commit/77305c8212fb2d24b5f9995b345bdd9959d0774e)) - by @trancong12102
* **repo:** add ota build compatibility matrix ([a715a02](https://github.com/better-update/better-update/commit/a715a02b3130e33ffc6263203e4d08ee5f2adc17)) - by @trancong12102
* **repo:** add rollback-to-embedded flows ([f5fe1c4](https://github.com/better-update/better-update/commit/f5fe1c439ad7424dc671d84a7b81721e9b6976ad)) - by @trancong12102
* **repo:** add update lifecycle and credential flows ([f55cf5d](https://github.com/better-update/better-update/commit/f55cf5dea7874540fef6c9620ab8ced7c78e872f)) - by @trancong12102
* **repo:** expand build management coverage and dashboard details ([96d8d11](https://github.com/better-update/better-update/commit/96d8d11c41a171d67a3dad82d936c924a3e614c7)) - by @trancong12102
* **repo:** switch uploads to direct r2 flow ([736e7f1](https://github.com/better-update/better-update/commit/736e7f17d887a773b35038119981b31195b4f510)) - by @trancong12102
* **server,cli:** add build-credentials resolver with roster-hash gated profile regen ([e3a42f8](https://github.com/better-update/better-update/commit/e3a42f86eb7dfd6ec20edeafae6e1aae9c5f76ad)) - by @trancong12102
* **server:** add structured JSON logging and enforce no-console rule ([3641e41](https://github.com/better-update/better-update/commit/3641e410d9c837c05e525bd20539fdd36fe3cb99)) - by @trancong12102
* **server:** harden publish path coordination ([3bf4d98](https://github.com/better-update/better-update/commit/3bf4d985131b3182b9506bd95d55a1566a8f545e)) - by @trancong12102

### Bug Fixes

* address council review findings for audit log ([badcd92](https://github.com/better-update/better-update/commit/badcd92998385bf803d1be12279f6b61a307c20e)) - by @trancong12102
* address council review findings for branch rollout ([ae369e0](https://github.com/better-update/better-update/commit/ae369e00417388a73a8048e81736c9fe0a7c8347)) - by @trancong12102
* address council review findings for build registry ([fb09be6](https://github.com/better-update/better-update/commit/fb09be63887d9e780d61953dfd8e7f1938c3de0e)) - by @trancong12102
* address council review findings for deployment analytics ([288f18f](https://github.com/better-update/better-update/commit/288f18fef4ebbf0e0d294a5a63be2af58760882b)) - by @trancong12102
* address council review findings for environment variables ([d1c91dd](https://github.com/better-update/better-update/commit/d1c91ddf338231ff13ee05cb0b9cdce58ab33352)) - by @trancong12102
* address council review findings for install link and org dialog ([1f637ac](https://github.com/better-update/better-update/commit/1f637ac9bf137665e4214b83393256a65dedadff)) - by @trancong12102
* address council review findings for manifest cache ([3e08f1f](https://github.com/better-update/better-update/commit/3e08f1f74893f51fd8599efd69db2d346f88e5c0)) - by @trancong12102
* address P1-P2 council review findings for credential vault ([dcbc47d](https://github.com/better-update/better-update/commit/dcbc47d5e422cd3d6fb625e004d766f83ed8eff1)) - by @trancong12102
* address remaining P2-P3 council review findings ([4d39840](https://github.com/better-update/better-update/commit/4d39840d7aee7fbddd270c8e854be88774b534dc)) - by @trancong12102
* move env-specific vars from wrangler.jsonc to .env ([5c4da1b](https://github.com/better-update/better-update/commit/5c4da1b1866f2165012ce905df564c74cc4d00c7)) - by @trancong12102
* refine per-update rollout edge cases and clean up manifest repo ([b9696af](https://github.com/better-update/better-update/commit/b9696afd03141c1c53a4598d3260804c779ab383)) - by @trancong12102
* **repo:** add knip dead code detection, fix timing-safe HMAC verification ([ef3e3b6](https://github.com/better-update/better-update/commit/ef3e3b6c6d936e85346ed2b0f53941e92cc8d226)) - by @trancong12102
* **repo:** harden update publish and republish flows ([5b2a7b7](https://github.com/better-update/better-update/commit/5b2a7b7dc164baf29bbe54db83174f3a1f09b503)) - by @trancong12102
* **repo:** stream update artifacts and enable signed promote flows ([4ed09f1](https://github.com/better-update/better-update/commit/4ed09f15909e44a68e597a28d00c7b0825448211)) - by @trancong12102
* **server:** harden auth, deduplicate code, and fix council review findings ([f268f01](https://github.com/better-update/better-update/commit/f268f01574ee31e1f7094f1cf37fb0b660067ca0)) - by @trancong12102
* **server:** implement expo-current-update-id 204 short-circuit and reduce response copies ([021c6a7](https://github.com/better-update/better-update/commit/021c6a7a5258da87baefcf9947159eea386d9849)) - by @trancong12102
* set ASSET_CDN_URL in E2E env to restore manifest-serving test ([53bc847](https://github.com/better-update/better-update/commit/53bc847550f4711a5ca2b9d2c48099b8b24ab78a)) - by @trancong12102
* use literal type for audit log source field ([5046bf2](https://github.com/better-update/better-update/commit/5046bf2b21e4d3ebc297ade1d06bc29927a11a2f)) - by @trancong12102
* wrap Uint8Array params with asBuffer for tsgo BufferSource compat ([01d6cc3](https://github.com/better-update/better-update/commit/01d6cc308cb9c4cfdf7cc7984ab1cbeea8f2deca)) - by @trancong12102
