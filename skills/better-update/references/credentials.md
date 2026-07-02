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

| Platform | `--type`                     | Required extras                                                             |
| -------- | ---------------------------- | --------------------------------------------------------------------------- |
| iOS      | `distribution-certificate`   | `--password` (Apple Team ID is derived from the cert)                       |
| iOS      | `provisioning-profile`       | (none)                                                                      |
| iOS      | `push-key`                   | `--key-id`, `--apple-team-identifier`                                       |
| iOS      | `asc-api-key`                | `--key-id`, `--issuer-id` (or `upload-asc-key`, or `generate asc-key`)      |
| iOS      | `push-certificate`           | `--password` (`--bundle-identifier` only if not derivable from the cert CN) |
| iOS      | `apple-pay-certificate`      | `--password`, `--merchant-identifier`                                       |
| iOS      | `pass-type-certificate`      | `--password`, `--pass-type-identifier`                                      |
| Android  | `keystore`                   | `--password`, `--key-alias`, `--key-password`                               |
| Android  | `google-service-account-key` | (none)                                                                      |

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

# iOS ASC API key (.p8) via Apple ID login (2FA, interactive) — no manual download. Mirrors what
# `eas submit` does: created on the iris/v1 endpoint the cookie session authenticates, downloaded
# once (retried while Apple propagates the new key), E2E-encrypted locally, uploaded. The result is a
# normal asc-api-key credential usable for certs/profiles/device sync/build upload. --role defaults
# to ADMIN (APP_MANAGER = least privilege). One-time prereq: the Account Holder must agree to the API
# Terms under App Store Connect → Users and Access → Integrations, else Apple rejects the create.
# --nickname is the name shown in App Store Connect; Apple caps it at 30 chars, so longer values are
# truncated (the default is a short timestamped name well under the cap).
better-update credentials generate asc-key [--role ADMIN|APP_MANAGER] [--name] [--nickname]

# Apple Pay Merchant ID (via Apple ID login)
better-update credentials generate merchant-id --identifier merchant.com.example.app [--bundle-identifier com.example.app]

# Google service account JSON key
better-update credentials generate gsa-key [--file <path>] [--purpose fcm|play] [--skip-portal-hint]
```

For `AD_HOC`/`DEVELOPMENT` profiles pass `--device-ids`. APNs push keys, ASC API keys, and merchant IDs
are created via **Apple ID login (2FA), not the ASC API** — `generate asc-key` bootstraps the very
credential the other ASC-API generators consume, so it needs no pre-existing `--asc-key-id`. Apple caps
a team at 2 APNs keys; at the limit the CLI offers an interactive revoke + retry. Omitted args fall back
to interactive prompts where sensible.

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
better-update credentials passphrase change              # change this device's passphrase; re-seals device identity + (if enrolled) account key

# Org-owned CI identity (bearer auth + vault identity in one) — see below
better-update credentials robot create [--name] [--no-grant]   # mint + grant, prints BETTER_UPDATE_ROBOT once
better-update credentials robot list                           # this org's robot accounts
better-update credentials robot rotate <id> [--identity <key>] # re-mint the bearer only
better-update credentials robot revoke <id> [--yes]            # bearer stops auth; excludes + rotates vault if it held access
better-update credentials robot policies <id>                   # list policies attached to a robot
better-update credentials robot attach <id> --policy-id <p>     # attach a policy (real or managed:*) — default-deny until granted
better-update credentials robot detach <id> --policy-id <p>     # remove a policy attachment

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

### CI / robot accounts (`BETTER_UPDATE_ROBOT`)

A CI runner authenticates with **one** org-owned secret, long-lived and set as a masked + protected
CI variable — nothing is generated on the runner. A **robot account** bundles both halves a runner
needs into a single credential:

- a **bearer secret** for HTTP/API auth (what used to be a separate API key), and
- an **age private key** registered as a **machine** recipient and granted vault access — this
  unlocks cert/profile/ASC key **non-interactively** (no passphrase), because a machine key carries
  no passphrase and the CLI uses it raw.

Both are generated together and returned as one opaque `BETTER_UPDATE_ROBOT` value the CLI can split
internally for either purpose. Neither half is stored server-side beyond its hash/public key, so it's
**not** tied to any runner — mint it **once from an admin device** (where the vault is already
unlocked) and reuse it across every ephemeral VM/container — do **not** run `identity create` on the
runner:

```bash
# On your dev machine (admin/owner, vault unlockable):
better-update credentials robot create --name gitlab-ci
#   → generates an age keypair + a bearer secret, registers the keypair as a `machine`
#     recipient, grants it vault access, and prints the bundled credential ONCE.
#   Copy that value into the BETTER_UPDATE_ROBOT CI variable (masked + protected).
#   Pass --no-grant to register without granting (grant later with `access grant <fingerprint>`).
```

Because the keypair is generated in-process, there is no third-party public key to verify, so
`robot create` grants vault access directly without the out-of-band fingerprint confirmation that
`access grant` requires.

A freshly minted robot has **zero** API permissions (default-deny, spec §8) — vault access and IAM
permissions are separate grants. Attach a policy next so it can actually call the management API
(build/publish/submit/etc. all need this — vault access alone is not enough):

```bash
better-update credentials robot attach <id> --policy-id managed:admin   # or a custom scoped policy
better-update credentials robot policies <id>                          # list what's attached
better-update credentials robot detach <id> --policy-id managed:admin  # revoke it
```

Revoke a robot with `credentials robot revoke <id>` — its bearer stops authenticating immediately,
its policy attachments are dropped with it, and if it held vault access, that's excluded and the
vault rotated too. Rotate its bearer alone with `credentials robot rotate <id>` (its vault identity
is left untouched); pass `--identity <its current age private key>` to get a fresh full
`BETTER_UPDATE_ROBOT` bundle back.

Rotation is an identity handover — whoever runs it walks away with the robot's new bearer — so it is
gated separately: it needs `robotAccount:update` (not `create`), and a non-owner can only rotate a
robot whose attached policies grant nothing beyond what the caller itself holds (the same
no-privilege-escalation boundary `attach` enforces).

**Migrating from `BETTER_UPDATE_IDENTITY` + `BETTER_UPDATE_TOKEN`:** the old dual-secret setup
(a standalone `identity create-ci` machine key paired with a dashboard API key) is gone — the API
key feature was removed outright. An org that already minted a machine key this way keeps decrypting
the vault unchanged (it was carried forward as a vault-only robot with no bearer yet); run
`credentials robot rotate <id> --identity <its BETTER_UPDATE_IDENTITY value>` once to mint it a
bearer and get a single `BETTER_UPDATE_ROBOT` value to replace both old CI variables with.

## Browser env-vault access (account keys)

The org has **two** vaults, set up together when the vault is first bootstrapped (`identity init`) —
orgs are **born forked**, so there is no separate "migrate" step:

- **Credentials vault (CV)** — keystores/certs/profiles/keys. CLI-only, zero-knowledge.
- **Env vault (EV)** — env-var values only, with a **separate key**. Reachable from the browser
  (`updates-vault.jmango360.dev`, an origin separate from the dashboard) via a per-user **account key**, so a
  key a browser can obtain still cannot open signing credentials.

Editing env values from the web needs three things per user: an **account key**, a **passkey**, and an
admin **grant** of env access to that account key. The account key and the grant each have a browser
path now — a genuinely web-only user never touches the CLI.

```bash
# Per USER (CLI path): enroll your account key — the env-vault recipient the browser unwraps env with.
#   Seals the escrow under THIS DEVICE's identity passphrase (the "one passphrase" promise on the CLI),
#   and self-links it to the EV immediately (you already hold the env key via your device).
better-update credentials account create
better-update credentials account show                 # fingerprint + status (default action)
better-update credentials account link                 # (re)grant your existing key env access after a rotation
better-update credentials account reseal               # repair the escrow after a passphrase change elsewhere

# Per ORG (owner/admin): manage the env vault key.
better-update credentials env-vault status             # env-vault version + rotation state
better-update credentials env-vault rotate             # rotate the EV key (e.g. after revoking a member)
```

**Web path (no CLI):**

- **Self-enroll an account key** — on `updates-vault.jmango360.dev`, the env-vars view shows **Set up vault
  access** when you have no account key. You pick **your own passphrase** (it is generated + sealed in
  the browser and never sent to the server). A web-enrolled user has no device identity, so this
  passphrase is an **independent secret** — _not_ the "one passphrase" the CLI path ties to the device
  identity. There is no recovery if you forget it; re-enroll (or `account reseal` on the CLI).
- **Admin grant** — an admin opens **Vault access** on `updates-vault.jmango360.dev`, unlocks their own env
  vault, and clicks **Grant env access** next to a member's pending account key. The browser wraps the
  EV key to that account key (the admin must hold the unlocked EV key — the server enforces
  `vaultAccess:create`). Equivalent to the CLI self-link, but for another user. Granting CV
  (credentials) access stays CLI-only.

**Web unlock flow** (on `updates-vault.jmango360.dev`): the dashboard session carries over (shared cookie),
then **Unlock env vault** runs a WebAuthn **passkey step-up** + your **account passphrase** to unwrap
the EV key in the browser; from there you reveal/edit/create/delete env values, each encrypted client
side. A passkey can be enrolled inline from that dialog ("Add a passkey", Touch ID / security key) —
the ceremony needs real user presence, so it cannot be scripted. Manage passkeys (add / rename /
remove) anytime at **Account → Passkeys** in the dashboard.

The passkey step-up authorizes reads/writes for ~10 minutes and is **separate** from the unlock: the
unwrapped EV key stays cached for the session, but the step-up lapses on its own. When it does, the
vault still shows as unlocked (Re-verify / Lock visible) — the next reveal/edit/create/delete simply
re-prompts your passkey inline (or use **Re-verify** in the toolbar to refresh it ahead of time). No
need to Lock and Unlock again.

A typical web-only onboarding: the new user signs in to `updates-vault.jmango360.dev` → **Set up vault
access** (choose a passphrase) → add a passkey → an admin **Grant env access** → the user unlocks and
edits values. (Vault access also requires a role that can write env vars — see
`references/environments.md`.)

**Troubleshooting the web unlock:**

- _"No account key is enrolled for your user yet…"_ → use **Set up vault access** to enroll one (or
  `better-update credentials account create` on the CLI).
- _"Your account key can't open this organization's env vault yet…"_ → ask an admin to **Grant env
  access** on the Vault access page (after a key rotation, run `better-update credentials account
link`).
- Wrong-passphrase errors come from your account passphrase. If it was set on the CLI it equals this
  device's identity passphrase; if set in the browser it is the passphrase you chose at enrollment.
  Re-seal with `better-update credentials account reseal` if a CLI passphrase change drifted.

Env-var **values** are still managed day-to-day with `better-update env …` (see
`references/environments.md`); the split only changes _where_ those values are encrypted and whether
the **browser** can edit them. New orgs are born forked, so no cutover is needed; **CLIs that predate
the env-vault split cannot bootstrap a new org** (they can't produce the env wraps) — upgrade first.
