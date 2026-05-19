# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.7.0](https://github.com/better-update/better-update/compare/@better-update/api-client@0.6.2...@better-update/api-client@0.7.0) (2026-05-19)

### Features

* store submissions, iOS app metadata, credentials EAS-parity rework ([4198f66](https://github.com/better-update/better-update/commit/4198f66c7171ba065c2712e0d0007a6166d4983e)) - by @trancong12102

## [0.6.2](https://github.com/better-update/better-update/compare/@better-update/api-client@0.6.1...@better-update/api-client@0.6.2) (2026-05-19)

### Bug Fixes

* **api-client:** surface real error message from unmapped Effect.tryPromise wrappers ([39421f9](https://github.com/better-update/better-update/commit/39421f93a9bc07b1df0da86f8e8cb3eae5a56408)) - by @trancong12102

## [0.6.1](https://github.com/better-update/better-update/compare/@better-update/api-client@0.6.0...@better-update/api-client@0.6.1) (2026-05-19)

**Note:** Version bump only for package @better-update/api-client

## [0.6.0](https://github.com/better-update/better-update/compare/@better-update/api-client@0.5.1...@better-update/api-client@0.6.0) (2026-05-19)

### Features

* dashboard parity wave (fingerprints, env vars, build audience, update detail) ([d9930d7](https://github.com/better-update/better-update/commit/d9930d7575f435c120e153237dcee7f35b191d57)) - by @trancong12102

## [0.5.1](https://github.com/better-update/better-update/compare/@better-update/api-client@0.5.0...@better-update/api-client@0.5.1) (2026-05-18)

**Note:** Version bump only for package @better-update/api-client

## [0.5.0](https://github.com/better-update/better-update/compare/@better-update/api-client@0.4.0...@better-update/api-client@0.5.0) (2026-05-18)

### Features

* **env-vars:** rewrite to EAS-style multi-env + org-scoped vars ([ddd0995](https://github.com/better-update/better-update/commit/ddd099505d513f73b3b93a339fa64b4be819737c)) - by @trancong12102

## [0.4.0](https://github.com/better-update/better-update/compare/@better-update/api-client@0.3.1...@better-update/api-client@0.4.0) (2026-05-13)

### Features

* move build credential generation client-side and expand CLI surface ([d1ee3b2](https://github.com/better-update/better-update/commit/d1ee3b227708cf92585070749800ce905d21e7a0)) - by @trancong12102

## [0.3.1](https://github.com/better-update/better-update/compare/@better-update/api-client@0.3.0...@better-update/api-client@0.3.1) (2026-05-07)

**Note:** Version bump only for package @better-update/api-client

## [0.3.0](https://github.com/better-update/better-update/compare/@better-update/api-client@0.2.1...@better-update/api-client@0.3.0) (2026-05-07)

### Features

* page-numbered pagination with sort across list endpoints ([ff90874](https://github.com/better-update/better-update/commit/ff90874474fb138e9aed36294de2029abce94d7a)) - by @trancong12102

## [0.2.1](https://github.com/better-update/better-update/compare/@better-update/api-client@0.2.0...@better-update/api-client@0.2.1) (2026-05-06)

**Note:** Version bump only for package @better-update/api-client

## 0.2.0 (2026-05-06)

### ⚠ BREAKING CHANGES

* **web:** server env vars ACCOUNTS_URL and CONSOLE_URL are
replaced by WEB_URL. CLI config key accountsUrl and env
BETTER_UPDATE_ACCOUNTS_URL are replaced by webUrl and
BETTER_UPDATE_WEB_URL.

### Features

* add branch/channel delete UI, rollout target guard, and E2E tests ([9a3f26d](https://github.com/better-update/better-update/commit/9a3f26d7a3c775fd96e963f99d970eaace41dcc5)) - by @
* add build install link API endpoint and fix create org button ([513dbbb](https://github.com/better-update/better-update/commit/513dbbb7c8b31cfbd5199010da65ddaddacc958b)) - by @
* add build registry with presigned URL upload and artifact management ([69a0ad0](https://github.com/better-update/better-update/commit/69a0ad0fd54c1273614185bf475489b4a30af717)) - by @
* add credentials dashboard page with upload, activate, and delete ([762437b](https://github.com/better-update/better-update/commit/762437ba62813d905581cea1b4846820a10b04e0)) - by @
* add deployment analytics with WAE tracking, query API, and dashboard charts ([1b3c730](https://github.com/better-update/better-update/commit/1b3c730cea3158d57b4b1d4a7ea5331a27466f55)) - by @
* add environment variables (Phase 2) ([e88b91f](https://github.com/better-update/better-update/commit/e88b91f1569c5a0f8176213c9d09f1f104140eb6)) - by @
* add project deletion with cascade cleanup ([5f494d5](https://github.com/better-update/better-update/commit/5f494d5cff7309bcb18a8a5eb7a3c378ebb546d7)) - by @
* add project rename endpoint, pagination UI, and E2E tests ([c49a45c](https://github.com/better-update/better-update/commit/c49a45c89794dc7aa982459ceaf3ac4acc9f8a0e)) - by @
* cursor pagination, FTS search, and compatibility-matrix refactor ([b03ac24](https://github.com/better-update/better-update/commit/b03ac24288274621a035b069c413194f0a179441)) - by @trancong12102
* **repo:** add ota build compatibility matrix ([a715a02](https://github.com/better-update/better-update/commit/a715a02b3130e33ffc6263203e4d08ee5f2adc17)) - by @
* **repo:** switch uploads to direct r2 flow ([736e7f1](https://github.com/better-update/better-update/commit/736e7f17d887a773b35038119981b31195b4f510)) - by @

### Bug Fixes

* address council review findings for analytics tab ([4fc1c86](https://github.com/better-update/better-update/commit/4fc1c8611416572ccba529e6b569fbe14ccf4d06)) - by @
* address council review findings for build registry ([fb09be6](https://github.com/better-update/better-update/commit/fb09be63887d9e780d61953dfd8e7f1938c3de0e)) - by @
* address council review findings for deployment analytics ([288f18f](https://github.com/better-update/better-update/commit/288f18fef4ebbf0e0d294a5a63be2af58760882b)) - by @
* address council review findings for environment variables ([d1c91dd](https://github.com/better-update/better-update/commit/d1c91ddf338231ff13ee05cb0b9cdce58ab33352)) - by @
* address remaining P2-P3 council review findings ([4d39840](https://github.com/better-update/better-update/commit/4d39840d7aee7fbddd270c8e854be88774b534dc)) - by @
* address remaining P3 council review findings ([3ab79d5](https://github.com/better-update/better-update/commit/3ab79d5c09584758e2669597f5a0f4fa96d0dea2)) - by @
* **dashboard:** remove build upload UI and restrict uploads to CLI only ([278b011](https://github.com/better-update/better-update/commit/278b0117945a6b766171df0a74d1443b0710ab10)) - by @
* **server:** harden auth, deduplicate code, and fix council review findings ([f268f01](https://github.com/better-update/better-update/commit/f268f01574ee31e1f7094f1cf37fb0b660067ca0)) - by @
* use literal type for audit log source field ([5046bf2](https://github.com/better-update/better-update/commit/5046bf2b21e4d3ebc297ade1d06bc29927a11a2f)) - by @

### Code Refactoring

* **web:** merge accounts + dashboard into apps/web TanStack Start SSR ([98c4e10](https://github.com/better-update/better-update/commit/98c4e10b7040f60f0a909145fc320f2bf1355907)) - by @trancong12102

## [0.1.2](https://github.com/better-update/better-update/compare/@better-update/api-client@0.1.1...@better-update/api-client@0.1.2) (2026-04-22)

**Note:** Version bump only for package @better-update/api-client

## [0.1.1](https://github.com/better-update/better-update/compare/@better-update/api-client@0.1.0...@better-update/api-client@0.1.1) (2026-04-22)

**Note:** Version bump only for package @better-update/api-client

## 0.1.0 (2026-04-21)

### Features

* add branch/channel delete UI, rollout target guard, and E2E tests ([9a3f26d](https://github.com/better-update/better-update/commit/9a3f26d7a3c775fd96e963f99d970eaace41dcc5)) - by @trancong12102
* add build install link API endpoint and fix create org button ([513dbbb](https://github.com/better-update/better-update/commit/513dbbb7c8b31cfbd5199010da65ddaddacc958b)) - by @trancong12102
* add build registry with presigned URL upload and artifact management ([69a0ad0](https://github.com/better-update/better-update/commit/69a0ad0fd54c1273614185bf475489b4a30af717)) - by @trancong12102
* add credentials dashboard page with upload, activate, and delete ([762437b](https://github.com/better-update/better-update/commit/762437ba62813d905581cea1b4846820a10b04e0)) - by @trancong12102
* add deployment analytics with WAE tracking, query API, and dashboard charts ([1b3c730](https://github.com/better-update/better-update/commit/1b3c730cea3158d57b4b1d4a7ea5331a27466f55)) - by @trancong12102
* add environment variables (Phase 2) ([e88b91f](https://github.com/better-update/better-update/commit/e88b91f1569c5a0f8176213c9d09f1f104140eb6)) - by @trancong12102
* add project deletion with cascade cleanup ([5f494d5](https://github.com/better-update/better-update/commit/5f494d5cff7309bcb18a8a5eb7a3c378ebb546d7)) - by @trancong12102
* add project rename endpoint, pagination UI, and E2E tests ([c49a45c](https://github.com/better-update/better-update/commit/c49a45c89794dc7aa982459ceaf3ac4acc9f8a0e)) - by @trancong12102
* **repo:** add ota build compatibility matrix ([a715a02](https://github.com/better-update/better-update/commit/a715a02b3130e33ffc6263203e4d08ee5f2adc17)) - by @trancong12102
* **repo:** switch uploads to direct r2 flow ([736e7f1](https://github.com/better-update/better-update/commit/736e7f17d887a773b35038119981b31195b4f510)) - by @trancong12102

### Bug Fixes

* address council review findings for analytics tab ([4fc1c86](https://github.com/better-update/better-update/commit/4fc1c8611416572ccba529e6b569fbe14ccf4d06)) - by @trancong12102
* address council review findings for build registry ([fb09be6](https://github.com/better-update/better-update/commit/fb09be63887d9e780d61953dfd8e7f1938c3de0e)) - by @trancong12102
* address council review findings for deployment analytics ([288f18f](https://github.com/better-update/better-update/commit/288f18fef4ebbf0e0d294a5a63be2af58760882b)) - by @trancong12102
* address council review findings for environment variables ([d1c91dd](https://github.com/better-update/better-update/commit/d1c91ddf338231ff13ee05cb0b9cdce58ab33352)) - by @trancong12102
* address remaining P2-P3 council review findings ([4d39840](https://github.com/better-update/better-update/commit/4d39840d7aee7fbddd270c8e854be88774b534dc)) - by @trancong12102
* address remaining P3 council review findings ([3ab79d5](https://github.com/better-update/better-update/commit/3ab79d5c09584758e2669597f5a0f4fa96d0dea2)) - by @trancong12102
* **dashboard:** remove build upload UI and restrict uploads to CLI only ([278b011](https://github.com/better-update/better-update/commit/278b0117945a6b766171df0a74d1443b0710ab10)) - by @trancong12102
* **server:** harden auth, deduplicate code, and fix council review findings ([f268f01](https://github.com/better-update/better-update/commit/f268f01574ee31e1f7094f1cf37fb0b660067ca0)) - by @trancong12102
* use literal type for audit log source field ([5046bf2](https://github.com/better-update/better-update/commit/5046bf2b21e4d3ebc297ade1d06bc29927a11a2f)) - by @trancong12102
