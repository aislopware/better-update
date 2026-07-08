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

**Auto-bind on create**: when an upload/generate runs inside a linked project, the CLI passes the
linked `projectId` and the new credential (or its Apple team) is **bound to that project** in the
same request (see "Credential→project bindings" below). A project Maintainer can therefore add CI
credentials without an org admin. A plain member creating a brand-NEW team/credential outside any
project context gets a 403; uploading under an existing already-bound team needs nothing extra.

### Credential→project bindings

Org credentials are usable in a project only when **bound** to it — unbound credentials are
org-admin-only, and `build` / `build-credentials resolve` hard-fails (for admins too) when the
resolved Apple team or upload keystore is not bound to the target project. Admins manage bindings
with:

```bash
better-update credentials bindings list [--project <id>]
better-update credentials bindings plan [--apply]
better-update credentials bindings add appleTeam <team-uuid> [--project <id>]
better-update credentials bindings remove androidUploadKeystore <keystore-id> [--project <id>]
```

Resource types: `appleTeam` (cascades to every child credential and the team's registered devices),
`ascApiKey` (team-less keys only), `googleServiceAccountKey`, `androidUploadKeystore`. `--project`
defaults to the linked project. Full access model: `references/access-control.md`.

**Bulk re-bind with `plan`**: `bindings plan` derives, from the org's existing iOS bundle
configurations and Android build-credential groups, which bindings those configs rely on, and shows
each as `✓ bound` / `✗ missing` with a `N missing of M` summary. `--apply` then binds every missing
item (idempotent — safe to re-run). Typical use: right after upgrading to the binding model every
credential starts unbound (admin-only), so an org admin runs
`better-update credentials bindings plan --apply` once instead of hand-copying UUIDs into
`bindings add`. Org admin only.

## Generate (create in-place instead of uploading)

All Apple ASC calls run **from your machine** (the server hands out the decrypted `.p8` only for the
duration of the request) so you avoid Apple rate-limiting Cloudflare's shared egress IP.

```bash
# Android: fresh upload keystore via keytool, stored server-side
better-update credentials generate keystore \
  --alias upload-key --store-password "..." --key-password "..." \
  --common-name "MyApp" --organization "Acme Inc" [--name "MyApp upload key"] [--validity-days 10000]

# Apple signing cert: builds the CSR locally, requests a fresh .p12 from the ASC API, uploads it.
# --type distribution|development = iOS; developer-id = macOS Developer ID Application (signs apps
# distributed outside the Mac App Store; Apple only lets the team's Account Holder create these).
# At Apple's per-type cert limit, offers an interactive revoke + retry.
better-update credentials generate distribution-certificate --asc-key-id <asc-api-key-id> [--type distribution|development|developer-id]

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

# Org-owned, PROJECT-scoped CI identity (bearer auth + vault identity in one) — see below
better-update credentials robot create [--name] [--no-grant] \
  [--project <projectId>] [--role maintainer|developer|reporter]  # mint + grant (credentials + env vault), prints BETTER_UPDATE_ROBOT once
better-update credentials robot list                           # active org's robots you may see (id, project + role)
better-update credentials robot update <id> [--name <name>] [--role maintainer|developer|reporter]
#                                                              # rename / change role in place (project fixed; audit-logged)
better-update credentials robot rotate <id> [--identity <key>] # re-mint the bearer only
better-update credentials robot revoke <id> [--yes]            # bearer stops auth; excludes + rotates the vault(s) it held access to
better-update credentials robot grant-env <id>                 # enroll an existing robot into the env vault (post-cutover; idempotent)

# Credential→project bindings (org admin) — where org credentials may be used
better-update credentials bindings list [--project <id>]
better-update credentials bindings plan [--apply]        # bindings existing configs rely on; --apply binds the missing ones
better-update credentials bindings add <resourceType> <resourceId> [--project <id>]
better-update credentials bindings remove <resourceType> <resourceId> [--project <id>]
#   resourceType: appleTeam | ascApiKey | googleServiceAccountKey | androidUploadKeystore
#   --project defaults to the linked project from the local context

# Your devices
better-update credentials device list                    # your device keys (active marked)
better-update credentials device link [<device>] [--yes] # self-link another of your devices to BOTH vaults (credentials + env)

# Who can decrypt (org recipients) — owner/admin operations
better-update credentials access list
better-update credentials access grant <recipient> [--yes]      # grants BOTH vaults post-cutover (credentials + env)
better-update credentials access grant-env <recipient> [--yes]  # env vault only — backfill a recipient granted before `grant` covered both (idempotent)
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
Post-cutover, `access grant` wraps **both** vault keys (credentials + env) to the recipient
(best-effort on the env half: a failure prints the `access grant-env` command to run later). A device
that can read credentials but hits _"This device isn't an env-vault recipient"_ on `env` commands was
granted before this — backfill it with `access grant-env <recipient>`. When someone leaves,
`access revoke <recipient>` then `access rotate` (and `env-vault rotate` if flagged).

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
# On your dev machine (a Maintainer of the project, vault unlockable), inside the linked project:
better-update credentials robot create --name gitlab-ci --role developer
#   → generates an age keypair + a bearer secret, registers the keypair as a `machine`
#     recipient, grants it vault access, and prints the bundled credential ONCE.
#   Copy that value into the BETTER_UPDATE_ROBOT CI variable (masked + protected).
#   --project <projectId> overrides the linked-project default; --role defaults to developer.
#   Pass --no-grant to register without granting (grant later with `access grant <fingerprint>`).
```

Because the keypair is generated in-process, there is no third-party public key to verify, so
`robot create` grants vault access directly without the out-of-band fingerprint confirmation that
`access grant` requires.

Minting only takes **Maintainer on the project**; the vault **grant** additionally takes an **org
admin who is a vault recipient** (`vaultAccess:*` is an org-admin rule). A plain Maintainer running
`robot create` still gets the robot and the one-time bundle — the grant step degrades to
_"Registered but not granted"_ (it never sinks the command) and hands off
`credentials access grant <robot-id>` for an org admin to run later. In short: a Maintainer can mint
an OTA-publishing robot; making it credential-decrypting takes an admin.

Post-cutover orgs keep env-var values under a **separate env vault**, so credentials-vault access
alone does not decrypt env vars in CI — `robot create` therefore also self-links the new robot as an
env-vault recipient (best-effort: if that part fails you get a warning plus the `grant-env` command
to run later, never a lost bundle). For a robot minted **before** this existed — the one whose
`env pull` / build-time env export fails with _"This device isn't an env-vault recipient"_ — enroll
it from an env-recipient admin device:

```bash
better-update credentials robot grant-env <id>   # idempotent — re-running reports "already a recipient"
```

**One robot = one project + one project role** (GitLab project-access-token shape; see
`references/access-control.md`). The **project** is fixed at creation — there is no `robot grant` /
`robot revoke-access`, and moving a robot to another project means minting a new one and revoking
the old. The **name and role** can be changed in place with
`credentials robot update <id> [--name <name>] [--role <role>]` — or from the project's Robot
accounts page in the dashboard (Maintainer+ on its project either way; a rename also relabels its
vault identity, and every change is written to the org audit log as `robotAccount.update` with the
previous + new values). The robot authenticates as an org _member_ holding
exactly that one project membership: nothing org-level (members, webhooks, org env-var writes,
project creation), though org-global env-var READS work with developer+. A typical CI robot is a
`developer` (or `maintainer`, if it must publish into protected environments) on the project it
ships.

Revoke a robot with `credentials robot revoke <id>` — its bearer stops authenticating immediately
and, if it held credentials-vault and/or env-vault access, each is excluded and that vault rotated
too (the revoking device must itself be able to unlock the vault(s) being rotated; a mid-way
failure is safe to re-run). Rotate its bearer alone with `credentials robot rotate <id>` (its
vault identity is left untouched); pass `--identity <its current age private key>` to get a fresh
full `BETTER_UPDATE_ROBOT` bundle back.
Robot management (create/update/rotate/revoke) takes Maintainer+ on the robot's project (org
admin/owner implicitly). `robot list` shows every visible robot with its id, project + role.

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
