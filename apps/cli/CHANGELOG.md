# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.14.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.14.0...@better-update/cli@0.14.1) (2026-05-18)

### Bug Fixes

* **cli:** handle null cert subject fields when parsing Apple p12 ([5d3fd72](https://github.com/better-update/better-update/commit/5d3fd729e9c45843a78d40d13987558ca843a335)) - by @trancong12102

## [0.14.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.13.1...@better-update/cli@0.14.0) (2026-05-18)

### Features

* **cli:** type-to-filter App Store Connect provider picker ([ae0fda6](https://github.com/better-update/better-update/commit/ae0fda6babf38297b39e158c71b3176acc9c807a)) - by @trancong12102

## [0.13.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.13.0...@better-update/cli@0.13.1) (2026-05-18)

### Bug Fixes

* **cli:** stop persisting Apple team so a wrong pick is recoverable ([40105a4](https://github.com/better-update/better-update/commit/40105a4f24754e1185798145cc830ec2897b31b1)) - by @trancong12102

## [0.13.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.12.1...@better-update/cli@0.13.0) (2026-05-18)

### Features

* **cli:** pick/revoke existing iOS distribution cert in Apple ID flow ([c72855f](https://github.com/better-update/better-update/commit/c72855f53570b867b28dc7b66f60b99da6d3453f)) - by @trancong12102

## [0.12.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.12.0...@better-update/cli@0.12.1) (2026-05-18)

### Bug Fixes

* **cli:** default-import @expo/apple-utils to avoid ESM/CJS interop crash ([84024ae](https://github.com/better-update/better-update/commit/84024ae76452d2446ef312ad4773592dd48d7954)) - by @trancong12102

## [0.12.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.11.0...@better-update/cli@0.12.0) (2026-05-18)

### Features

* **cli:** add Apple ID iOS credentials flow + env lookup-by-key + interactive publish picker ([4dd34d3](https://github.com/better-update/better-update/commit/4dd34d3895ea8613eb4f2a9cd03f07001bea0b67)) - by @trancong12102

## [0.11.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.10.1...@better-update/cli@0.11.0) (2026-05-18)

### Features

* **env-vars:** rewrite to EAS-style multi-env + org-scoped vars ([ddd0995](https://github.com/better-update/better-update/commit/ddd099505d513f73b3b93a339fa64b4be819737c)) - by @trancong12102

## [0.10.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.10.0...@better-update/cli@0.10.1) (2026-05-15)

**Note:** Version bump only for package @better-update/cli

## [0.10.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.9.0...@better-update/cli@0.10.0) (2026-05-13)

### Features

* **cli:** add credentials download + configure --rebind for EAS parity ([c3f95e5](https://github.com/better-update/better-update/commit/c3f95e50a65242548d54881f962c5ed330543eb2)) - by @trancong12102
* **cli:** add credentials manager wizard + EAS-parity flags ([2ca4146](https://github.com/better-update/better-update/commit/2ca4146454d56342ef30c28d70257606f216aac5)) - by @trancong12102
* **cli:** add provisioning refresh, update revert, EAS-parity manager setups ([a9b79ae](https://github.com/better-update/better-update/commit/a9b79ae1c3fe9539edab2154503524f965a86824)) - by @trancong12102
* **cli:** add update configure, credentials remove wizard, push-key guided generate ([ec78a34](https://github.com/better-update/better-update/commit/ec78a34e5f9bbcf01422606496f9e9818236069c)) - by @trancong12102
* **cli:** close EAS-parity gaps in credentials revoke, keystore download, FCM V1 binding ([10bcb2d](https://github.com/better-update/better-update/commit/10bcb2da7d92f87ce26e1b27590dc0a6445ca417)) - by @trancong12102
* **cli:** fill EAS-parity gaps in env, update, channels, builds + UX polish ([af9f89c](https://github.com/better-update/better-update/commit/af9f89cca0c35da5191919438dd6247e2514c075)) - by @trancong12102
* **cli:** fill remaining EAS-parity gaps in build, credentials, update ([ea80a9d](https://github.com/better-update/better-update/commit/ea80a9d72fb0d2ccd6b045d6ae819a77deb40cd8)) - by @trancong12102
* **cli:** fill remaining EAS-parity gaps in channels, update, credentials ([e9110d4](https://github.com/better-update/better-update/commit/e9110d44cdf15a38b03cbc9271b5444f966b5cf5)) - by @trancong12102
* fill EAS CLI parity gaps (P0/P1) for builds, env, credentials, devices ([6b6b12d](https://github.com/better-update/better-update/commit/6b6b12d4ed7d1aa02f13a0de91379e3e249d2fd2)) - by @trancong12102
* move build credential generation client-side and expand CLI surface ([d1ee3b2](https://github.com/better-update/better-update/commit/d1ee3b227708cf92585070749800ce905d21e7a0)) - by @trancong12102

## [0.9.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.8.2...@better-update/cli@0.9.0) (2026-05-07)

### Features

* **cli:** support app.config.{ts,js,json} via @expo/config ([e0e7b35](https://github.com/better-update/better-update/commit/e0e7b35b16e5c42240da565efcd7ac8d7ecd1540)) - by @trancong12102
* **cli:** warn user when a newer version is available ([8981596](https://github.com/better-update/better-update/commit/8981596c150f107c33509df1f7d0ee9e815f159c)) - by @trancong12102

### Bug Fixes

* **cli:** address Codex review feedback on expo config flow ([c999654](https://github.com/better-update/better-update/commit/c99965470feec2eb2ebf70b98efa7652e25fb8e5)) - by @trancong12102
* **cli:** address PR review findings on version notifier ([bdd2658](https://github.com/better-update/better-update/commit/bdd26586257ec8f72c1245279fa93526daa51ee9)) - by @trancong12102
* **cli:** address review findings + repair e2e fixture install ([8b1cee0](https://github.com/better-update/better-update/commit/8b1cee06c268f987c6e21d7de153ab9d48f90914)) - by @trancong12102

## [0.8.2](https://github.com/better-update/better-update/compare/@better-update/cli@0.8.1...@better-update/cli@0.8.2) (2026-05-07)

### Bug Fixes

* **cli:** point default base URL to better-update.dev ([13f0d4c](https://github.com/better-update/better-update/commit/13f0d4c06d7ec973f19c91fcc89bfb058a8aca69)) - by @trancong12102

## [0.8.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.8.0...@better-update/cli@0.8.1) (2026-05-07)

### Bug Fixes

* **cli:** await local callback server listen before reading port ([927ae08](https://github.com/better-update/better-update/commit/927ae084850b2ee5d7fde7551e4cd487e67527c5)) - by @trancong12102

## [0.8.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.7.1...@better-update/cli@0.8.0) (2026-05-07)

### Features

* page-numbered pagination with sort across list endpoints ([ff90874](https://github.com/better-update/better-update/commit/ff90874474fb138e9aed36294de2029abce94d7a)) - by @trancong12102

## [0.7.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.7.0...@better-update/cli@0.7.1) (2026-05-06)

### Bug Fixes

* **web:** harden route error handling and drop route loaders ([72808c1](https://github.com/better-update/better-update/commit/72808c17fbae3753e6f8252c626933af07d79f2f)) - by @trancong12102

## [0.7.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.6.4...@better-update/cli@0.7.0) (2026-05-06)

### ⚠ BREAKING CHANGES

* **web:** server env vars ACCOUNTS_URL and CONSOLE_URL are
replaced by WEB_URL. CLI config key accountsUrl and env
BETTER_UPDATE_ACCOUNTS_URL are replaced by webUrl and
BETTER_UPDATE_WEB_URL.

### Features

* cursor pagination, FTS search, and compatibility-matrix refactor ([b03ac24](https://github.com/better-update/better-update/commit/b03ac24288274621a035b069c413194f0a179441)) - by @trancong12102

### Bug Fixes

* **cli:** use path.join for credentials temp paths ([b195705](https://github.com/better-update/better-update/commit/b1957050f666a5229f6e01d9c7e36da71d3c405f)) - by @trancong12102

### Code Refactoring

* **web:** merge accounts + dashboard into apps/web TanStack Start SSR ([98c4e10](https://github.com/better-update/better-update/commit/98c4e10b7040f60f0a909145fc320f2bf1355907)) - by @trancong12102

## [0.6.4](https://github.com/better-update/better-update/compare/@better-update/cli@0.6.3...@better-update/cli@0.6.4) (2026-04-22)

### Bug Fixes

* **cli:** show real package version instead of hardcoded 0.1.0 ([70a24e8](https://github.com/better-update/better-update/commit/70a24e8fee6f8dd279fd18ebf0f7993176b2ad85)) - by @trancong12102

## [0.6.3](https://github.com/better-update/better-update/compare/@better-update/cli@0.6.2...@better-update/cli@0.6.3) (2026-04-22)

**Note:** Version bump only for package @better-update/cli

## [0.6.2](https://github.com/better-update/better-update/compare/@better-update/cli@0.6.1...@better-update/cli@0.6.2) (2026-04-22)

### Bug Fixes

* **cli:** point bin/main/exports at .mjs to match tsdown output ([11b131c](https://github.com/better-update/better-update/commit/11b131caff0fcb0cee082232674aa4aff35ddb6d)) - by @trancong12102

## [0.6.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.6.0...@better-update/cli@0.6.1) (2026-04-22)

**Note:** Version bump only for package @better-update/cli

## [0.6.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.5.0...@better-update/cli@0.6.0) (2026-04-22)

### Features

* **cli:** add `builds upload` for push-only flow ([a5ff2a8](https://github.com/better-update/better-update/commit/a5ff2a8260dc4ee948da1121c667f8b07b5fa501)) - by @trancong12102

## [0.5.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.4.1...@better-update/cli@0.5.0) (2026-04-22)

### Features

* **apps:** add repository metadata to app manifests ([c9cd84b](https://github.com/better-update/better-update/commit/c9cd84b8dd8c0f57f262d92b76cc19aa4fcdf6d9)) - by @trancong12102

## [0.4.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.4.0...@better-update/cli@0.4.1) (2026-04-22)

**Note:** Version bump only for package @better-update/cli

## [0.4.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.3.2...@better-update/cli@0.4.0) (2026-04-22)

### Features

* **accounts:** github-only login redesign + dashboard→console split cleanup ([121f822](https://github.com/better-update/better-update/commit/121f822bcfd9e379d23d4d6b3e5c01849cf625d1)) - by @trancong12102

## [0.3.2](https://github.com/better-update/better-update/compare/@better-update/cli@0.3.1...@better-update/cli@0.3.2) (2026-04-21)

### Bug Fixes

* **cli:** drop prepublishOnly hook and move workspace deps to devDependencies ([61b504b](https://github.com/better-update/better-update/commit/61b504b6ea3affae9ed38b8150d63b1c4a06fa06)) - by @trancong12102

## [0.3.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.3.0...@better-update/cli@0.3.1) (2026-04-21)

**Note:** Version bump only for package @better-update/cli

## 0.3.0 (2026-04-21)

### Features

* add CLI build command for local native iOS/Android builds ([97a3e73](https://github.com/better-update/better-update/commit/97a3e73501f120118e44087f2359696c5a913c9d)) - by @
* add CLI package for project, credential, and env management ([07c0ff7](https://github.com/better-update/better-update/commit/07c0ff75d55f88bae94e4760625013b070896f36)) - by @
* add CLI update publish command ([5f4268a](https://github.com/better-update/better-update/commit/5f4268a90bacb8a231bbc98ca92bd70452bcf02c)) - by @
* **cli,server,dashboard:** close EAS Update feature gaps ([#4](https://github.com/better-update/better-update/issues/4), [#6](https://github.com/better-update/better-update/issues/6), [#7](https://github.com/better-update/better-update/issues/7), [#2](https://github.com/better-update/better-update/issues/2)) ([ecdc224](https://github.com/better-update/better-update/commit/ecdc22423f4117ab27ddac15e175329bf50c1031)) - by @
* **cli,server:** integrate EAS CLI libraries, Apple auto-provisioning, and content-type-namespaced asset hashing ([ff3d881](https://github.com/better-update/better-update/commit/ff3d8812a27387e2331cc9e01741f4c01195e31a)) - by @
* **cli:** add --rollout-percentage to update publish + schema-validated args ([e656e75](https://github.com/better-update/better-update/commit/e656e75685e4fe8f872d7495325f1bd8d6534cc8)) - by @
* **cli:** add Android keystore certificate expiry validation ([78f3e46](https://github.com/better-update/better-update/commit/78f3e460e394632a0a39a6e3b5d7779b2dcd174d)) - by @
* **cli:** add Apple App Store Connect provider selection ([0cd1894](https://github.com/better-update/better-update/commit/0cd189454eeed653826867411102b993d1fc1c9f)) - by @
* **cli:** add full CLI coverage for all API groups ([9e05b10](https://github.com/better-update/better-update/commit/9e05b10152d27c9617288a0c182678aaec9d4864)) - by @
* **repo:** add rollback-to-embedded flows ([f5fe1c4](https://github.com/better-update/better-update/commit/f5fe1c439ad7424dc671d84a7b81721e9b6976ad)) - by @
* **repo:** add update lifecycle and credential flows ([f55cf5d](https://github.com/better-update/better-update/commit/f55cf5dea7874540fef6c9620ab8ced7c78e872f)) - by @
* **repo:** expand build management coverage and dashboard details ([96d8d11](https://github.com/better-update/better-update/commit/96d8d11c41a171d67a3dad82d936c924a3e614c7)) - by @
* **repo:** switch uploads to direct r2 flow ([736e7f1](https://github.com/better-update/better-update/commit/736e7f17d887a773b35038119981b31195b4f510)) - by @
* **server,cli:** add build-credentials resolver with roster-hash gated profile regen ([e3a42f8](https://github.com/better-update/better-update/commit/e3a42f86eb7dfd6ec20edeafae6e1aae9c5f76ad)) - by @

### Bug Fixes

* **cli:** defer api client auth and repair e2e harness ([77de9db](https://github.com/better-update/better-update/commit/77de9db2a93facbfbdb859fe65b5307d1f56a29e)) - by @
* **dashboard:** remove build upload UI and restrict uploads to CLI only ([278b011](https://github.com/better-update/better-update/commit/278b0117945a6b766171df0a74d1443b0710ab10)) - by @
* **repo:** add knip dead code detection, fix timing-safe HMAC verification ([ef3e3b6](https://github.com/better-update/better-update/commit/ef3e3b6c6d936e85346ed2b0f53941e92cc8d226)) - by @
* **repo:** harden update publish and republish flows ([5b2a7b7](https://github.com/better-update/better-update/commit/5b2a7b7dc164baf29bbe54db83174f3a1f09b503)) - by @
* **repo:** stream update artifacts and enable signed promote flows ([4ed09f1](https://github.com/better-update/better-update/commit/4ed09f15909e44a68e597a28d00c7b0825448211)) - by @

## 0.2.0 (2026-04-21)

### Features

* add CLI build command for local native iOS/Android builds ([97a3e73](https://github.com/better-update/better-update/commit/97a3e73501f120118e44087f2359696c5a913c9d)) - by @trancong12102
* add CLI package for project, credential, and env management ([07c0ff7](https://github.com/better-update/better-update/commit/07c0ff75d55f88bae94e4760625013b070896f36)) - by @trancong12102
* add CLI update publish command ([5f4268a](https://github.com/better-update/better-update/commit/5f4268a90bacb8a231bbc98ca92bd70452bcf02c)) - by @trancong12102
* **cli,server,dashboard:** close EAS Update feature gaps ([#4](https://github.com/better-update/better-update/issues/4), [#6](https://github.com/better-update/better-update/issues/6), [#7](https://github.com/better-update/better-update/issues/7), [#2](https://github.com/better-update/better-update/issues/2)) ([ecdc224](https://github.com/better-update/better-update/commit/ecdc22423f4117ab27ddac15e175329bf50c1031)) - by @trancong12102
* **cli,server:** integrate EAS CLI libraries, Apple auto-provisioning, and content-type-namespaced asset hashing ([ff3d881](https://github.com/better-update/better-update/commit/ff3d8812a27387e2331cc9e01741f4c01195e31a)) - by @trancong12102
* **cli:** add --rollout-percentage to update publish + schema-validated args ([e656e75](https://github.com/better-update/better-update/commit/e656e75685e4fe8f872d7495325f1bd8d6534cc8)) - by @trancong12102
* **cli:** add Android keystore certificate expiry validation ([78f3e46](https://github.com/better-update/better-update/commit/78f3e460e394632a0a39a6e3b5d7779b2dcd174d)) - by @trancong12102
* **cli:** add Apple App Store Connect provider selection ([0cd1894](https://github.com/better-update/better-update/commit/0cd189454eeed653826867411102b993d1fc1c9f)) - by @trancong12102
* **cli:** add full CLI coverage for all API groups ([9e05b10](https://github.com/better-update/better-update/commit/9e05b10152d27c9617288a0c182678aaec9d4864)) - by @trancong12102
* **repo:** add rollback-to-embedded flows ([f5fe1c4](https://github.com/better-update/better-update/commit/f5fe1c439ad7424dc671d84a7b81721e9b6976ad)) - by @trancong12102
* **repo:** add update lifecycle and credential flows ([f55cf5d](https://github.com/better-update/better-update/commit/f55cf5dea7874540fef6c9620ab8ced7c78e872f)) - by @trancong12102
* **repo:** expand build management coverage and dashboard details ([96d8d11](https://github.com/better-update/better-update/commit/96d8d11c41a171d67a3dad82d936c924a3e614c7)) - by @trancong12102
* **repo:** switch uploads to direct r2 flow ([736e7f1](https://github.com/better-update/better-update/commit/736e7f17d887a773b35038119981b31195b4f510)) - by @trancong12102
* **server,cli:** add build-credentials resolver with roster-hash gated profile regen ([e3a42f8](https://github.com/better-update/better-update/commit/e3a42f86eb7dfd6ec20edeafae6e1aae9c5f76ad)) - by @trancong12102

### Bug Fixes

* **cli:** defer api client auth and repair e2e harness ([77de9db](https://github.com/better-update/better-update/commit/77de9db2a93facbfbdb859fe65b5307d1f56a29e)) - by @trancong12102
* **dashboard:** remove build upload UI and restrict uploads to CLI only ([278b011](https://github.com/better-update/better-update/commit/278b0117945a6b766171df0a74d1443b0710ab10)) - by @trancong12102
* **repo:** add knip dead code detection, fix timing-safe HMAC verification ([ef3e3b6](https://github.com/better-update/better-update/commit/ef3e3b6c6d936e85346ed2b0f53941e92cc8d226)) - by @trancong12102
* **repo:** harden update publish and republish flows ([5b2a7b7](https://github.com/better-update/better-update/commit/5b2a7b7dc164baf29bbe54db83174f3a1f09b503)) - by @trancong12102
* **repo:** stream update artifacts and enable signed promote flows ([4ed09f1](https://github.com/better-update/better-update/commit/4ed09f15909e44a68e597a28d00c7b0825448211)) - by @trancong12102
