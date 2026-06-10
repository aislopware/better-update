# 10. Vault Lifecycle & Revocation Sync

> **Status:** Part (b) (escalation hardening) **implemented**. Part (a) lifecycle sync
> **fully implemented**: removal path (S1–S5) + downgrade reconcile (S6) + API/web/CLI
> surfacing. The only deferred item is the optional periodic/scheduled reconcile backstop
> (the six synchronous IAM-mutation triggers already give complete coverage).
>
> Companion to [02-credential-vault.md](./02-credential-vault.md). That doc defines the
> _manual_ "revoke always rotates" flow (§"Revoking & rotating"). This doc closes the gap
> where the **org-membership lifecycle** and the **vault-recipient lifecycle** are decoupled:
> removing a member, or downgrading their role, does nothing to their vault access today.

## 1. The problem: two layers, one missing seam

A credential read is guarded by **two independent layers**, and a successful decrypt needs
both:

| Layer                           | Where                                          | What it gates                                                                                   |
| ------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **IAM gate** (authz)            | `assertPermission` in handlers                 | _May_ this principal call the endpoint at all (`vaultAccess:read`, `appleCredential:download`). |
| **Recipient wrap** (E2E crypto) | `org_vault_key_wraps` row + device private key | _Can_ this device actually unwrap the vault key, hence the DEK, hence the ciphertext.           |

The two layers have **no shared lifecycle**. Membership lives in `member` (better-auth /
IAM); recipients live in `user_encryption_keys` + `org_vault_key_wraps` (the vault). Nothing
links a change in one to the other:

- **Remove a member** (`members.remove`) → deletes the `member` row only. Their device key
  and their wrap at the current `vault_version` **stay**. The vault is **not** marked for
  rotation.
- **Downgrade a role** (detach `managed:developer`, attach `managed:viewer`) → changes
  effective statements only. Their wrap stays.
- **Revoke a device key** — there is **no endpoint** to set `user_encryption_keys.revoked_at`
  outside a full rotation.

### Why a stale wrap is the real risk

The IAM gate is _request-time_: a removed member has no session, so they cannot call the API.
But the wrap + the vault key are _durable secrets the member already holds locally_. Once a
principal has ever held the vault key (any developer who built once), removing their
membership does **not** revoke their ability to decrypt:

- Any credential ciphertext + `wrapped_dek` they already pulled stays decryptable **forever**
  with their cached vault key — see the existing caveat in
  [02 §"Revoking & rotating"](./02-credential-vault.md) ("rotation cannot un-see what a
  recipient already decrypted").
- More importantly, **nothing changes the live vault** on their departure. Until an admin
  _remembers_ to run `credentials access revoke`, the departed member's cached key still
  matches the current vault — every credential uploaded up to that moment is exposed.

The manual `credentials access revoke <recipient>` flow (02 §255) is correct but **opt-in and
forgettable**. This spec makes departure **fail closed**: a removal drops the wrap, marks the
vault `rotation_pending`, and (option-dependent) blocks credential reads until an admin
rotates.

## 2. Escalation hardening (part b — implemented)

The decoupling also created a low-privilege _foothold_ that has been **closed** in this
change:

| Hole (before)                                                                                                    | Fix (now)                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userEncryptionKeys.register` (device branch) had **no permission gate** — any session could enrol a device key. | Device enrolment now asserts `vaultAccess:read`. A non-participant can't plant a recipient candidate.                                                     |
| `viewer` held `vaultAccess:read`, so a viewer could `getWrap`, `addWrap` self-link, and enrol a device.          | `viewer` preset drops `vaultAccess` entirely (`auth/permissions.ts`). A viewer is **not** a vault participant. Vault participation starts at `developer`. |
| `addWrap` would (re-)wrap to a **revoked** key.                                                                  | `addWrap` refuses any key with `revoked_at != null` — revocation is one-way; neither a grant nor a self-link resurrects a revoked recipient.              |

> A viewer never had a _cryptographic_ path to the plaintext (E2E means the server can't hand
> out the key), but `vaultAccess:read` + self-link let a low-priv principal insert itself into
> the recipient structures and pollute the grantable pool — a foot-gun for an over-broad admin
> grant, and a persistence primitive for a downgraded member who cached the key. Both are gone.

These are enforced by `assertAccess` (unit-pinned in `auth/managed-policies.test.ts`) and the
vault e2e (`tests/e2e/vault-flow.test.ts` §9).

## 3. Lifecycle sync design (part a — to build)

Goal: a member leaving (removal, or losing vault access via downgrade) **automatically**
revokes their live vault access and forces a rotation before more credentials can be read.

### 3.1 Schema — `rotation_pending` on the vault

Add a new migration `00XX_vault_rotation_pending.sql`:

```sql
ALTER TABLE "org_vaults" ADD COLUMN "rotation_pending"       INTEGER NOT NULL DEFAULT 0; -- 0|1
ALTER TABLE "org_vaults" ADD COLUMN "rotation_pending_since" TEXT;                        -- ISO, nullable
ALTER TABLE "org_vaults" ADD COLUMN "rotation_pending_reason" TEXT;                       -- e.g. "member-removed:<userId>"
```

`rotation_pending = 1` means: a recipient was dropped out-of-band; the live vault key is
considered compromised-on-departure and must be rotated. A successful `rotate` clears it back
to `0`.

### 3.2 Repository — `OrgVaultRepo` additions

```ts
// Delete every wrap (at any version) for the device keys owned by `userId`, and
// flip rotation_pending in the SAME batch. Returns the dropped key ids for audit.
dropRecipientsForUser(params: {
  organizationId: string; userId: string; reason: string; now: string;
}): Effect.Effect<readonly string[]>;

// Idempotent flag flip used by the above + any future revoke endpoint.
markRotationPending(params: {
  organizationId: string; reason: string; now: string;
}): Effect.Effect<void>;
```

`rotate` (existing) additionally sets `rotation_pending = 0, rotation_pending_since = NULL`
inside its CAS batch — so the flag clears atomically with the version bump.

> Dropping the wrap is **necessary but not sufficient**: it stops `getWrap` from handing the
> departed device a fresh wrap, but their _cached_ key still matches the live vault until the
> rotation actually re-keys. That's why the flag + the read-block in §3.4 exist — the wrap
> drop alone is not the revocation; the rotation is.

### 3.3 Member removal hook (`handlers/members.ts`)

After `repo.remove(...)`, before the audit log:

1. Extend `MemberRepo.findInOrg` to also return `userId` (currently `{ id, role }`).
2. `OrgVaultRepo.dropRecipientsForUser({ organizationId, userId, reason: "member-removed:" + userId })`.
3. Optionally set `user_encryption_keys.revoked_at` for the removed user's device keys (so the
   `addWrap` revoked-key guard from §2 blocks any later self-link should they ever rejoin).
4. Audit `vault.recipient.dropped` with the dropped key ids + `rotationPending: true`.

All of this is best-effort-within-the-request and should run in the same logical operation;
if the vault isn't bootstrapped yet (`getVault === null`), steps 2–4 are a no-op.

> **Role-downgrade** is the harder case — there is no single "downgrade" endpoint. In the IAM
> model a member loses `vaultAccess` through **six** mutation sites: detach policy from member,
> detach policy from group, remove member from group, delete group (cascades attachments),
> update a policy document (drops `vaultAccess` tokens — affects every attachee), delete a
> policy (cascades). Covered in §3.6 / S6 via one authoritative reconcile primitive rather than
> six bespoke diffs. **Decision: yes, cover it** (§5.3).

### 3.4 The read-block while `rotation_pending` (the "block until rotate" decision)

This is the one **behaviour decision** the spec surfaces, because it has a real blast radius.
While `rotation_pending = 1`:

| Option                           | Behaviour                                                                                                                                                                                          | Trade-off                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **A — hard block** (recommended) | `getWrap` and `buildCredentials.resolve` return `409 Conflict` ("Vault rotation pending — a recipient was removed; an admin must run `credentials access rotate` before credentials can be read"). | Fails closed: no new reads against a vault a departed member can still decrypt. **Breaks builds/CI** until an admin rotates. |
| **B — warn + audit**             | Reads succeed; response carries a `rotationPending` warning; dashboard shows a banner; audit flags it.                                                                                             | Never breaks builds, but leaves the exposure window open as long as the admin ignores it.                                    |
| **C — grace then block**         | Option B for a window (e.g. 24h), then Option A.                                                                                                                                                   | Balances the two; more moving parts (needs `rotation_pending_since` + a clock at the gate).                                  |

**Recommendation: Option A.** Prod has no real users yet ([[project_prod_status]] — backward
compat not required), the secure default is to fail closed, and the CLI error is explicitly
actionable. CI tokens (`machine` keys) are themselves recipients, so a CI pipeline hitting the
block is the _correct_ signal that an admin must rotate after a departure. Revisit to Option C
if build-pipeline friction proves unacceptable once there are real tenants.

The gate is a single helper, e.g. `assertVaultRotationNotPending(organizationId)`, called at
the top of `getWrap` and `buildCredentials.resolve` (both platforms). `rotate` clearing the
flag immediately unblocks reads.

### 3.5 Surfacing it

- `GET /api/vault` returns `rotationPending`, `rotationPendingSince`, `rotationPendingReason`.
- Dashboard: a prominent banner on the credentials/access view ("Rotation required — a member
  was removed").
- CLI: `credentials access status` shows it; the 409 from §3.4 names the exact command to run.

### 3.6 Downgrade coverage — one authoritative reconcile (decision §5.3)

A member can lose `vaultAccess` through six IAM-mutation sites (listed in §3.3's note). Diffing
before/after at each site is fragile — six places to get right, and a single missed site is a
**silent** leak. Instead, a single authoritative primitive in `application/`:

```ts
// "Who SHOULD hold a current device wrap?" = a current member whose effective
// statements still include vaultAccess:read (owner/superadmin always qualify).
// Drop every current-version device wrap whose owner fails that test, revoke the
// device key, and mark rotation_pending if anything was dropped.
reconcileVaultRecipients(params: { organizationId: string; reason: string }): Effect<...>;
```

It reuses `resolveEffectiveStatements({ organizationId, memberId })` (already in
`auth/middleware.ts`, backed by `REPO_LAYERS = PolicyAttachmentRepoLive + GroupRepoLive +
PolicyRepoLive`) to recompute access off-request. The six mutation sites simply **fire** the
reconcile after their write (fire-and-forget, like audit logging) — none compute a diff. A
whole-org sweep naturally handles the fan-out case (a policy-document edit that strips
`vaultAccess` from many members at once). Org-owned `recovery`/`machine` wraps are **exempt**
(not user-scoped; managed only via explicit `rotate`/revoke).

> **Removal vs downgrade.** Removal (§3.3) is the cheap special case: the member row is already
> gone, so the targeted `dropDeviceWrapsForUser(userId)` drops unconditionally — no statement
> resolution needed. Downgrade needs the full reconcile because the member may still hold
> `vaultAccess` via another policy/group. Same drop + mark-pending tail; different "should-keep"
> test.

A cheap backstop: run `reconcileVaultRecipients` on the admin `GET /api/vault` read, so a
missed trigger still converges the next time an admin looks at the vault.

## 4. Implementation slices

| Slice  | Scope                                                                                                                                                                                                                                                          | Verify                                                                              | Status  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------- |
| **S1** | Migration `0064`: `rotation_pending` (+ `_since`, `_reason`) on `org_vaults`; regen schema.                                                                                                                                                                    | `bun run lint`                                                                      | ✅ done |
| **S2** | `OrgVaultRepo.dropDeviceWrapsForUser` (org-scoped drop + last-org global revoke + mark pending); `rotate` clears the flag (CAS).                                                                                                                               | integration `org-vault.test.ts`                                                     | ✅ done |
| **S3** | `members.remove` hook (drop wraps + revoke device keys + mark pending + audit); `MemberRow.userId`.                                                                                                                                                            | integration + e2e                                                                   | ✅ done |
| **S4** | `assertVaultRotationNotPending` gate on `buildCredentials.resolve` + `env-vars.export` (Option A; `getWrap`/`listCredentialDeks` stay open to allow the rotation).                                                                                             | unit gate test + e2e                                                                | ✅ done |
| **S5** | Surface flag in `GET /api/vault` (`rotationPending`/`Since`/`Reason`) + web "Rotation required" banner (`vault-access.tsx`) + CLI `credentials access list` warning.                                                                                           | unit (mapper) + lint                                                                | ✅ done |
| **S6** | Downgrade coverage — `reconcileVaultRecipients` (§3.6) fired from the IAM-mutation sites (policy detach member/group, group remove-member, group delete, policy update-doc, policy delete); `MemberRepo.findAuthRoleByUser` mirrors the owner/superadmin gate. | integration (reconcile drops viewer/non-member, keeps owner/dev) + policy-authz e2e | ✅ done |

> **Deferred (optional):** a periodic/scheduled reconcile backstop. The original spec floated an
> admin-read backstop on `GET /api/vault`, but making a GET mutate state (drop wraps) is a REST
> anti-pattern, so it was dropped. The six synchronous triggers cover every path that can strip
> `vaultAccess`; a cron sweep would only guard against a future-added, un-instrumented mutation site.

> **Note on §3.3 vs the implementation.** Device keys are user-global (one key, wrapped
> per-org), so `dropDeviceWrapsForUser` does the org-scoped drop unconditionally but only sets
> the GLOBAL `revoked_at` when the key holds no wrap in any other org (last-org cleanup) — an
> unconditional global revoke would break the departing user's _other_ orgs. This refines the
> "revoke always" decision (§5.2) to "revoke the recipient here; revoke the key globally once
> it is unused everywhere".

## 5. Decisions (locked 2026-06-10)

1. **Block vs warn** (§3.4) — **Option A, hard block.** `getWrap` + `buildCredentials.resolve`
   return `409` while `rotation_pending`; `rotate` clears it. Fails closed; accepts that a
   departure breaks builds/CI until an admin rotates (the correct signal). Revisit to Option C
   only if real-tenant friction demands it.
2. **Auto-revoke device keys on removal** (§3.3 step 3) — **Yes, revoke always.** A removal sets
   `user_encryption_keys.revoked_at` on the departed user's device keys in addition to dropping
   the wrap, so the §2 revoked-key guard blocks any later self-link if they rejoin. Same for a
   downgrade-driven reconcile drop.
3. **Downgrade coverage** (§3.6 / S6) — **Yes, cover it.** Via the single `reconcileVaultRecipients`
   primitive fired from all six mutation sites (not per-site diffs) + an admin-read backstop.
   Sequenced **after** the removal path (S1–S5) so each lands as a reviewable increment.
4. **Credential-level rotation** — still out of scope: vault-key rotation cannot un-leak what
   departed members already pulled. The CLI `409` + dashboard banner remind admins to _also_
   regenerate the underlying Apple/Google credential for a high-assurance cut-off (already noted
   in [02 §"Revoking & rotating"](./02-credential-vault.md)).
