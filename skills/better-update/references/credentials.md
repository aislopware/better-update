# Credentials: signing vault + E2E encryption

Signing material (keystores, distribution certs, provisioning profiles, APNs/ASC keys, etc.) lives on
the better-update server **end-to-end encrypted** (age + per-user keypairs): the server only ever
stores ciphertext, and decryption keys never leave your device. `build` downloads + decrypts what it
needs on demand, so credentials don't have to live on every developer's laptop.

Bare `better-update credentials` (or `credentials manager`) launches an interactive
platform → category → action wizard — handy when you don't remember the exact subcommand.

## Signing material

```bash
better-update credentials list [--platform <ios|android>]
# columns: ID | Name (the --name label) | Identifier (key alias / cert serial / …) | Platform | Type | Created | SHA-1
better-update credentials view <id> --type <type>            # metadata, no secret (keystore view shows all fingerprints)
better-update credentials download <id> --type <type> [--output <path>]   # decrypt via vault session → file (default ./<id>.<ext>)
better-update credentials delete <id> --platform <ios|android> --type <type>
better-update credentials remove [--platform <ios|android>] [--type <type>] [--yes]   # interactive picker
```

### Upload

```bash
better-update credentials upload --platform ios --type distribution-certificate \
  --name "App Store distribution 2026" --file ./AppStore.p12 \
  --password "p12-password" --apple-team-identifier ABC123XYZ

better-update credentials upload-asc-key --p8 ./AuthKey_XXXX.p8 --key-id <id> --issuer-id <id>
```

`--type` values and their required extra flags:

| Platform | `--type`                     | Required extras                                     |
| -------- | ---------------------------- | --------------------------------------------------- |
| iOS      | `distribution-certificate`   | `--password`, `--apple-team-identifier`             |
| iOS      | `provisioning-profile`       | (none)                                              |
| iOS      | `push-key`                   | `--key-id`, `--apple-team-identifier`               |
| iOS      | `asc-api-key`                | `--key-id`, `--issuer-id` (or use `upload-asc-key`) |
| iOS      | `push-certificate`           | `--bundle-identifier`                               |
| iOS      | `apple-pay-certificate`      | `--merchant-identifier`                             |
| iOS      | `pass-type-certificate`      | `--pass-type-identifier`                            |
| Android  | `keystore`                   | `--password`, `--key-alias`, `--key-password`       |
| Android  | `google-service-account-key` | (none)                                              |

`--name` is a free-form label shown as the **Name** column of `credentials list`. It is persisted for
keystores and ASC API keys (separate from the key alias / internal identifier), so use a distinct
`--name` to tell apart credentials that share an internal id — e.g. white-label Android keystores that
all reuse the key alias `jmango`.

## Generate (create in-place instead of uploading)

All Apple ASC calls run **from your machine** (the server hands out the decrypted `.p8` only for the
duration of the request) so you avoid Apple rate-limiting Cloudflare's shared egress IP.

```bash
# Android: fresh upload keystore via keytool, stored server-side
better-update credentials generate keystore \
  --alias upload-key --store-password "..." --key-password "..." \
  --common-name "MyApp" --organization "Acme Inc" [--name "MyApp upload key"] [--validity-days 10000]

# iOS distribution cert: builds the CSR locally, requests a fresh .p12 from the ASC API, uploads it.
# At Apple's 3-cert limit, offers an interactive revoke + retry.
better-update credentials generate distribution-certificate --asc-key-id <asc-api-key-id> [--type distribution|development]

# iOS provisioning profile via ASC API. Needs a distribution cert + ASC API key for the same team.
better-update credentials generate provisioning-profile \
  --asc-key-id <asc-api-key-id> --cert-id <distribution-certificate-id> \
  --bundle com.example.app --distribution APP_STORE [--device-ids id1,id2]

# iOS APNs auth key (.p8). Apple's public API can't create APNs keys, so this uses the Developer
# portal session (Apple ID + 2FA, interactive). Created on Apple, downloaded once, E2E-encrypted
# locally, uploaded. Use --method upload / --p8 <path> to upload one you already have (CI path).
better-update credentials generate push-key [--method apple-id|upload] [--p8 <path>] [--asc-key-id <id>] [--skip-portal-hint]

# Apple Pay Merchant ID (via Apple ID login)
better-update credentials generate merchant-id --identifier merchant.com.example.app [--bundle-identifier com.example.app]

# Google service account JSON key
better-update credentials generate gsa-key [--file <path>] [--purpose fcm|play] [--skip-portal-hint]
```

For `AD_HOC`/`DEVELOPMENT` profiles pass `--device-ids`. APNs push keys and merchant IDs are created
via **Apple ID login (2FA), not the ASC API**. Apple caps a team at 2 APNs keys; at the limit the CLI
offers an interactive revoke + retry. Omitted args fall back to interactive prompts where sensible.

## Regenerate / configure / sync

```bash
better-update credentials regenerate-profile [--bundle <id>] [--distribution ad-hoc|app-store|development|enterprise] [--all]
better-update credentials configure [--platform <ios|android>] [--bundle <id>] [--android-package <pkg>] \
  [--distribution ad-hoc|app-store|development|enterprise] [--rebind] \
  [--bind-push-key <id>] [--bind-asc-key <id>] [--bind-fcm-gsa <id>]
better-update credentials sync push [--platform ios|android|all]                               # local credentials.json → server
better-update credentials sync pull [--platform ios|android|all] [--keys-dir <dir>] [--skip-gitignore]   # server → local credentials.json
```

- `regenerate-profile` re-issues provisioning profiles via the ASC API (`--all` does every iOS bundle
  config). The CLI also auto-regenerates an `AD_HOC`/`DEVELOPMENT` profile during `build` when the
  registered device roster changed.
- `configure` is the non-build wizard to bind/rebind which credential each bundle/package uses.
- `sync` bridges a local `credentials.json` (EAS-style) with the server vault.

## Revoke

```bash
better-update credentials revoke distribution-certificate --id <id> [--asc-key-id <id>] [--keep-local]
better-update credentials revoke push-key [--id <local-id>] [--keep-local]
```

For `revoke distribution-certificate`, the id is the **`--id` flag** (not a positional). `--asc-key-id`
is optional (prompts when omitted and multiple keys exist). `--keep-local` revokes upstream on Apple
but keeps the stored record; a key already gone from the portal is still deleted locally.

## First-build interactive binding

When `better-update build` runs against a project with no credentials bound yet, it prompts to:

- **Android**: register the package, then generate a new keystore (via `keytool`) or pick an existing
  one, and bind it as the default group.
- **iOS**: pick a distribution certificate (or generate one via the ASC API) + ASC API key, then
  reuse or generate a provisioning profile, then save the bundle configuration.

Re-runs reuse what's bound; the prompt only fires when something is missing. Pass `--freeze-credentials`
to fail fast instead of prompting (CI).

## E2E vault: identity, devices, access, lock

These manage who can decrypt the vault and the local cached-key session. The vault is per-org; each
human + device has its own age keypair (a "recipient").

```bash
# Your encryption identity (this device's key)
better-update credentials identity show                  # active recipient + fingerprint (default action)
better-update credentials identity init [--label]        # bootstrap the org vault + offline recovery key (first time)
better-update credentials identity create [--label]      # make + register this device's key
better-update credentials identity register [--label]    # re-register an existing identity

# Your devices
better-update credentials device list                    # your device keys (active marked)
better-update credentials device link [<device>] [--yes] # self-link another of your devices to the vault

# Who can decrypt (org recipients) — owner/admin operations
better-update credentials access list
better-update credentials access grant <recipient> [--yes]
better-update credentials access revoke <recipient> [--yes]
better-update credentials access rotate [--yes]          # rotate the vault key (e.g. after a revoke)
better-update credentials access recover [--key AGE-SECRET-KEY-1…]   # recover using the offline recovery key
better-update credentials access recovery rotate [--yes]            # mint a new offline recovery key

# Local cached-key session (so you aren't prompted every command)
better-update credentials unlock [--duration 15m|2h|1h30m]   # cache the vault key in the OS keychain (default 15m, max 24h)
better-update credentials lock                               # clear the cached key
better-update credentials status                            # is the vault unlocked? remaining TTL
```

Typical onboarding: `identity init` (first person in the org) → teammates run `identity create` and
an owner runs `access grant <recipient>` → each person `unlock`s to cache their key for a session.
When someone leaves, `access revoke <recipient>` then `access rotate`.

## Browser env-vault access (account keys + env-vault cutover)

By default the org has **one** vault: signing credentials **and** env-var values share it, and it is
CLI-only (zero-knowledge — keys never reach a browser). To edit **env-var values from the web**
(`updates-vault.<host>`, an origin separate from the dashboard), the org splits into **two** vaults:

- **Credentials vault (CV)** — keystores/certs/profiles/keys. Unchanged, CLI-only, zero-knowledge.
- **Env vault (EV)** — env-var values only, with a **separate key**. Reachable from the browser via a
  per-user **account key** (so a key a browser can obtain still cannot open signing credentials).

Two one-time setup steps unlock browser env editing. They are **CLI-only** — the web can read these
but never create them, which is why an unprepared user sees an opaque error in the browser (see below).

```bash
# 1. Per USER: enroll your account key — the env-vault recipient the browser unwraps env with.
#    Prompts for THIS DEVICE's identity passphrase; the account key is sealed under the SAME
#    passphrase (the "one passphrase" promise), so you type that same passphrase in the web unlock.
#    Requires a device identity already set up (see "E2E vault" above).
better-update credentials account create
better-update credentials account show                 # fingerprint + status (default action)
better-update credentials account link                 # (re)grant your existing key env access after a rotation
better-update credentials account reseal               # repair the escrow after a passphrase change elsewhere

# 2. Per ORG (owner/admin, once): cut the org over to a separate env vault.
#    Re-keys env values CV→EV and wraps EV to every enrolled account key.
better-update credentials env-vault migrate [--yes]
better-update credentials env-vault status             # "separate (migrated)" vs "shared with credentials vault"
better-update credentials env-vault rotate [--yes]     # rotate the EV key (e.g. after revoking a member)
```

Order is flexible: `account create` before `migrate` enrolls the key as _"pending env-vault
migration"_ (migrate then wraps to it); `migrate` before `account create` self-links the new key
immediately. After both, `passphrase change` re-seals the device identity **and** the account escrow
together.

**Web unlock flow** (on `updates-vault.<host>`): the dashboard session carries over (shared cookie),
then **Unlock env vault** runs a WebAuthn **passkey step-up** + your **account passphrase** to unwrap
the EV key in the browser; from there you reveal/edit/create/delete env values, each encrypted client
side. A passkey can be enrolled inline from that dialog ("Add a passkey", Touch ID / security key) —
the ceremony needs real user presence, so it cannot be scripted. Manage passkeys (add / rename /
remove) anytime at **Account → Passkeys** in the dashboard; once you have one, the unlock dialog
links there instead of nagging to add one.

**Troubleshooting the web unlock:**

- _"No account key is enrolled for your user yet…"_ → you skipped step 1. Run
  `better-update credentials account create`.
- _"Your account key can't open this organization's env vault yet…"_ → the org has not cut over (or
  the EV key was rotated). An admin runs `better-update credentials env-vault migrate`; after a
  rotation you run `better-update credentials account link`.
- Wrong-passphrase errors come from the account passphrase, which equals this device's identity
  passphrase. Reset the seal with `better-update credentials account reseal` if they drifted.

Env-var **values** are still managed day-to-day with `better-update env …` (see
`references/environments.md`); the split only changes _where_ those values are encrypted and whether
the **browser** can edit them. CLI env access is byte-identical before cutover; after cutover, **old
CLIs that predate the split lose env read until upgraded** (one-shot cutover, no dual-wrap).
