# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
