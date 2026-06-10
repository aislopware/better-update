# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.38.3](https://github.com/better-update/better-update/compare/@better-update/web@0.38.2...@better-update/web@0.38.3) (2026-06-10)

**Note:** Version bump only for package @better-update/web

## [0.38.2](https://github.com/better-update/better-update/compare/@better-update/web@0.38.1...@better-update/web@0.38.2) (2026-06-10)

**Note:** Version bump only for package @better-update/web

## [0.38.1](https://github.com/better-update/better-update/compare/@better-update/web@0.38.0...@better-update/web@0.38.1) (2026-06-09)

**Note:** Version bump only for package @better-update/web

## [0.38.0](https://github.com/better-update/better-update/compare/@better-update/web@0.37.0...@better-update/web@0.38.0) (2026-06-08)

### Features

* **web:** add Apple team selector + sync status to device dialogs ([46e5d97](https://github.com/better-update/better-update/commit/46e5d97ef173d57b2d254df14261625c050ae830)) - by @trancong12102

## [0.37.0](https://github.com/better-update/better-update/compare/@better-update/web@0.36.0...@better-update/web@0.37.0) (2026-06-08)

### Features

* **credentials:** capture & display Google service-account client_id (EAS parity) ([e14e8f7](https://github.com/better-update/better-update/commit/e14e8f70352f542cb2700384e83795f2eff4d72b)) - by @trancong12102

## [0.36.0](https://github.com/better-update/better-update/compare/@better-update/web@0.35.0...@better-update/web@0.36.0) (2026-06-08)

### Features

* **web:** show Android keystore type in its own column ([b881ede](https://github.com/better-update/better-update/commit/b881ede0adeb66cacd065c7ce7e8f2949e9d9c50)) - by @trancong12102

## [0.35.0](https://github.com/better-update/better-update/compare/@better-update/web@0.34.0...@better-update/web@0.35.0) (2026-06-08)

### Features

* **credentials:** store & show Android keystore type (JKS/PKCS12) ([20cd16c](https://github.com/better-update/better-update/commit/20cd16cf3ac9cc5f1e9acec9cddfb5dbef851a8e)) - by @trancong12102

## [0.34.0](https://github.com/better-update/better-update/compare/@better-update/web@0.33.0...@better-update/web@0.34.0) (2026-06-08)

### Features

* **web:** add copy buttons across dashboard identifier surfaces ([b14598a](https://github.com/better-update/better-update/commit/b14598afbedfd65bff82e2add7d9324092a254d3)) - by @trancong12102

## [0.33.0](https://github.com/better-update/better-update/compare/@better-update/web@0.32.0...@better-update/web@0.33.0) (2026-06-07)

### Features

* **web:** enrich credential, audit-log & vault dashboard surfaces ([e8b9634](https://github.com/better-update/better-update/commit/e8b963402dcb2f000efb447373352eb1d2e3d701)) - by @trancong12102

## [0.32.0](https://github.com/better-update/better-update/compare/@better-update/web@0.31.0...@better-update/web@0.32.0) (2026-06-05)

### Features

* **environments:** user-defined environments + built-in dev/preview/production lock ([a647410](https://github.com/better-update/better-update/commit/a647410b7f4865c2a797f0b8c5d04add0b74fa96)) - by @trancong12102

### Bug Fixes

* **web:** wrap empty states in card to restore bordered surface ([997cef4](https://github.com/better-update/better-update/commit/997cef416e3e658d655d16648522709a5f5f8a0b)) - by @trancong12102

## [0.31.0](https://github.com/better-update/better-update/compare/@better-update/web@0.30.0...@better-update/web@0.31.0) (2026-06-05)

### Features

* **ui:** sync components with coss upstream ([1b05769](https://github.com/better-update/better-update/commit/1b057697b2161b835bda59f70a922a7711a4df6e)) - by @trancong12102

## [0.30.0](https://github.com/better-update/better-update/compare/@better-update/web@0.29.0...@better-update/web@0.30.0) (2026-06-05)

### Features

* **web:** add read-only policy view dialog, fix policy builder layout ([65dcba6](https://github.com/better-update/better-update/commit/65dcba680c38a3b1e25730f365e48cc64e83e7af)) - by @trancong12102

## [0.29.0](https://github.com/better-update/better-update/compare/@better-update/web@0.28.0...@better-update/web@0.29.0) (2026-06-04)

### ⚠ BREAKING CHANGES

* **authz:** authz model replaced (organization_role/environment_grant dropped,
no migration); api-keys and non-owner members are default-deny until a policy is
attached; member.role is owner|member only. Prod data is wiped before deploy.

### Features

* **authz:** unify better-auth and IAM into a single policy gate ([92a3cf2](https://github.com/better-update/better-update/commit/92a3cf21a461aabb61d84d20ba11e781bcec21aa)) - by @trancong12102

### Bug Fixes

* **web:** add missing document-title labels for top-level routes ([a2e4e65](https://github.com/better-update/better-update/commit/a2e4e65c8842d8941b414401611659b1f8f483f6)) - by @trancong12102
* **web:** move roles page from /settings/roles to top-level /roles ([e290107](https://github.com/better-update/better-update/commit/e2901078493646defc90e24d6c66b00dd6470f2f)) - by @trancong12102

## [0.28.0](https://github.com/better-update/better-update/compare/@better-update/web@0.27.0...@better-update/web@0.28.0) (2026-06-03)

### Features

* **web:** simplify onboarding account display to signed-in line ([1e3143e](https://github.com/better-update/better-update/commit/1e3143e4374ced27663bcae003fb67b42090e3a1)) - by @trancong12102

## [0.27.0](https://github.com/better-update/better-update/compare/@better-update/web@0.26.0...@better-update/web@0.27.0) (2026-06-03)

### Features

* **web:** dock onboarding account menu into card footer ([9f097e7](https://github.com/better-update/better-update/commit/9f097e7dbb39f6c375ce5a09f3a5a853d9cac2ba)) - by @trancong12102

## [0.26.0](https://github.com/better-update/better-update/compare/@better-update/web@0.25.0...@better-update/web@0.26.0) (2026-06-03)

### Features

* **web:** show current account and logout on onboarding ([5f717fa](https://github.com/better-update/better-update/commit/5f717fac9fc23627cf3fa4c5b0a84201157b52c3)) - by @trancong12102

## [0.25.0](https://github.com/better-update/better-update/compare/@better-update/web@0.24.2...@better-update/web@0.25.0) (2026-06-03)

### Features

* **server:** add IAM-style authz with roles and per-scope ABAC grants ([a2cfd9c](https://github.com/better-update/better-update/commit/a2cfd9c4ef4f3aa2d69e3542c61074eda85cd54c)) - by @trancong12102

### Bug Fixes

* **web:** regenerate routeTree.gen.ts from clean build ([139c4e2](https://github.com/better-update/better-update/commit/139c4e26f547082adf2d8a8f400c4f1d1fd2bacf)) - by @trancong12102

## [0.24.2](https://github.com/better-update/better-update/compare/@better-update/web@0.24.1...@better-update/web@0.24.2) (2026-06-03)

### Bug Fixes

* **web:** use FramePanel layout for pending-approval card ([1efe962](https://github.com/better-update/better-update/commit/1efe962230ddb072f65c47588a5fefc522011b3e)) - by @trancong12102

## [0.24.1](https://github.com/better-update/better-update/compare/@better-update/web@0.24.0...@better-update/web@0.24.1) (2026-06-03)

**Note:** Version bump only for package @better-update/web

## [0.24.0](https://github.com/better-update/better-update/compare/@better-update/web@0.23.0...@better-update/web@0.24.0) (2026-06-02)

### Features

* **auth:** superadmin-gated user approval for dev phase ([69f97e3](https://github.com/better-update/better-update/commit/69f97e3ab39436f97decd3fca454d63e9ec794bb)) - by @trancong12102

## [0.23.0](https://github.com/better-update/better-update/compare/@better-update/web@0.22.1...@better-update/web@0.23.0) (2026-06-01)

### Features

* **auth:** add Google OAuth sign-in alongside GitHub ([3606f0b](https://github.com/better-update/better-update/commit/3606f0be72e8b16031411dd71391af552ddecdc0)) - by @trancong12102

## [0.22.1](https://github.com/better-update/better-update/compare/@better-update/web@0.22.0...@better-update/web@0.22.1) (2026-06-01)

### Bug Fixes

* **lint:** use default node:path import for oxlint 1.67 import-style ([3983aba](https://github.com/better-update/better-update/commit/3983aba521b86b54813c7756b99ed4d8ef39627e)) - by @trancong12102
* **web:** use functional updater for session setQueryData ([09ab688](https://github.com/better-update/better-update/commit/09ab68854690adab4c8fce7d3ea42053618341bf)) - by @trancong12102

## [0.22.0](https://github.com/better-update/better-update/compare/@better-update/web@0.21.0...@better-update/web@0.22.0) (2026-05-28)

### ⚠ BREAKING CHANGES

* **env-vars:** migration 0049 recreates env_vars without a plaintext value
column; existing env var data is dropped and must be re-set via the CLI.

### Features

* **env-vars:** end-to-end encrypt + version environment variables ([#9](https://github.com/better-update/better-update/issues/9)) ([7062a44](https://github.com/better-update/better-update/commit/7062a4448d8640bdcc41de7d2dcf86cb8259662a)) - by @trancong12102

### Bug Fixes

* **web:** label the vault-access breadcrumb "Vault access" ([f43e1fa](https://github.com/better-update/better-update/commit/f43e1fafe5c730e0e8b58ac08c3ddc9673c98941)) - by @trancong12102

## [0.21.0](https://github.com/better-update/better-update/compare/@better-update/web@0.20.2...@better-update/web@0.21.0) (2026-05-27)

### Features

* **auth:** authenticate the CLI with Better Auth sessions ([61444d2](https://github.com/better-update/better-update/commit/61444d28ad50acf60d37877f7ccb10b38c33df0f)) - by @trancong12102

## [0.20.2](https://github.com/better-update/better-update/compare/@better-update/web@0.20.1...@better-update/web@0.20.2) (2026-05-21)

### Bug Fixes

* **web:** recover from transient router undefined throws on redirect ([bc3329a](https://github.com/better-update/better-update/commit/bc3329a96b9071094a08a0018d5106cd6574b20c)) - by @trancong12102

## [0.20.1](https://github.com/better-update/better-update/compare/@better-update/web@0.20.0...@better-update/web@0.20.1) (2026-05-21)

### Performance Improvements

* **web:** cut hero globe CPU ~2x ([#8](https://github.com/better-update/better-update/issues/8)) ([df77a32](https://github.com/better-update/better-update/commit/df77a3206e9f5309db1423e6cd5767e821fe0e01)) - by @trancong12102

## [0.20.0](https://github.com/better-update/better-update/compare/@better-update/web@0.19.0...@better-update/web@0.20.0) (2026-05-21)

### Features

* **web:** add Terms of Service and Privacy Policy pages ([9bc8e0a](https://github.com/better-update/better-update/commit/9bc8e0a79ebfe6c033ab87090317b079d8bf302a)) - by @trancong12102

## [0.19.0](https://github.com/better-update/better-update/compare/@better-update/web@0.18.0...@better-update/web@0.19.0) (2026-05-21)

### Features

* client-side E2E encrypted credential vault ([6e36671](https://github.com/better-update/better-update/commit/6e3667168e57a90a422b389f3e6337a13f8dddc4)) - by @trancong12102

## [0.18.0](https://github.com/better-update/better-update/compare/@better-update/web@0.17.0...@better-update/web@0.18.0) (2026-05-19)

### Features

* store submissions, iOS app metadata, credentials EAS-parity rework ([4198f66](https://github.com/better-update/better-update/commit/4198f66c7171ba065c2712e0d0007a6166d4983e)) - by @trancong12102

## [0.17.0](https://github.com/better-update/better-update/compare/@better-update/web@0.16.0...@better-update/web@0.17.0) (2026-05-19)

### Features

* **server:** seed production/staging/preview branches and channels on project create ([cb5bc4b](https://github.com/better-update/better-update/commit/cb5bc4b512dd0c7212a2c1df6893dc8c67e8c1f8)) - by @

## [0.16.0](https://github.com/better-update/better-update/compare/@better-update/web@0.15.0...@better-update/web@0.16.0) (2026-05-19)

### Features

* **builds:** mark dirty git working tree on build records ([e5d99cf](https://github.com/better-update/better-update/commit/e5d99cf2c5522ea1de04222849bc7e5c5d444ca5)) - by @trancong12102

## [0.15.0](https://github.com/better-update/better-update/compare/@better-update/web@0.14.0...@better-update/web@0.15.0) (2026-05-19)

### Features

* **web:** color-coded badges with icons for platform, distribution, channel, environment ([b60d49d](https://github.com/better-update/better-update/commit/b60d49d955b660199212da13beb67f57eb4af81d)) - by @trancong12102

## [0.14.0](https://github.com/better-update/better-update/compare/@better-update/web@0.13.0...@better-update/web@0.14.0) (2026-05-19)

### Features

* **web:** show build number, drop format and target columns in builds table ([ab813c8](https://github.com/better-update/better-update/commit/ab813c81ef0d194dff37dc637c07ff0b1597464e)) - by @trancong12102

## [0.13.0](https://github.com/better-update/better-update/compare/@better-update/web@0.12.1...@better-update/web@0.13.0) (2026-05-19)

### Features

* android multi credential sets resolvable by build profile ([7e71890](https://github.com/better-update/better-update/commit/7e718901a77df5bb180417a459870acb5751a212)) - by @trancong12102
* dashboard parity wave (fingerprints, env vars, build audience, update detail) ([d9930d7](https://github.com/better-update/better-update/commit/d9930d7575f435c120e153237dcee7f35b191d57)) - by @trancong12102
* per-update bundle size + downloads stats ([9ff1b14](https://github.com/better-update/better-update/commit/9ff1b1410104dcb0fe4fa5ddbf1b1c82ffae5959)) - by @trancong12102

## [0.12.1](https://github.com/better-update/better-update/compare/@better-update/web@0.12.0...@better-update/web@0.12.1) (2026-05-18)

**Note:** Version bump only for package @better-update/web

## [0.12.0](https://github.com/better-update/better-update/compare/@better-update/web@0.11.0...@better-update/web@0.12.0) (2026-05-18)

### ⚠ BREAKING CHANGES

* **env-vars:** drop encryption, render sensitive values with reveal + copy

### Features

* **env-vars:** drop encryption, render sensitive values with reveal + copy ([4176a46](https://github.com/better-update/better-update/commit/4176a46cb642a0ef611e12f0a28bd548de0fc8ef)) - by @trancong12102

### Bug Fixes

* **web:** allow picking any file in env-var upload dialog ([0ae42ff](https://github.com/better-update/better-update/commit/0ae42ffd62c7bb71689530712128e3ab0d708cd9)) - by @trancong12102

## [0.11.0](https://github.com/better-update/better-update/compare/@better-update/web@0.10.0...@better-update/web@0.11.0) (2026-05-18)

### Features

* **env-vars:** rewrite to EAS-style multi-env + org-scoped vars ([ddd0995](https://github.com/better-update/better-update/commit/ddd099505d513f73b3b93a339fa64b4be819737c)) - by @trancong12102

## [0.10.0](https://github.com/better-update/better-update/compare/@better-update/web@0.9.0...@better-update/web@0.10.0) (2026-05-15)

### Features

* **web:** per-route skeletons + top progress bar + onboarding Frame layout ([33616c7](https://github.com/better-update/better-update/commit/33616c7804c7ef55b55406729004dc28209a344f)) - by @trancong12102

## [0.9.0](https://github.com/better-update/better-update/compare/@better-update/web@0.8.1...@better-update/web@0.9.0) (2026-05-13)

### Features

* move build credential generation client-side and expand CLI surface ([d1ee3b2](https://github.com/better-update/better-update/commit/d1ee3b227708cf92585070749800ce905d21e7a0)) - by @trancong12102

## [0.8.1](https://github.com/better-update/better-update/compare/@better-update/web@0.8.0...@better-update/web@0.8.1) (2026-05-07)

### Bug Fixes

* **web:** defer API key list refetch until reveal dialog closes ([90dfb6a](https://github.com/better-update/better-update/commit/90dfb6ac827246b1aeb54ae6fc0658d5f1955b65)) - by @miiny1206
* **web:** lift create api key dialog and harden invalidation ([c0e5410](https://github.com/better-update/better-update/commit/c0e5410f3f1c827cf34b066cea5996ad155f6762)) - by @miiny1206

## [0.8.0](https://github.com/better-update/better-update/compare/@better-update/web@0.7.0...@better-update/web@0.8.0) (2026-05-07)

### Features

* send transactional invite emails via Cloudflare Email Service ([3b4e80c](https://github.com/better-update/better-update/commit/3b4e80c4e05d97a4f670db0ac29c95bc36ef6e85)) - by @trancong12102

### Bug Fixes

* **web:** align members table layout with frame footer count ([939081c](https://github.com/better-update/better-update/commit/939081c77cc5abe1b65aa4211b13f2191ea14fdd)) - by @trancong12102

## [0.7.0](https://github.com/better-update/better-update/compare/@better-update/web@0.6.1...@better-update/web@0.7.0) (2026-05-07)

### Features

* page-numbered pagination with sort across list endpoints ([ff90874](https://github.com/better-update/better-update/commit/ff90874474fb138e9aed36294de2029abce94d7a)) - by @trancong12102

## [0.6.1](https://github.com/better-update/better-update/compare/@better-update/web@0.6.0...@better-update/web@0.6.1) (2026-05-06)

### Bug Fixes

* **web:** harden route error handling and drop route loaders ([72808c1](https://github.com/better-update/better-update/commit/72808c17fbae3753e6f8252c626933af07d79f2f)) - by @trancong12102

## 0.6.0 (2026-05-06)

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

* **web:** detect mobile user agents first ([e53ef3e](https://github.com/better-update/better-update/commit/e53ef3e2c2607b1c098e34741a163b879b0bfe61)) - by @trancong12102
* **web:** lock avatar fallback text color against dropdown hover ([ba1310e](https://github.com/better-update/better-update/commit/ba1310e9d4d418f91da034864fd0fc64ad587904)) - by @trancong12102
* **web:** persist resolved theme state ([3b3122d](https://github.com/better-update/better-update/commit/3b3122dfcf36014fa0b6f97f9750e2a68b493949)) - by @trancong12102
* **web:** stabilize auth org flows ([d753911](https://github.com/better-update/better-update/commit/d753911b7ea3f1c74a4775b99636e8472a358246)) - by @trancong12102
* **web:** support http api proxy targets ([28cc22c](https://github.com/better-update/better-update/commit/28cc22c5a714e39b904ddb3a37c09e53af8df4f2)) - by @trancong12102

### Code Refactoring

* merge api + web onto single domain (better-update.dev) ([63acb2e](https://github.com/better-update/better-update/commit/63acb2ec54d3cfaafbfc68baebf9c0a770ced7c0)) - by @trancong12102
* **web:** merge accounts + dashboard into apps/web TanStack Start SSR ([98c4e10](https://github.com/better-update/better-update/commit/98c4e10b7040f60f0a909145fc320f2bf1355907)) - by @trancong12102

## [0.5.1](https://github.com/better-update/better-update/compare/@better-update/dashboard@0.5.0...@better-update/dashboard@0.5.1) (2026-04-22)

### Bug Fixes

* **ui,dashboard:** resolve nested-button bug in dialog/dropdown triggers ([8e02327](https://github.com/better-update/better-update/commit/8e023278593d508c2a1ba617220b3f67d4d46e1b)) - by @trancong12102

## [0.5.0](https://github.com/better-update/better-update/compare/@better-update/dashboard@0.4.0...@better-update/dashboard@0.5.0) (2026-04-22)

### Features

* **ui,apps:** tighten motion curves, press feedback, reduced-motion ([67dc84d](https://github.com/better-update/better-update/commit/67dc84df176212db51ad8692991b5435b2f2e2a7)) - by @trancong12102

## [0.4.0](https://github.com/better-update/better-update/compare/@better-update/dashboard@0.2.1...@better-update/dashboard@0.4.0) (2026-04-22)

### Features

* **apps:** add repository metadata to app manifests ([c9cd84b](https://github.com/better-update/better-update/commit/c9cd84b8dd8c0f57f262d92b76cc19aa4fcdf6d9)) - by @trancong12102
* **dashboard,accounts:** pending state + loader on async actions ([9ce8e6d](https://github.com/better-update/better-update/commit/9ce8e6d947bd42abdb116422950c776d6bae28c5)) - by @
* **dashboard:** dynamic page titles per route ([9ba917c](https://github.com/better-update/better-update/commit/9ba917cf79a0c3dd1e9f04d8d2be8afca97749eb)) - by @

## [0.3.0](https://github.com/better-update/better-update/compare/@better-update/dashboard@0.2.1...@better-update/dashboard@0.3.0) (2026-04-22)

### Features

* **dashboard,accounts:** pending state + loader on async actions ([9ce8e6d](https://github.com/better-update/better-update/commit/9ce8e6d947bd42abdb116422950c776d6bae28c5)) - by @trancong12102
* **dashboard:** dynamic page titles per route ([9ba917c](https://github.com/better-update/better-update/commit/9ba917cf79a0c3dd1e9f04d8d2be8afca97749eb)) - by @trancong12102

## [0.2.1](https://github.com/better-update/better-update/compare/@better-update/dashboard@0.2.0...@better-update/dashboard@0.2.1) (2026-04-22)

**Note:** Version bump only for package @better-update/dashboard

## [0.2.0](https://github.com/better-update/better-update/compare/@better-update/dashboard@0.1.0...@better-update/dashboard@0.2.0) (2026-04-22)

### Features

* **accounts:** github-only login redesign + dashboard→console split cleanup ([121f822](https://github.com/better-update/better-update/commit/121f822bcfd9e379d23d4d6b3e5c01849cf625d1)) - by @trancong12102
* **deploy:** auto-deploy wrangler apps on release tag ([4e1912c](https://github.com/better-update/better-update/commit/4e1912c0d59d52a5028d6ddd61e4407309584643)) - by @trancong12102

## 0.1.0 (2026-04-21)

### Features

* add audit log dashboard page and handler integration ([9227ed2](https://github.com/better-update/better-update/commit/9227ed2fc2fc02e10b0885a81c415098b343914a)) - by @trancong12102
* add branch rollout UI to channel card ([0416c62](https://github.com/better-update/better-update/commit/0416c6277a38d904f5912e0a869c8eccea5d0505)) - by @trancong12102
* add branch/channel delete UI, rollout target guard, and E2E tests ([9a3f26d](https://github.com/better-update/better-update/commit/9a3f26d7a3c775fd96e963f99d970eaace41dcc5)) - by @trancong12102
* add branches CRUD with project detail page and E2E tests ([624ceed](https://github.com/better-update/better-update/commit/624ceed9b000ea026ed50b2be00b5ccab47ad44c)) - by @trancong12102
* add build install link API endpoint and fix create org button ([513dbbb](https://github.com/better-update/better-update/commit/513dbbb7c8b31cfbd5199010da65ddaddacc958b)) - by @trancong12102
* add Builds tab to project detail dashboard ([e64f2ef](https://github.com/better-update/better-update/commit/e64f2ef6fd005bed9e654ddc9c65329c4890fa51)) - by @trancong12102
* add channels CRUD with project detail UI and E2E tests ([a953ed6](https://github.com/better-update/better-update/commit/a953ed66d59d7cdd23e5d9abf79ee02dbd0a124c)) - by @trancong12102
* add CLI update publish command ([5f4268a](https://github.com/better-update/better-update/commit/5f4268a90bacb8a231bbc98ca92bd70452bcf02c)) - by @trancong12102
* add credentials dashboard page with upload, activate, and delete ([762437b](https://github.com/better-update/better-update/commit/762437ba62813d905581cea1b4846820a10b04e0)) - by @trancong12102
* add dark mode theme system with server-persisted preference ([e482825](https://github.com/better-update/better-update/commit/e4828253a852bb63745726557f9acb65ddc1c5f0)) - by @trancong12102
* add dashboard auth pages, real project CRUD, and UI components ([0fc2e17](https://github.com/better-update/better-update/commit/0fc2e179a6f3f87945f9ffe2d055cf62caa4da61)) - by @trancong12102
* add deployment analytics with WAE tracking, query API, and dashboard charts ([1b3c730](https://github.com/better-update/better-update/commit/1b3c730cea3158d57b4b1d4a7ea5331a27466f55)) - by @trancong12102
* add environment variables (Phase 2) ([e88b91f](https://github.com/better-update/better-update/commit/e88b91f1569c5a0f8176213c9d09f1f104140eb6)) - by @trancong12102
* add install link dialog with QR code to build cards ([0de0198](https://github.com/better-update/better-update/commit/0de0198bfeea08787ce8a62359436632b4148980)) - by @trancong12102
* add navigation progress bar, Suspense skeleton, and server-side API keys fetch ([72c3850](https://github.com/better-update/better-update/commit/72c385076fff4e5ef321bd83623f2ac5157b9fcb)) - by @trancong12102
* add project deletion with cascade cleanup ([5f494d5](https://github.com/better-update/better-update/commit/5f494d5cff7309bcb18a8a5eb7a3c378ebb546d7)) - by @trancong12102
* add project rename endpoint, pagination UI, and E2E tests ([c49a45c](https://github.com/better-update/better-update/commit/c49a45c89794dc7aa982459ceaf3ac4acc9f8a0e)) - by @trancong12102
* add promote/republish update UI to dashboard ([2a9cc7b](https://github.com/better-update/better-update/commit/2a9cc7bbb41eb021b223f8fa7524c2163e41ab41)) - by @trancong12102
* add testing pyramid with vitest, fix Better Auth D1 config ([9948af7](https://github.com/better-update/better-update/commit/9948af7bff9d5b6a728585431a8582dd29ee34a5)) - by @trancong12102
* add UI package with shadcn and configure dashboard styling ([ea8f3d9](https://github.com/better-update/better-update/commit/ea8f3d9ddcd3fe11c7c5852ba2ae12238f9d051e)) - by @trancong12102
* add user account management page ([6216644](https://github.com/better-update/better-update/commit/6216644b8fb8cb82ce12ab3fa5cce04812e3edc9)) - by @trancong12102
* add Workers-compatible auth hashing, unified error format, and active org fix ([8781ed7](https://github.com/better-update/better-update/commit/8781ed719111c6cd88cf435729972bfa7ce6bc7e)) - by @trancong12102
* **cli,server,dashboard:** close EAS Update feature gaps ([#4](https://github.com/better-update/better-update/issues/4), [#6](https://github.com/better-update/better-update/issues/6), [#7](https://github.com/better-update/better-update/issues/7), [#2](https://github.com/better-update/better-update/issues/2)) ([ecdc224](https://github.com/better-update/better-update/commit/ecdc22423f4117ab27ddac15e175329bf50c1031)) - by @trancong12102
* complete analytics tab with channel health and update traffic charts ([86d4827](https://github.com/better-update/better-update/commit/86d4827e4d9c1364fc37e527d3bb5a1ec1049ea0)) - by @trancong12102
* enforce FP patterns with Effect-TS, XState v5, and eslint-plugin-functional ([79c60c0](https://github.com/better-update/better-update/commit/79c60c09e13cfafd027d122646af5d23a2dbdb11)) - by @trancong12102
* harden auth config and add management API E2E tests ([a081e02](https://github.com/better-update/better-update/commit/a081e02465f85734798b545d1ac5e415fbf08e29)) - by @trancong12102
* implement updates and assets CRUD with R2 uploads and dashboard UI ([70c7940](https://github.com/better-update/better-update/commit/70c7940eaf87878842f91069e21a8f7c69e844f4)) - by @trancong12102
* read Vite server port from process.env.PORT ([93cf7c8](https://github.com/better-update/better-update/commit/93cf7c8c657d8ed243dc614399b91254964be31f)) - by @trancong12102
* **repo:** add ota build compatibility matrix ([a715a02](https://github.com/better-update/better-update/commit/a715a02b3130e33ffc6263203e4d08ee5f2adc17)) - by @trancong12102
* **repo:** add rollback-to-embedded flows ([f5fe1c4](https://github.com/better-update/better-update/commit/f5fe1c439ad7424dc671d84a7b81721e9b6976ad)) - by @trancong12102
* **repo:** add update lifecycle and credential flows ([f55cf5d](https://github.com/better-update/better-update/commit/f55cf5dea7874540fef6c9620ab8ced7c78e872f)) - by @trancong12102
* **repo:** expand build management coverage and dashboard details ([96d8d11](https://github.com/better-update/better-update/commit/96d8d11c41a171d67a3dad82d936c924a3e614c7)) - by @trancong12102
* **repo:** switch uploads to direct r2 flow ([736e7f1](https://github.com/better-update/better-update/commit/736e7f17d887a773b35038119981b31195b4f510)) - by @trancong12102

### Bug Fixes

* address council review findings for account management ([f1bb562](https://github.com/better-update/better-update/commit/f1bb56255c6be71225dee601148902deee04e048)) - by @trancong12102
* address council review findings for analytics tab ([4fc1c86](https://github.com/better-update/better-update/commit/4fc1c8611416572ccba529e6b569fbe14ccf4d06)) - by @trancong12102
* address council review findings for audit log ([badcd92](https://github.com/better-update/better-update/commit/badcd92998385bf803d1be12279f6b61a307c20e)) - by @trancong12102
* address council review findings for deployment analytics ([288f18f](https://github.com/better-update/better-update/commit/288f18fef4ebbf0e0d294a5a63be2af58760882b)) - by @trancong12102
* address council review findings for environment variables ([d1c91dd](https://github.com/better-update/better-update/commit/d1c91ddf338231ff13ee05cb0b9cdce58ab33352)) - by @trancong12102
* address council review findings for install link and org dialog ([1f637ac](https://github.com/better-update/better-update/commit/1f637ac9bf137665e4214b83393256a65dedadff)) - by @trancong12102
* address P1-P2 council review findings for credential vault ([dcbc47d](https://github.com/better-update/better-update/commit/dcbc47d5e422cd3d6fb625e004d766f83ed8eff1)) - by @trancong12102
* address P2-P3 council review findings for builds UI ([bb03152](https://github.com/better-update/better-update/commit/bb031520fcb291561c2955ed96ff873470b9fd33)) - by @trancong12102
* address remaining P2-P3 council review findings ([4d39840](https://github.com/better-update/better-update/commit/4d39840d7aee7fbddd270c8e854be88774b534dc)) - by @trancong12102
* address remaining P3 council review findings ([3ab79d5](https://github.com/better-update/better-update/commit/3ab79d5c09584758e2669597f5a0f4fa96d0dea2)) - by @trancong12102
* **dashboard:** remove build upload UI and restrict uploads to CLI only ([278b011](https://github.com/better-update/better-update/commit/278b0117945a6b766171df0a74d1443b0710ab10)) - by @trancong12102
* rename setTheme to updateTheme to satisfy react/hook-use-state ([796b599](https://github.com/better-update/better-update/commit/796b59950a19dee063e56a3fb5e4f6df97311700)) - by @trancong12102
* **repo:** add knip dead code detection, fix timing-safe HMAC verification ([ef3e3b6](https://github.com/better-update/better-update/commit/ef3e3b6c6d936e85346ed2b0f53941e92cc8d226)) - by @trancong12102
* **repo:** harden update publish and republish flows ([5b2a7b7](https://github.com/better-update/better-update/commit/5b2a7b7dc164baf29bbe54db83174f3a1f09b503)) - by @trancong12102
* **server:** harden auth, deduplicate code, and fix council review findings ([f268f01](https://github.com/better-update/better-update/commit/f268f01574ee31e1f7094f1cf37fb0b660067ca0)) - by @trancong12102
* **server:** implement expo-current-update-id 204 short-circuit and reduce response copies ([021c6a7](https://github.com/better-update/better-update/commit/021c6a7a5258da87baefcf9947159eea386d9849)) - by @trancong12102

### Performance Improvements

* **dashboard:** share single server across all E2E tests via globalSetup ([b6d4448](https://github.com/better-update/better-update/commit/b6d44484d3d7b29560b28172e1a2f71b3b89cea4)) - by @trancong12102
