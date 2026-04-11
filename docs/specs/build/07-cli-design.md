# 7. CLI Design

## Overview

The `better-update` CLI orchestrates local builds — pulling credentials and env vars from the server, running `expo prebuild` + native tooling, then uploading the artifact. The UX mirrors `eas build --local`: interactive credential provisioning on first run, then zero-config on subsequent runs.

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

When credentials don't exist for the project+platform+distribution:

```
$ better-update build --platform ios --profile production

  ● Checking credentials...
    ✗ No iOS distribution certificate found

  ? How would you like to provide a distribution certificate?
    ❯ Select .p12 file from disk
      I'll set up credentials later (skip build)

  ? Select distribution certificate (.p12):
    > ~/certs/dist.p12

  ? Certificate password:
    > ••••••••

  ✓ Certificate uploaded: "Apple Distribution: Your Team (XXXXXXXXXX)"
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

  ✓ Keystore generated and uploaded
```

## Credential Commands

```bash
# List all credentials
better-update credentials list
better-update credentials list --platform ios

# Upload credential explicitly (non-interactive)
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

# Upload Android keystore
better-update credentials upload \
  --platform android \
  --type keystore \
  --file ./keystores/release.jks \
  --password "keystore-password" \
  --key-alias "my-key" \
  --key-password "key-password" \
  --name "Release Keystore"

# Activate a credential (sets it as active for its scope)
better-update credentials activate cred_01HXYZ...

# Delete credential
better-update credentials delete cred_01HXYZ...

# Generate a new Android keystore and upload
better-update credentials generate-keystore \
  --name "Release Keystore" \
  --key-alias "my-key"
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
# Initialize project (link to better-update)
better-update init
# Interactive:
#   1. Reads app.json for project name + bundle ID
#   2. Creates project on server (or links to existing)
#   3. Writes projectId to app.json expo.extra.betterUpdate.projectId

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

# 1. Pull credentials from vault (API key auth only)
#    → write .p12 to $BUILD_DIR/cert.p12
#    → write .mobileprovision to $BUILD_DIR/profile.mobileprovision

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

# 1. Pull keystore from vault → write to $BUILD_DIR/release.keystore
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
        "serverUrl": "https://updates.example.com",
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

1. Select the correct credential type from the vault (e.g., `ad-hoc` profile → ad-hoc provisioning profile)
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
```

Token stored at `~/.better-update/auth.json`.

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
