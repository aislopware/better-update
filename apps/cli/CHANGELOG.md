# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.33.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.32.0...@better-update/cli@0.33.0) (2026-06-08)

### Features

* **credentials:** create & revoke APNs push keys via Apple ID ([06e6503](https://github.com/better-update/better-update/commit/06e65032a5d54131321478a78798e95ef9fe977b)) - by @trancong12102

## [0.32.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.31.1...@better-update/cli@0.32.0) (2026-06-08)

### Features

* **devices:** sync device roster with App Store Connect ([5b4e0ca](https://github.com/better-update/better-update/commit/5b4e0ca3f86fa87b99b151cccd2e09c2681cebd8)) - by @trancong12102

## [0.31.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.31.0...@better-update/cli@0.31.1) (2026-06-08)

### Bug Fixes

* **devices:** translate invalid appleTeamId to 404 instead of 500 ([6ad96d9](https://github.com/better-update/better-update/commit/6ad96d917e7bab3ec53fbd30d90155f6fdfde290)) - by @trancong12102

## [0.31.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.30.0...@better-update/cli@0.31.0) (2026-06-08)

### Features

* **credentials:** capture & display Google service-account client_id (EAS parity) ([e14e8f7](https://github.com/better-update/better-update/commit/e14e8f70352f542cb2700384e83795f2eff4d72b)) - by @trancong12102

## [0.30.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.29.2...@better-update/cli@0.30.0) (2026-06-08)

### Features

* **credentials:** store & show Android keystore type (JKS/PKCS12) ([20cd16c](https://github.com/better-update/better-update/commit/20cd16cf3ac9cc5f1e9acec9cddfb5dbef851a8e)) - by @trancong12102

## [0.29.2](https://github.com/better-update/better-update/compare/@better-update/cli@0.29.1...@better-update/cli@0.29.2) (2026-06-08)

### Bug Fixes

* **credentials:** extract & store Android keystore SHA-1/SHA-256 fingerprints on upload ([c639682](https://github.com/better-update/better-update/commit/c639682de0e7a950f6b52a024582778208430f76)) - by @trancong12102

## [0.29.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.29.0...@better-update/cli@0.29.1) (2026-06-05)

### Bug Fixes

* **cli:** reuse cached vault key for write/seal operations after unlock ([119b93b](https://github.com/better-update/better-update/commit/119b93b85c8ea2a59e20d2094e0830ea1cd8b0c0)) - by @trancong12102
* **credentials:** bind Android keystore to seeded Default group, not a duplicate create ([a9ca514](https://github.com/better-update/better-update/commit/a9ca5149cf49ceb7371a947672df0b111afd51e7)) - by @trancong12102

## [0.29.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.28.1...@better-update/cli@0.29.0) (2026-06-05)

### Features

* **environments:** user-defined environments + built-in dev/preview/production lock ([a647410](https://github.com/better-update/better-update/commit/a647410b7f4865c2a797f0b8c5d04add0b74fa96)) - by @trancong12102

## [0.28.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.28.0...@better-update/cli@0.28.1) (2026-06-05)

**Note:** Version bump only for package @better-update/cli

## [0.28.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.27.0...@better-update/cli@0.28.0) (2026-06-04)

### ⚠ BREAKING CHANGES

* **authz:** authz model replaced (organization_role/environment_grant dropped,
no migration); api-keys and non-owner members are default-deny until a policy is
attached; member.role is owner|member only. Prod data is wiped before deploy.

### Features

* **authz:** unify better-auth and IAM into a single policy gate ([92a3cf2](https://github.com/better-update/better-update/commit/92a3cf21a461aabb61d84d20ba11e781bcec21aa)) - by @trancong12102

## [0.27.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.26.1...@better-update/cli@0.27.0) (2026-06-03)

### Features

* **server:** add IAM-style authz with roles and per-scope ABAC grants ([a2cfd9c](https://github.com/better-update/better-update/commit/a2cfd9c4ef4f3aa2d69e3542c61074eda85cd54c)) - by @trancong12102

## [0.26.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.26.0...@better-update/cli@0.26.1) (2026-06-03)

**Note:** Version bump only for package @better-update/cli

## [0.26.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.25.0...@better-update/cli@0.26.0) (2026-06-03)

### Features

* **cli:** build generic non-Expo apps (bare RN, KMP, native, custom) ([#12](https://github.com/better-update/better-update/issues/12)) ([2752079](https://github.com/better-update/better-update/commit/2752079d6c7c7b64684e5dc074f7859be6cafd64)) - by @trancong12102

## [0.25.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.24.2...@better-update/cli@0.25.0) (2026-06-02)

### Features

* **cli:** cache unlocked vault key in OS keychain ([3b7544c](https://github.com/better-update/better-update/commit/3b7544c19684a80ddaf5745abfdfff67ff9f0450)) - by @trancong12102

## [0.24.2](https://github.com/better-update/better-update/compare/@better-update/cli@0.24.1...@better-update/cli@0.24.2) (2026-06-02)

**Note:** Version bump only for package @better-update/cli

## [0.24.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.24.0...@better-update/cli@0.24.1) (2026-06-02)

**Note:** Version bump only for package @better-update/cli

## [0.24.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.23.0...@better-update/cli@0.24.0) (2026-06-01)

### Features

* **cli:** --json envelope + --non-interactive contract across every command ([0d2be64](https://github.com/better-update/better-update/commit/0d2be64fd3efaaed272ff51f86a8e9290d4d178d)) - by @trancong12102
* **cli:** bsdiff publish pipeline + embedded-upload + runtime-version/fingerprint + code-signing render + configure ([e88d52a](https://github.com/better-update/better-update/commit/e88d52af82915cb57d18841f067069b4ea455e9f)) - by @trancong12102
* **cli:** make credentials & env vault build-system-agnostic ([72df672](https://github.com/better-update/better-update/commit/72df672574f06a54927b4218556d75205f657b6c)) - by @trancong12102
* **ota:** server-side signature policy, bundle-diffing hardening, self-verify harness ([6caca42](https://github.com/better-update/better-update/commit/6caca42031007cdffb7bd4e86896c1c4a82d16d1)) - by @trancong12102
* **server:** add clock-skew guard, scope-key + signed-update recency invariant ([ae0eec5](https://github.com/better-update/better-update/commit/ae0eec571e0216b420aea77ac32acf389186df63)) - by @trancong12102

### Bug Fixes

* **cli:** fingerprint generate/compare compatibility (@expo/fingerprint >=0.13 + citty) ([552e6f1](https://github.com/better-update/better-update/commit/552e6f164d493bb39e529bda20d32f8c20b687fe)) - by @trancong12102
* **lint:** use default node:path import for oxlint 1.67 import-style ([3983aba](https://github.com/better-update/better-update/commit/3983aba521b86b54813c7756b99ed4d8ef39627e)) - by @trancong12102

## [0.23.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.22.1...@better-update/cli@0.23.0) (2026-05-28)

### ⚠ BREAKING CHANGES

* **env-vars:** migration 0049 recreates env_vars without a plaintext value
column; existing env var data is dropped and must be re-set via the CLI.
* **env-vars:** env vars are keyed by (scope, key, environment) with a
per-environment value; existing rows are recreated empty (no data migration).

### Features

* **env-vars:** end-to-end encrypt + version environment variables ([#9](https://github.com/better-update/better-update/issues/9)) ([7062a44](https://github.com/better-update/better-update/commit/7062a4448d8640bdcc41de7d2dcf86cb8259662a)) - by @trancong12102
* **env-vars:** scope env var uniqueness to (key, environment) ([8394cab](https://github.com/better-update/better-update/commit/8394cab2aee4d97f9146a439e09096ba5ab0ef48)) - by @trancong12102

### Bug Fixes

* **cli:** point identity create hint to the right next step (init vs grant) ([0ad31da](https://github.com/better-update/better-update/commit/0ad31daf72203310fa2cd9812d706b434d2fa8cc)) - by @trancong12102

## [0.22.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.22.0...@better-update/cli@0.22.1) (2026-05-27)

### Bug Fixes

* **cli:** close login callback server cleanly and keep success tab open ([a875b6e](https://github.com/better-update/better-update/commit/a875b6e8605fb6c1c78fcd2de4824a286c36f8be)) - by @trancong12102

## [0.22.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.21.0...@better-update/cli@0.22.0) (2026-05-27)

### Features

* **auth:** authenticate the CLI with Better Auth sessions ([61444d2](https://github.com/better-update/better-update/commit/61444d28ad50acf60d37877f7ccb10b38c33df0f)) - by @trancong12102

## [0.21.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.20.0...@better-update/cli@0.21.0) (2026-05-21)

### Features

* client-side E2E encrypted credential vault ([6e36671](https://github.com/better-update/better-update/commit/6e3667168e57a90a422b389f3e6337a13f8dddc4)) - by @trancong12102

## [0.20.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.19.1...@better-update/cli@0.20.0) (2026-05-19)

### Features

* **cli:** support EAS development builds (developmentClient + withoutCredentials) ([9217b73](https://github.com/better-update/better-update/commit/9217b73ea20c1fe4071ca25572c58f7c2ca51c74)) - by @trancong12102
* store submissions, iOS app metadata, credentials EAS-parity rework ([4198f66](https://github.com/better-update/better-update/commit/4198f66c7171ba065c2712e0d0007a6166d4983e)) - by @trancong12102

## [0.19.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.19.0...@better-update/cli@0.19.1) (2026-05-19)

### Bug Fixes

* **cli:** merge eas.json profile.env into build/upload envVars ([c0993a4](https://github.com/better-update/better-update/commit/c0993a4c4d63c79965443131b04d63e98020df10)) - by @trancong12102

## [0.19.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.18.4...@better-update/cli@0.19.0) (2026-05-19)

### Features

* **builds:** mark dirty git working tree on build records ([e5d99cf](https://github.com/better-update/better-update/commit/e5d99cf2c5522ea1de04222849bc7e5c5d444ca5)) - by @trancong12102

## [0.18.4](https://github.com/better-update/better-update/compare/@better-update/cli@0.18.3...@better-update/cli@0.18.4) (2026-05-19)

### Bug Fixes

* **cli:** auto-generate Android keystore in build flow ([56cfe55](https://github.com/better-update/better-update/commit/56cfe55623cbd1ccdff616b08c97cb905d7d98cb)) - by @trancong12102

## [0.18.3](https://github.com/better-update/better-update/compare/@better-update/cli@0.18.2...@better-update/cli@0.18.3) (2026-05-19)

### Bug Fixes

* **cli:** retry transient HTTP errors on all API calls ([76883f6](https://github.com/better-update/better-update/commit/76883f6a2f18f9447cbc06f7cd751e9563d409fa)) - by @trancong12102

## [0.18.2](https://github.com/better-update/better-update/compare/@better-update/cli@0.18.1...@better-update/cli@0.18.2) (2026-05-19)

### Bug Fixes

* **cli:** git init staging dir so prepare scripts find a repo ([bacb09c](https://github.com/better-update/better-update/commit/bacb09c7cf78d88296de59edbc4c1606827eb783)) - by @trancong12102

## [0.18.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.18.0...@better-update/cli@0.18.1) (2026-05-19)

### Bug Fixes

* **cli:** chmod +x node-pty spawn-helper to survive bun global install ([97e72d5](https://github.com/better-update/better-update/commit/97e72d510dae4c734e9f8e39212b46660ea64eeb)) - by @trancong12102

## [0.18.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.17.0...@better-update/cli@0.18.0) (2026-05-19)

### Features

* android multi credential sets resolvable by build profile ([7e71890](https://github.com/better-update/better-update/commit/7e718901a77df5bb180417a459870acb5751a212)) - by @trancong12102
* dashboard parity wave (fingerprints, env vars, build audience, update detail) ([d9930d7](https://github.com/better-update/better-update/commit/d9930d7575f435c120e153237dcee7f35b191d57)) - by @trancong12102

## [0.17.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.16.0...@better-update/cli@0.17.0) (2026-05-18)

### Features

* **cli:** isolate native builds in staging tmpdir (EAS-style) ([da8bcb4](https://github.com/better-update/better-update/commit/da8bcb4dc9985b7004bcf72d2757891a82509c63)) - by @trancong12102

## [0.16.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.15.4...@better-update/cli@0.16.0) (2026-05-18)

### Features

* **cli:** style warnings yellow + forward sub-CLI output via PTY ([b58481b](https://github.com/better-update/better-update/commit/b58481b9697740b38444102c3ae7e1b85a44b539)) - by @trancong12102

## [0.15.4](https://github.com/better-update/better-update/compare/@better-update/cli@0.15.3...@better-update/cli@0.15.4) (2026-05-18)

### Bug Fixes

* **cli:** use Xcode 15.3+ ExportOptions.plist method names ([8444d28](https://github.com/better-update/better-update/commit/8444d28d8f67fa763daf6360a06579366decf66e)) - by @trancong12102

## [0.15.3](https://github.com/better-update/better-update/compare/@better-update/cli@0.15.2...@better-update/cli@0.15.3) (2026-05-18)

### Bug Fixes

* **cli:** ensure credentials per signed iOS target before downloading ([f04b08b](https://github.com/better-update/better-update/commit/f04b08bea9ea5e7dc669cd3a45be187f433efbb7)) - by @trancong12102

## [0.15.2](https://github.com/better-update/better-update/compare/@better-update/cli@0.15.1...@better-update/cli@0.15.2) (2026-05-18)

### Bug Fixes

* **cli:** upsert iOS bundle config so cert-deletion doesn't strand setup ([6b17b6c](https://github.com/better-update/better-update/commit/6b17b6c9b2ab797f3c5e8e7f193baa60228d4a96)) - by @trancong12102

## [0.15.1](https://github.com/better-update/better-update/compare/@better-update/cli@0.15.0...@better-update/cli@0.15.1) (2026-05-18)

### Bug Fixes

* **server,cli:** fall back to org+team ASC key when bundle config has none bound ([41671aa](https://github.com/better-update/better-update/commit/41671aaed30332a133138b47dac5e4d9311030ac)) - by @trancong12102

## [0.15.0](https://github.com/better-update/better-update/compare/@better-update/cli@0.14.3...@better-update/cli@0.15.0) (2026-05-18)

### Features

* **cli:** unblock multi-target iOS builds with per-target signing + auto-provision ([b8af83b](https://github.com/better-update/better-update/commit/b8af83be500cfaca7a2532a5160afe74e6fa914a)) - by @trancong12102

## [0.14.3](https://github.com/better-update/better-update/compare/@better-update/cli@0.14.2...@better-update/cli@0.14.3) (2026-05-18)

### Bug Fixes

* **cli:** unwrap @expo/plist default export for Node ESM ([a4f54b6](https://github.com/better-update/better-update/commit/a4f54b6b6cb425578202c1cc2f2d32dfe329e2d1)) - by @trancong12102

## [0.14.2](https://github.com/better-update/better-update/compare/@better-update/cli@0.14.1...@better-update/cli@0.14.2) (2026-05-18)

### Bug Fixes

* **cli:** use apple_teams UUID when binding iOS bundle config ([fe552d3](https://github.com/better-update/better-update/commit/fe552d30f25b3a531a15b60c2e0d1b7aa1f92e4a)) - by @trancong12102

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
