# Build Management Specification

Implementation spec for better-update's build management — credential vault, environment variables, and build registry for Expo/React Native apps. Users build locally via CLI (like EAS), with credentials and env vars managed centrally on better-update server.

---

## Table of Contents

1. [Architecture](./01-architecture.md) — System overview, build flow, scope boundaries
2. [Credential Vault](./02-credential-vault.md) — Encrypted storage for signing credentials, interactive provisioning
3. [Environment Variables](./03-environment-variables.md) — Secret & plaintext env var management per project/environment
4. [Data Model](./04-data-model.md) — D1 schema for builds, credentials, env vars
5. [API Endpoints](./05-api-endpoints.md) — Build, credential, env var management API
6. [Artifact Management](./06-artifact-management.md) — Upload, storage, metadata extraction, install links
7. [CLI Design](./07-cli-design.md) — `better-update build` interactive flow, credential provisioning
8. [OTA Integration](./08-ota-integration.md) — Linking builds to update channels via runtimeVersion
9. [Implementation Plan](./09-implementation-plan.md) — Phased delivery roadmap

## Scope Notes

- **Cloud Build is out of scope** — this spec only supports builds that run on a developer machine or the user's own CI
- **Auto-Submit** — Submit to App Store / Play Store after build
