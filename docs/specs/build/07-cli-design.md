# 7. CLI Design

## Overview

The `better-update` CLI orchestrates local builds — it downloads **encrypted** credentials and decrypts them locally with the device identity key, pulls env vars from the server, runs `expo prebuild` + native tooling, then uploads the artifact. Credentials are end-to-end encrypted: the CLI is the only place encryption and decryption happen, and the server is zero-knowledge (see [02-credential-vault.md](./02-credential-vault.md)). The UX mirrors `eas build --local`: interactive credential provisioning on first run, then zero-config on subsequent runs.

## Build Command

```bash
# Build with default profile (production), both platforms
better-update build

# Build specific platform
better-update build --platform ios
better-update build --platform android

# Build with named profile
better-update build --profile preview

# Build with message
better-update build --profile production --message "v1.2.0 release"

# Skip upload (build only, don't push artifact to server)
better-update build --no-upload
```

### Build Flow (detailed)

```
$ better-update build --platform ios --profile production

  ● Resolving project...
    Project: my-app (com.example.app)
    Profile: production
    Platform: iOS

  ● Checking credentials...
    ✓ Distribution certificate: "Apple Distribution: Your Team" (expires 2027-04-11)
    ✓ Provisioning profile: "MyApp AppStore" (app-store)

  ● Pulling environment variables (production)...
    ✓ 5 variables exported

  ● Running expo prebuild...
    ✓ iOS native project generated

  ● Installing CocoaPods...
    ✓ Pods installed

  ● Building (xcodebuild archive)...
    ▸ Compiling sources...
    ▸ Linking...
    ✓ Archive succeeded (14m 12s)

  ● Exporting IPA...
    ✓ MyApp.ipa (52 MB)

  ● Uploading to better-update...
    ✓ Build uploaded

  ✓ Build complete

    ID:             01JXYZ...
    Version:        1.2.0 (42)
    Runtime:        abc123def...
    Size:           52 MB
    Dashboard:      https://updates.example.com/projects/.../builds/01JXYZ...
```

### First Build (No Credentials)

When credentials don't exist for the project+platform+distribution. On the very first credential operation the CLI also sets up the **encryption identity** (a per-device key sealed with a passphrase) — credentials are encrypted locally before upload, and the server never sees plaintext (see [02-credential-vault.md](./02-credential-vault.md)):

```
$ better-update build --platform ios --profile production

  ● Setting up your encryption identity (first credential operation)...
    No identity found — running `credentials identity init`
  ? Choose a passphrase to protect your device key:
    > ••••••••
    ✓ Identity created and registered (fingerprint SHA256:ab12...)
    ✓ Vault access ready (bootstrapped org vault + offline recovery key shown once)

  ● Checking credentials...
    ✗ No iOS distribution certificate found

  ? How would you like to provide a distribution certificate?
    ❯ Select .p12 file from disk
      I'll set up credentials later (skip build)

  ? Select distribution certificate (.p12):
    > ~/certs/dist.p12

  ? Certificate password:
    > ••••••••

  ✓ Certificate encrypted locally and uploaded: "Apple Distribution: Your Team (XXXXXXXXXX)"
    Expires: 2027-04-11

  ✗ No iOS provisioning profile found

  ? Select provisioning profile (.mobileprovision):
    > ~/certs/AppStore.mobileprovision

  ✓ Profile uploaded: "MyApp AppStore"
    Bundle ID: com.example.app
    Type: app-store

  ● Building...
    ...
```

> If you are not yet a granted vault recipient (an admin must grant you, or you self-link from another device), credential upload is blocked — you can still see metadata. See [02-credential-vault.md](./02-credential-vault.md).

### Android First Build

```
  ● Checking credentials...
    ✗ No Android keystore found

  ? How would you like to provide a keystore?
    ❯ Select .jks/.keystore file from disk
      Generate a new keystore

  [If "Generate new"]
  ? Key alias: my-key-alias
  ? Keystore password: ••••••••
  ? Key password: ••••••••
  ? Your name (CN): John Doe
  ? Organization (O): My Company

  ✓ Keystore generated, encrypted locally, and uploaded
```

## Credential Commands

All credential material is **end-to-end encrypted client-side**: `upload`/`generate-keystore` parse, extract metadata, encrypt, and wrap the DEK locally before sending ciphertext; `download` fetches ciphertext and decrypts locally with the device identity key. The server never sees plaintext. Uploading or downloading requires being a granted vault recipient. Command flags and exact behavior are canonical in [02-credential-vault.md](./02-credential-vault.md); the set below is illustrative.

```bash
# Manage your encryption identity (per-device key, sealed with a passphrase)
better-update credentials identity init                 # generate key, seal locally, register public key
better-update credentials identity list                 # show this org's recipients + fingerprints
better-update credentials identity rotate                # generate a fresh device key + re-link
better-update credentials identity passphrase change     # re-seal identity.json locally (server untouched)

# Manage vault access / recipients (grant/revoke gated to admin/owner)
better-update credentials access list                    # recipients + pending-access members
better-update credentials access grant <user>            # admin: re-wrap vault key to a new recipient
better-update credentials access revoke <recipient>      # admin: revoke — ALWAYS rotates the vault key
better-update credentials access rotate                  # admin: rotate vault key without removing anyone
better-update credentials access recover                 # admin: restore access via offline recovery key
better-update credentials access recovery rotate         # admin: replace the offline recovery key

# Link a new device to the org vault from an existing device (self-service, no admin)
better-update credentials device link

# List all credentials (metadata only)
better-update credentials list
better-update credentials list --platform ios

# Upload a credential (encrypted locally, then uploaded as ciphertext)
better-update credentials upload \
  --platform ios \
  --type distribution-certificate \
  --file ./certs/dist.p12 \
  --password "p12-password" \
  --name "Production Cert 2026"

# Upload provisioning profile (--distribution required for profiles)
better-update credentials upload \
  --platform ios \
  --type provisioning-profile \
  --distribution app-store \
  --file ./certs/AppStore.mobileprovision \
  --name "AppStore Profile"

# Upload Android keystore (keystore + key passwords folded into the encrypted blob)
better-update credentials upload \
  --platform android \
  --type keystore \
  --file ./keystores/release.jks \
  --password "keystore-password" \
  --key-alias "my-key" \
  --key-password "key-password" \
  --name "Release Keystore"

# Delete credential (removes R2 ciphertext + D1 row)
better-update credentials delete cred_01HXYZ...

# Generate a new Android keystore, encrypt locally, and upload
better-update credentials generate-keystore \
  --name "Release Keystore" \
  --key-alias "my-key"

# Clear the cached (unlocked) vault key from the OS keychain
better-update credentials lock
```

## Environment Variable Commands

```bash
# Set a variable
better-update env set EXPO_PUBLIC_API_URL=https://api.example.com \
  --environment production

# Set with visibility
better-update env set SENTRY_AUTH_TOKEN=xxx \
  --environment production \
  --visibility secret

# List variables
better-update env list --environment production

# Delete variable
better-update env delete EXPO_PUBLIC_API_URL --environment production

# Import from .env file
better-update env import .env.production --environment production

# Export to .env file (all values including secrets — requires API key auth)
better-update env export --environment production > .env.production

# Pull all variables to local shell (for manual local dev)
eval $(better-update env pull --environment development)
```

## Project Commands

```bash
# Initialize project (link to better-update) — works for ANY project, not just Expo
better-update init
# Expo project (app.json / app.config.* present):
#   1. Reads app.json for project name + slug
#   2. Creates project on server (or links to existing)
#   3. Writes projectId to app.json expo.extra.betterUpdate.projectId
# Non-Expo project (KMP / Flutter / native — no app.json):
#   1. Derives name/slug from --name/--slug, else package.json `name`, else the directory name
#   2. Creates project on server (or links to existing)
#   3. Writes { "projectId": "…" } to better-update.json at the project root
better-update init --name "My App" --slug my-app   # non-Expo, explicit
better-update init --id <projectId>                 # link by explicit id (any project)

# Project-id resolution (every credentials/* and env/* command, build-system-agnostic):
#   1. BETTER_UPDATE_PROJECT_ID environment variable
#   2. better-update.json  ({ "projectId": "…" })
#   3. Expo config         (extra.betterUpdate.projectId, only when @expo/config is installed)
# @expo/config is loaded lazily/optionally, so a project without Expo never crashes.

# Show project status
better-update status
# Shows: project info, credential health, recent builds

# List recent builds
better-update builds
better-update builds --platform ios --limit 10
```

## Local Build Execution

The CLI executes the build locally using standard tooling:

### iOS Build Steps

```bash
# 0. Create unique per-build temp directory
BUILD_DIR=$(mktemp -d "$TMPDIR/better-update-XXXXXXXX")
chmod 0700 "$BUILD_DIR"
KEYCHAIN_NAME="better-update-$(uuidgen)"

# Register cleanup trap (runs on EXIT, SIGINT, SIGTERM)
trap 'rm -rf "$BUILD_DIR"; security delete-keychain "$KEYCHAIN_NAME" 2>/dev/null' EXIT INT TERM

# 1. Resolve credentials: download ciphertext + decrypt locally
#    → unlock identity (or cached vault key) → unwrap DEK → decrypt blob
#    → write decrypted .p12 to $BUILD_DIR/cert.p12
#    → write .mobileprovision to $BUILD_DIR/profile.mobileprovision (plaintext, not secret)

# 2. Export env vars (API key auth only)
#    → GET /api/env-vars/export?projectId=X&environment=production
#    → export each key=value

# 3. Prebuild
npx expo prebuild --platform ios --clean

# 4. Install CocoaPods
cd ios && pod install

# 5. Setup code signing
#    → create ephemeral keychain named $KEYCHAIN_NAME (unique per build)
#    → import .p12 to keychain
#    → install provisioning profile to ~/Library/MobileDevice/Provisioning Profiles/

# 6. Build
xcodebuild -workspace ios/*.xcworkspace \
  -scheme <auto-detected> \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath $BUILD_DIR/archive.xcarchive \
  archive \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="<from cert>" \
  PROVISIONING_PROFILE_SPECIFIER="<from profile>"

# 7. Export
xcodebuild -exportArchive \
  -archivePath $BUILD_DIR/archive.xcarchive \
  -exportPath $BUILD_DIR/output \
  -exportOptionsPlist <generated>

# 8. Upload artifact to server (presigned staging URL, 2-hour expiry)
# 9. Cleanup: trap fires → $BUILD_DIR deleted, keychain removed
```

### Android Build Steps

```bash
# 0. Create unique per-build temp directory
BUILD_DIR=$(mktemp -d "$TMPDIR/better-update-XXXXXXXX")
chmod 0700 "$BUILD_DIR"
trap 'rm -rf "$BUILD_DIR"' EXIT INT TERM

# 1. Resolve keystore: download ciphertext + decrypt locally → write to $BUILD_DIR/release.keystore
# 2. Export env vars
# 3. Prebuild
npx expo prebuild --platform android --clean

# 4. Write Gradle init script for signing → $BUILD_DIR/signing.gradle
# 5. Build
cd android && ./gradlew bundleRelease --init-script $BUILD_DIR/signing.gradle

# 6. Upload artifact to server (presigned staging URL, 2-hour expiry)
# 7. Cleanup: trap fires → $BUILD_DIR deleted (keystore + init script removed)
```

### Crash Recovery

On startup, the CLI sweeps `$TMPDIR/better-update-*` directories older than 1 hour and deletes them. This handles cases where the cleanup trap did not fire (e.g., `kill -9`, machine crash).

## Build Profiles

Build profiles define how `--profile <name>` maps to platform-specific build settings. Stored in `app.json` → `expo.extra.betterUpdate.profiles`:

```json
{
  "expo": {
    "extra": {
      "betterUpdate": {
        "projectId": "uuid",
        "baseUrl": "https://updates.example.com",
        "profiles": {
          "development": {
            "environment": "development",
            "ios": {
              "buildConfiguration": "Debug",
              "distribution": "simulator"
            },
            "android": {
              "buildType": "debug",
              "format": "apk"
            }
          },
          "preview": {
            "environment": "preview",
            "ios": {
              "buildConfiguration": "Release",
              "distribution": "ad-hoc"
            },
            "android": {
              "buildType": "release",
              "format": "apk"
            }
          },
          "production": {
            "environment": "production",
            "ios": {
              "buildConfiguration": "Release",
              "distribution": "app-store"
            },
            "android": {
              "buildType": "release",
              "format": "aab"
            }
          }
        }
      }
    },
    "updates": {
      "url": "https://updates.example.com/manifest/<projectId>"
    },
    "runtimeVersion": {
      "policy": "fingerprint"
    }
  }
}
```

### Profile Schema

| Field                    | Type                                                                      | Default        | Description                                                                  |
| ------------------------ | ------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------- |
| `environment`            | `string`                                                                  | `"production"` | Which env vars to pull from the server                                       |
| `ios.buildConfiguration` | `"Debug" \| "Release"`                                                    | `"Release"`    | Xcode build configuration                                                    |
| `ios.distribution`       | `"app-store" \| "ad-hoc" \| "development" \| "enterprise" \| "simulator"` | `"app-store"`  | Determines provisioning profile type + ExportOptions.plist method            |
| `ios.scheme`             | `string`                                                                  | Auto-detected  | Override Xcode scheme                                                        |
| `android.buildType`      | `"debug" \| "release"`                                                    | `"release"`    | Gradle build type                                                            |
| `android.format`         | `"apk" \| "aab"`                                                          | `"aab"`        | Output format (determines Gradle task: `assembleRelease` vs `bundleRelease`) |
| `android.flavor`         | `string`                                                                  | —              | Gradle product flavor                                                        |

### Profile → Build Mapping

| Profile field                    | iOS effect                                               | Android effect                               |
| -------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| `ios.distribution: "simulator"`  | No code signing, produces `.tar.gz`                      | —                                            |
| `ios.distribution: "ad-hoc"`     | Ad-hoc profile, installable via QR                       | —                                            |
| `ios.distribution: "app-store"`  | App Store profile, for TestFlight/submission             | —                                            |
| `ios.distribution: "enterprise"` | Enterprise (in-house) profile, installable via QR or MDM | —                                            |
| `android.format: "apk"`          | —                                                        | `./gradlew assembleRelease`, direct install  |
| `android.format: "aab"`          | —                                                        | `./gradlew bundleRelease`, Play Store upload |

The CLI uses the profile to:

1. Select the correct credential type by metadata, then download + decrypt it locally (e.g., `ad-hoc` profile → ad-hoc provisioning profile)
2. Generate the correct `ExportOptions.plist` (iOS)
3. Run the correct Gradle task (Android)
4. Pull env vars from the correct environment

If no profiles are configured, the CLI uses a sensible default: `production` profile with `app-store` (iOS) and `aab` (Android).

## Authentication

```bash
# Login (opens browser for OAuth)
better-update login

# Or use API key (for CI, non-interactive)
export BETTER_UPDATE_TOKEN=bu_...

# For non-interactive credential decryption in CI, also provide the encryption
# identity private key (no passphrase prompt — the CI secret store is the boundary)
export BETTER_UPDATE_IDENTITY=AGE-SECRET-KEY-1...
```

The bearer token is stored at `~/.better-update/auth.json` (mode 0600). It is separate from the encryption identity, which lives at `~/.better-update/identity.json` (sealed with a passphrase) or, in CI, in `BETTER_UPDATE_IDENTITY`. The token authenticates the API; the identity decrypts credentials — both are needed to recover a credential (see [02-credential-vault.md](./02-credential-vault.md)).

## Exit Codes

| Code | Meaning                                      |
| ---- | -------------------------------------------- |
| 0    | Success                                      |
| 1    | General error                                |
| 2    | Invalid arguments                            |
| 3    | Authentication required                      |
| 4    | Project not linked                           |
| 5    | Credentials missing (and user chose to skip) |
| 6    | Build failed (xcodebuild/gradlew error)      |
| 7    | Upload failed                                |
