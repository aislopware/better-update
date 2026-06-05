# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.6.1](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.6.0...@better-update/auth-client@0.6.1) (2026-06-05)

**Note:** Version bump only for package @better-update/auth-client

## [0.6.0](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.5.0...@better-update/auth-client@0.6.0) (2026-06-04)

### ⚠ BREAKING CHANGES

* **authz:** authz model replaced (organization_role/environment_grant dropped,
no migration); api-keys and non-owner members are default-deny until a policy is
attached; member.role is owner|member only. Prod data is wiped before deploy.

### Features

* **authz:** unify better-auth and IAM into a single policy gate ([92a3cf2](https://github.com/better-update/better-update/commit/92a3cf21a461aabb61d84d20ba11e781bcec21aa)) - by @trancong12102

## [0.5.0](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.4.1...@better-update/auth-client@0.5.0) (2026-06-03)

### Features

* **server:** add IAM-style authz with roles and per-scope ABAC grants ([a2cfd9c](https://github.com/better-update/better-update/commit/a2cfd9c4ef4f3aa2d69e3542c61074eda85cd54c)) - by @trancong12102

## [0.4.1](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.4.0...@better-update/auth-client@0.4.1) (2026-06-03)

**Note:** Version bump only for package @better-update/auth-client

## [0.4.0](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.3.1...@better-update/auth-client@0.4.0) (2026-06-02)

### Features

* **auth:** superadmin-gated user approval for dev phase ([69f97e3](https://github.com/better-update/better-update/commit/69f97e3ab39436f97decd3fca454d63e9ec794bb)) - by @trancong12102

## [0.3.1](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.3.0...@better-update/auth-client@0.3.1) (2026-06-01)

**Note:** Version bump only for package @better-update/auth-client

## [0.3.0](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.2.6...@better-update/auth-client@0.3.0) (2026-05-27)

### Features

* **auth:** authenticate the CLI with Better Auth sessions ([61444d2](https://github.com/better-update/better-update/commit/61444d28ad50acf60d37877f7ccb10b38c33df0f)) - by @trancong12102

## [0.2.6](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.2.5...@better-update/auth-client@0.2.6) (2026-05-21)

**Note:** Version bump only for package @better-update/auth-client

## [0.2.5](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.2.4...@better-update/auth-client@0.2.5) (2026-05-19)

**Note:** Version bump only for package @better-update/auth-client

## [0.2.4](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.2.3...@better-update/auth-client@0.2.4) (2026-05-18)

**Note:** Version bump only for package @better-update/auth-client

## [0.2.3](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.2.2...@better-update/auth-client@0.2.3) (2026-05-13)

**Note:** Version bump only for package @better-update/auth-client

## [0.2.2](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.2.1...@better-update/auth-client@0.2.2) (2026-05-07)

**Note:** Version bump only for package @better-update/auth-client

## [0.2.1](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.2.0...@better-update/auth-client@0.2.1) (2026-05-06)

**Note:** Version bump only for package @better-update/auth-client

## 0.2.0 (2026-05-06)

### ⚠ BREAKING CHANGES

* **web:** server env vars ACCOUNTS_URL and CONSOLE_URL are
replaced by WEB_URL. CLI config key accountsUrl and env
BETTER_UPDATE_ACCOUNTS_URL are replaced by webUrl and
BETTER_UPDATE_WEB_URL.

### Features

* **accounts:** github-only login redesign + dashboard→console split cleanup ([121f822](https://github.com/better-update/better-update/commit/121f822bcfd9e379d23d4d6b3e5c01849cf625d1)) - by @

### Code Refactoring

* **web:** merge accounts + dashboard into apps/web TanStack Start SSR ([98c4e10](https://github.com/better-update/better-update/commit/98c4e10b7040f60f0a909145fc320f2bf1355907)) - by @trancong12102

## [0.1.1](https://github.com/better-update/better-update/compare/@better-update/auth-client@0.1.0...@better-update/auth-client@0.1.1) (2026-04-22)

**Note:** Version bump only for package @better-update/auth-client

## 0.1.0 (2026-04-22)

### Features

* **accounts:** github-only login redesign + dashboard→console split cleanup ([121f822](https://github.com/better-update/better-update/commit/121f822bcfd9e379d23d4d6b3e5c01849cf625d1)) - by @trancong12102
