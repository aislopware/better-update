# 1. Architecture

## Overview

better-update's build management provides **centralized credential and env var management + a build registry** for Expo/React Native apps. Builds execute locally on the developer's machine (or their own CI). The CLI pulls credentials and env vars from the server, runs the build, then uploads the artifact back.

This mirrors EAS Build's local mode (`eas build --local`) but without any Expo server dependency.

```mermaid
graph TB
    subgraph BU["better-update Server (Cloudflare)"]
        API["Management API"]
        D1[(D1)]
        KV[("BUILD_RESERVATIONS (KV)<br/>upload reservations")]
        BuildR2[("BUILD_BUCKET (private R2)<br/>credentials + artifacts")]
        OtaR2[("ASSETS_BUCKET (public R2)<br/>OTA assets")]
    end

    subgraph Local["Developer's Machine / CI"]
        CLI["better-update CLI"]
        Prebuild["expo prebuild"]
        Build["xcodebuild / gradlew"]
        Artifact[".ipa / .aab / .apk"]
    end

    subgraph Devices["End User Devices"]
        App["Expo App"]
    end

    CLI -->|"1. pull credentials"| API
    CLI -->|"2. pull env vars"| API
    API --> BuildR2
    API --> D1
    API --> KV
    CLI --> Prebuild --> Build --> Artifact
    Artifact -->|"3. presigned upload"| BuildR2
    App -->|"OTA update check"| API
    API --> OtaR2
```

**Storage separation**: `BUILD_BUCKET` is a **private** R2 bucket for credentials and artifacts — never publicly accessible. `ASSETS_BUCKET` remains the existing **public** R2 bucket for OTA assets served via CDN. These are two separate bindings in `wrangler.jsonc`.

**Artifact upload**: Large artifacts (up to 500 MB) are uploaded directly to R2 via presigned URL, bypassing the Worker's request body limits. The flow is: CLI requests a presigned URL → CLI uploads directly to R2 → CLI calls the server to finalize the build record.

## Scope Boundaries

### What better-update does

- **Credential vault** — store iOS certs/profiles and Android keystores encrypted on the server; CLI pulls them for local builds; interactive provisioning on first build (like EAS)
- **Environment variables** — store per-project per-environment vars on the server; CLI exports them before build
- **Build registry** — store .ipa/.aab/.apk artifacts in R2, track metadata in D1
- **Build history** — list, filter, delete builds per project
- **Artifact distribution** — download links, iOS OTA install (itms-services), QR codes
- **OTA compatibility** — link builds to update channels via runtimeVersion
- **Dashboard** — manage credentials, env vars, builds (like Expo console)

### What better-update does NOT do

- **Execute builds remotely** — builds run on the user's machine or CI, and remote Cloud Build is out of scope
- **Submit to stores** — user submits to App Store / Play Store themselves
- **Manage Apple Developer account** — user creates certs/profiles in Apple Developer portal themselves (better-update stores them, does not create them)

## Request Flows

**First build (no credentials yet):**

```mermaid
flowchart TD
    CLI["better-update build"] --> Check{"Credentials\nexist on server?"}
    Check -->|No| Prompt["Interactive prompt:\n1. Select .p12 file\n2. Select .mobileprovision\n3. Enter passwords"]
    Prompt --> Upload["Upload to vault\n(encrypted, stored in R2)"]
    Upload --> Pull["Pull credentials to temp files"]
    Check -->|Yes| Pull
    Pull --> Env["Pull env vars → export to shell"]
    Env --> Prebuild["expo prebuild"]
    Prebuild --> Build["xcodebuild / gradlew"]
    Build --> ArtifactUpload["Upload .ipa/.aab\n(presigned URL → R2 staging → finalize)"]
    ArtifactUpload --> Cleanup["Delete temp credential files\n(cleanup trap)"]
```

**Subsequent builds (credentials exist):**

```mermaid
flowchart LR
    CLI -->|"pull creds + env vars"| Server
    Server --> CLI
    CLI -->|"build locally"| Artifact
    Artifact -->|"upload"| Server
```

## Cost Model

| Component                                             | Monthly cost (100 builds) |
| ----------------------------------------------------- | ------------------------- |
| R2 storage (artifacts ~50 MB avg + credentials ~1 MB) | ~$0.75                    |
| D1 reads/writes                                       | Negligible                |
| KV reads/writes (build reservations)                  | Negligible                |
| Worker invocations                                    | Negligible                |
| **Total**                                             | **< $1/month**            |

## Service Mapping

| Service                       | Role                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| **Worker**                    | Build management API, credential encryption/decryption                                             |
| **D1**                        | Build metadata, credential metadata, env var storage (including encrypted values)                  |
| **BUILD_BUCKET** (private R2) | Artifact binaries (staging/ + artifacts/ prefixes), encrypted credential blobs                     |
| **BUILD_RESERVATIONS** (KV)   | Transient build upload reservations (3-hour TTL, holds metadata until `/complete` inserts D1 rows) |
| **ASSETS_BUCKET** (public R2) | OTA assets only — unchanged from existing server spec                                              |

### Why Two R2 Buckets

The existing `ASSETS_BUCKET` is a public bucket with CDN caching for OTA asset serving (see [server spec 05](../server/05-asset-serving.md)). Build artifacts and credentials are private data that must never be publicly accessible. Sharing one bucket would require per-prefix access control that R2 does not support — a separate private bucket is the correct boundary.
