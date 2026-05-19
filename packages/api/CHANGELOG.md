# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.9.0](https://github.com/better-update/better-update/compare/@better-update/api@0.8.0...@better-update/api@0.9.0) (2026-05-19)

### Features

* store submissions, iOS app metadata, credentials EAS-parity rework ([4198f66](https://github.com/better-update/better-update/commit/4198f66c7171ba065c2712e0d0007a6166d4983e)) - by @trancong12102

## [0.8.0](https://github.com/better-update/better-update/compare/@better-update/api@0.7.0...@better-update/api@0.8.0) (2026-05-19)

### Features

* **builds:** mark dirty git working tree on build records ([e5d99cf](https://github.com/better-update/better-update/commit/e5d99cf2c5522ea1de04222849bc7e5c5d444ca5)) - by @trancong12102

## [0.7.0](https://github.com/better-update/better-update/compare/@better-update/api@0.6.0...@better-update/api@0.7.0) (2026-05-19)

### Features

* android multi credential sets resolvable by build profile ([7e71890](https://github.com/better-update/better-update/commit/7e718901a77df5bb180417a459870acb5751a212)) - by @trancong12102
* dashboard parity wave (fingerprints, env vars, build audience, update detail) ([d9930d7](https://github.com/better-update/better-update/commit/d9930d7575f435c120e153237dcee7f35b191d57)) - by @trancong12102
* per-update bundle size + downloads stats ([9ff1b14](https://github.com/better-update/better-update/commit/9ff1b1410104dcb0fe4fa5ddbf1b1c82ffae5959)) - by @trancong12102

## [0.6.0](https://github.com/better-update/better-update/compare/@better-update/api@0.5.0...@better-update/api@0.6.0) (2026-05-18)

### Features

* **cli:** unblock multi-target iOS builds with per-target signing + auto-provision ([b8af83b](https://github.com/better-update/better-update/commit/b8af83be500cfaca7a2532a5160afe74e6fa914a)) - by @trancong12102

## [0.5.0](https://github.com/better-update/better-update/compare/@better-update/api@0.4.0...@better-update/api@0.5.0) (2026-05-18)

### Features

* **env-vars:** rewrite to EAS-style multi-env + org-scoped vars ([ddd0995](https://github.com/better-update/better-update/commit/ddd099505d513f73b3b93a339fa64b4be819737c)) - by @trancong12102

## [0.4.0](https://github.com/better-update/better-update/compare/@better-update/api@0.3.1...@better-update/api@0.4.0) (2026-05-13)

### Features

* **cli:** fill remaining EAS-parity gaps in build, credentials, update ([ea80a9d](https://github.com/better-update/better-update/commit/ea80a9d72fb0d2ccd6b045d6ae819a77deb40cd8)) - by @trancong12102
* fill EAS CLI parity gaps (P0/P1) for builds, env, credentials, devices ([6b6b12d](https://github.com/better-update/better-update/commit/6b6b12d4ed7d1aa02f13a0de91379e3e249d2fd2)) - by @trancong12102
* move build credential generation client-side and expand CLI surface ([d1ee3b2](https://github.com/better-update/better-update/commit/d1ee3b227708cf92585070749800ce905d21e7a0)) - by @trancong12102

## [0.3.1](https://github.com/better-update/better-update/compare/@better-update/api@0.3.0...@better-update/api@0.3.1) (2026-05-07)

**Note:** Version bump only for package @better-update/api

## [0.3.0](https://github.com/better-update/better-update/compare/@better-update/api@0.2.1...@better-update/api@0.3.0) (2026-05-07)

### Features

* page-numbered pagination with sort across list endpoints ([ff90874](https://github.com/better-update/better-update/commit/ff90874474fb138e9aed36294de2029abce94d7a)) - by @trancong12102

## [0.2.1](https://github.com/better-update/better-update/compare/@better-update/api@0.2.0...@better-update/api@0.2.1) (2026-05-06)

### Bug Fixes

* **web:** harden route error handling and drop route loaders ([72808c1](https://github.com/better-update/better-update/commit/72808c17fbae3753e6f8252c626933af07d79f2f)) - by @trancong12102

## 0.2.0 (2026-05-06)

### ⚠ BREAKING CHANGES

* **web:** server env vars ACCOUNTS_URL and CONSOLE_URL are
replaced by WEB_URL. CLI config key accountsUrl and env
BETTER_UPDATE_ACCOUNTS_URL are replaced by webUrl and
BETTER_UPDATE_WEB_URL.

### Features

* add branch deletion with cascade cleanup ([6447b0b](https://github.com/better-update/better-update/commit/6447b0b1a0ea81684a6d4904f28a499787626ce1)) - by @
* add branches CRUD with project detail page and E2E tests ([624ceed](https://github.com/better-update/better-update/commit/624ceed9b000ea026ed50b2be00b5ccab47ad44c)) - by @
* add build install link API endpoint and fix create org button ([513dbbb](https://github.com/better-update/better-update/commit/513dbbb7c8b31cfbd5199010da65ddaddacc958b)) - by @
* add build registry with presigned URL upload and artifact management ([69a0ad0](https://github.com/better-update/better-update/commit/69a0ad0fd54c1273614185bf475489b4a30af717)) - by @
* add channel deletion with cache invalidation ([7586cbb](https://github.com/better-update/better-update/commit/7586cbb0cfc9a0793993e15936aa241956719323)) - by @
* add channels CRUD with project detail UI and E2E tests ([a953ed6](https://github.com/better-update/better-update/commit/a953ed66d59d7cdd23e5d9abf79ee02dbd0a124c)) - by @
* add credential vault domain schemas and HttpApiGroup (Wave 1A) ([733cda3](https://github.com/better-update/better-update/commit/733cda30b7b51d9b01cd5120a6191dffe39ac0b9)) - by @
* add deployment analytics with WAE tracking, query API, and dashboard charts ([1b3c730](https://github.com/better-update/better-update/commit/1b3c730cea3158d57b4b1d4a7ea5331a27466f55)) - by @
* add environment variables (Phase 2) ([e88b91f](https://github.com/better-update/better-update/commit/e88b91f1569c5a0f8176213c9d09f1f104140eb6)) - by @
* add Expo Updates protocol manifest serving with E2E tests ([3d4fec7](https://github.com/better-update/better-update/commit/3d4fec79f56f0bab37610ac961cf2b809eed480b)) - by @
* add project deletion with cascade cleanup ([5f494d5](https://github.com/better-update/better-update/commit/5f494d5cff7309bcb18a8a5eb7a3c378ebb546d7)) - by @
* add project rename endpoint, pagination UI, and E2E tests ([c49a45c](https://github.com/better-update/better-update/commit/c49a45c89794dc7aa982459ceaf3ac4acc9f8a0e)) - by @
* **cli,server:** integrate EAS CLI libraries, Apple auto-provisioning, and content-type-namespaced asset hashing ([ff3d881](https://github.com/better-update/better-update/commit/ff3d8812a27387e2331cc9e01741f4c01195e31a)) - by @
* cursor pagination, FTS search, and compatibility-matrix refactor ([b03ac24](https://github.com/better-update/better-update/commit/b03ac24288274621a035b069c413194f0a179441)) - by @trancong12102
* implement updates and assets CRUD with R2 uploads and dashboard UI ([70c7940](https://github.com/better-update/better-update/commit/70c7940eaf87878842f91069e21a8f7c69e844f4)) - by @
* **repo:** add ota build compatibility matrix ([a715a02](https://github.com/better-update/better-update/commit/a715a02b3130e33ffc6263203e4d08ee5f2adc17)) - by @
* **repo:** add update lifecycle and credential flows ([f55cf5d](https://github.com/better-update/better-update/commit/f55cf5dea7874540fef6c9620ab8ced7c78e872f)) - by @
* **repo:** switch uploads to direct r2 flow ([736e7f1](https://github.com/better-update/better-update/commit/736e7f17d887a773b35038119981b31195b4f510)) - by @
* **server,cli:** add build-credentials resolver with roster-hash gated profile regen ([e3a42f8](https://github.com/better-update/better-update/commit/e3a42f86eb7dfd6ec20edeafae6e1aae9c5f76ad)) - by @
* **ui:** migrate to @coss/ui ([7b00e3a](https://github.com/better-update/better-update/commit/7b00e3aedb10317e1df5b3bfb259930c3f2f3e92)) - by @trancong12102

### Bug Fixes

* address council review findings for audit log ([badcd92](https://github.com/better-update/better-update/commit/badcd92998385bf803d1be12279f6b61a307c20e)) - by @
* address council review findings for build registry ([fb09be6](https://github.com/better-update/better-update/commit/fb09be63887d9e780d61953dfd8e7f1938c3de0e)) - by @
* address council review findings for deployment analytics ([288f18f](https://github.com/better-update/better-update/commit/288f18fef4ebbf0e0d294a5a63be2af58760882b)) - by @
* address council review findings for environment variables ([d1c91dd](https://github.com/better-update/better-update/commit/d1c91ddf338231ff13ee05cb0b9cdce58ab33352)) - by @
* address remaining P2-P3 council review findings ([4d39840](https://github.com/better-update/better-update/commit/4d39840d7aee7fbddd270c8e854be88774b534dc)) - by @
* refine per-update rollout edge cases and clean up manifest repo ([b9696af](https://github.com/better-update/better-update/commit/b9696afd03141c1c53a4598d3260804c779ab383)) - by @
* **repo:** harden update publish and republish flows ([5b2a7b7](https://github.com/better-update/better-update/commit/5b2a7b7dc164baf29bbe54db83174f3a1f09b503)) - by @
* **repo:** stream update artifacts and enable signed promote flows ([4ed09f1](https://github.com/better-update/better-update/commit/4ed09f15909e44a68e597a28d00c7b0825448211)) - by @
* use literal type for audit log source field ([5046bf2](https://github.com/better-update/better-update/commit/5046bf2b21e4d3ebc297ade1d06bc29927a11a2f)) - by @

### Code Refactoring

* **web:** merge accounts + dashboard into apps/web TanStack Start SSR ([98c4e10](https://github.com/better-update/better-update/commit/98c4e10b7040f60f0a909145fc320f2bf1355907)) - by @trancong12102

## [0.1.1](https://github.com/better-update/better-update/compare/@better-update/api@0.1.0...@better-update/api@0.1.1) (2026-04-22)

**Note:** Version bump only for package @better-update/api

## 0.1.0 (2026-04-21)

### Features

* add branch deletion with cascade cleanup ([6447b0b](https://github.com/better-update/better-update/commit/6447b0b1a0ea81684a6d4904f28a499787626ce1)) - by @trancong12102
* add branches CRUD with project detail page and E2E tests ([624ceed](https://github.com/better-update/better-update/commit/624ceed9b000ea026ed50b2be00b5ccab47ad44c)) - by @trancong12102
* add build install link API endpoint and fix create org button ([513dbbb](https://github.com/better-update/better-update/commit/513dbbb7c8b31cfbd5199010da65ddaddacc958b)) - by @trancong12102
* add build registry with presigned URL upload and artifact management ([69a0ad0](https://github.com/better-update/better-update/commit/69a0ad0fd54c1273614185bf475489b4a30af717)) - by @trancong12102
* add channel deletion with cache invalidation ([7586cbb](https://github.com/better-update/better-update/commit/7586cbb0cfc9a0793993e15936aa241956719323)) - by @trancong12102
* add channels CRUD with project detail UI and E2E tests ([a953ed6](https://github.com/better-update/better-update/commit/a953ed66d59d7cdd23e5d9abf79ee02dbd0a124c)) - by @trancong12102
* add credential vault domain schemas and HttpApiGroup (Wave 1A) ([733cda3](https://github.com/better-update/better-update/commit/733cda30b7b51d9b01cd5120a6191dffe39ac0b9)) - by @trancong12102
* add deployment analytics with WAE tracking, query API, and dashboard charts ([1b3c730](https://github.com/better-update/better-update/commit/1b3c730cea3158d57b4b1d4a7ea5331a27466f55)) - by @trancong12102
* add environment variables (Phase 2) ([e88b91f](https://github.com/better-update/better-update/commit/e88b91f1569c5a0f8176213c9d09f1f104140eb6)) - by @trancong12102
* add Expo Updates protocol manifest serving with E2E tests ([3d4fec7](https://github.com/better-update/better-update/commit/3d4fec79f56f0bab37610ac961cf2b809eed480b)) - by @trancong12102
* add project deletion with cascade cleanup ([5f494d5](https://github.com/better-update/better-update/commit/5f494d5cff7309bcb18a8a5eb7a3c378ebb546d7)) - by @trancong12102
* add project rename endpoint, pagination UI, and E2E tests ([c49a45c](https://github.com/better-update/better-update/commit/c49a45c89794dc7aa982459ceaf3ac4acc9f8a0e)) - by @trancong12102
* **cli,server:** integrate EAS CLI libraries, Apple auto-provisioning, and content-type-namespaced asset hashing ([ff3d881](https://github.com/better-update/better-update/commit/ff3d8812a27387e2331cc9e01741f4c01195e31a)) - by @trancong12102
* implement updates and assets CRUD with R2 uploads and dashboard UI ([70c7940](https://github.com/better-update/better-update/commit/70c7940eaf87878842f91069e21a8f7c69e844f4)) - by @trancong12102
* **repo:** add ota build compatibility matrix ([a715a02](https://github.com/better-update/better-update/commit/a715a02b3130e33ffc6263203e4d08ee5f2adc17)) - by @trancong12102
* **repo:** add update lifecycle and credential flows ([f55cf5d](https://github.com/better-update/better-update/commit/f55cf5dea7874540fef6c9620ab8ced7c78e872f)) - by @trancong12102
* **repo:** switch uploads to direct r2 flow ([736e7f1](https://github.com/better-update/better-update/commit/736e7f17d887a773b35038119981b31195b4f510)) - by @trancong12102
* **server,cli:** add build-credentials resolver with roster-hash gated profile regen ([e3a42f8](https://github.com/better-update/better-update/commit/e3a42f86eb7dfd6ec20edeafae6e1aae9c5f76ad)) - by @trancong12102

### Bug Fixes

* address council review findings for audit log ([badcd92](https://github.com/better-update/better-update/commit/badcd92998385bf803d1be12279f6b61a307c20e)) - by @trancong12102
* address council review findings for build registry ([fb09be6](https://github.com/better-update/better-update/commit/fb09be63887d9e780d61953dfd8e7f1938c3de0e)) - by @trancong12102
* address council review findings for deployment analytics ([288f18f](https://github.com/better-update/better-update/commit/288f18fef4ebbf0e0d294a5a63be2af58760882b)) - by @trancong12102
* address council review findings for environment variables ([d1c91dd](https://github.com/better-update/better-update/commit/d1c91ddf338231ff13ee05cb0b9cdce58ab33352)) - by @trancong12102
* address remaining P2-P3 council review findings ([4d39840](https://github.com/better-update/better-update/commit/4d39840d7aee7fbddd270c8e854be88774b534dc)) - by @trancong12102
* refine per-update rollout edge cases and clean up manifest repo ([b9696af](https://github.com/better-update/better-update/commit/b9696afd03141c1c53a4598d3260804c779ab383)) - by @trancong12102
* **repo:** harden update publish and republish flows ([5b2a7b7](https://github.com/better-update/better-update/commit/5b2a7b7dc164baf29bbe54db83174f3a1f09b503)) - by @trancong12102
* **repo:** stream update artifacts and enable signed promote flows ([4ed09f1](https://github.com/better-update/better-update/commit/4ed09f15909e44a68e597a28d00c7b0825448211)) - by @trancong12102
* use literal type for audit log source field ([5046bf2](https://github.com/better-update/better-update/commit/5046bf2b21e4d3ebc297ade1d06bc29927a11a2f)) - by @trancong12102
