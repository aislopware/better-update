# ADR: Unified Authorization — IAM is the single in-org gate; better-auth is authentication

Status: **Accepted & implemented** (branch `feat/iam-unify-authz`).
Supersedes the two-plane split where org-structural ops were gated by better-auth's
org-role AC while resources were gated by the IAM Policy+Group model.

## Decision

There is **one authorization model**: the IAM Policy + Group model
([POLICY-GROUPS-SPEC.md](./POLICY-GROUPS-SPEC.md)), enforced by the single gate
`assertAccess(resource, action, target?)` (`apps/server/src/auth/policy.ts`) with
deny-wins + default-deny, an exact-equality `owner` root bypass, and a superadmin
bypass.

**better-auth is demoted to authentication + identity, NOT authorization.** It keeps:

- Authentication: sessions, OAuth (GitHub/Google), email+password, the `bearer`
  transport, and the `oneTimeToken` browser→CLI handoff.
- Identity & credential STORAGE: the `user` / `session` / `account` / `organization` /
  `member` / `invitation` / `apikey` tables (snake_case column contracts in `auth.ts`).
- **API-key verification** (`verifyApiKey`) — fully decoupled from issuance; it hashes
  the presented key and looks it up. Self-minted rows verify identically.
- `getSession` / `getActiveMember` — the canonical session→member resolver that IAM's
  middleware builds `CurrentActor` on.
- Two intentional authorization exceptions (below).

The IAM `CurrentActor` is a **pure derivation** of better-auth identity:
`auth/middleware.ts` resolves the session/member/api-key, then layers
`policy_attachment`-derived statements on top. The only role string the gate reads is
the exact value `"owner"` (root bypass, `auth/owner.ts`); admin/developer/viewer are
**policy attachments**, never roles.

## What is IAM-gated (every in-org mutation)

| Surface                                                                                                                                          | Endpoint                           | Gate token                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------ |
| Projects / channels / branches / updates / builds / submissions / env-vars / devices / webhooks / vault / credentials / analytics / fingerprints | ManagementApi                      | object-scoped `assertAccess(...)`    |
| Policies / groups / attachments                                                                                                                  | ManagementApi                      | `policy:*` / `group:*`               |
| **API-key mint / revoke / list**                                                                                                                 | `POST/GET/DELETE /api/api-keys`    | `apiKey:create/delete/read`          |
| **Invitation create / cancel / list**                                                                                                            | `POST/GET/DELETE /api/invitations` | `invitation:create/cancel/read`      |
| **Member remove**                                                                                                                                | `DELETE /api/members/:id`          | `member:delete` (+ last-owner guard) |
| **Org settings update**                                                                                                                          | `PATCH /api/organization`          | `organization:update`                |

All are **additive** migrations: the new IAM endpoints write the same rows better-auth
reads; the better-auth routes stay live but are no longer called by our web/CLI clients.

## Intentional better-auth exceptions (NOT IAM-gated)

1. **Org CREATE** — a _pre-org_ platform gate (`allowUserToCreateOrganization` +
   superadmin approval). IAM structurally cannot evaluate it: there is no actor /
   active-org / `effectiveStatements` context before the org exists.
2. **Org DELETE** — stays owner-only on better-auth. Its destructive cross-table
   cascade (`projects` has no `ON DELETE CASCADE` from org; `apikey.reference_id` has
   no FK; both have their own children) is delegated to better-auth's
   `deleteOrganization`. Reimplementing that cascade in an IAM endpoint is deferred as
   high-risk/low-value (owner-only is already safe).
3. **Invitation accept / reject** — gated by the _invited user's own session_, not a
   role; no IAM change needed. They consume the member-only invitations we write.
4. **Member directory reads** (`authClient.organization.listMembers`) — stays
   membership-gated (better-auth), NOT `member:read`-gated: **any org member sees
   the directory** (names, emails, org role, join date) — the GitHub-organization
   model, deliberate (ROLES-CAPABILITIES-SPEC §8c). IAM-enriched data
   (attachments, access summaries, robot accounts, invitations) stays behind
   `policy:read` / `robotAccount:read` / `invitation:read` on our own endpoints.

These are documented inline in `auth.ts` (org plugin comment) and `auth/permissions.ts`
(the RESERVED note), so the reserved `organization`/`member` tokens are not mistaken for
fully enforced.

## The membership collapse

`member.role` is reduced to **`owner | member`**. admin/developer/viewer are
**managed-policy presets** (`managed:admin` etc.) attached per-member or via groups —
never roles. The Members page dropped the role-change UI; per-member "Manage policies" +
"Remove" are gated by three server-computed capabilities on `/api/me`
(`canInviteMembers` = `invitation:create`, `canRemoveMembers` = `member:delete`,
`canManagePolicies` = `policy:update`), each mirroring its endpoint's exact gate token.

## Safety of the dormant better-auth routes

The better-auth org-structural routes (`invite-member`, `update-member-role`,
`remove-member`, `organization/update|delete`) stay LIVE under better-auth's _default_
org AC (owner|admin|member; no custom `ac`). This is **authz-neutral and not an
escalation path**, confirmed by a cross-slice review:

- A plain `member` is forbidden on all of them by better-auth's own AC.
- No org `admin` role is ever auto-seeded (the creator gets `owner`; our invites are
  `member`-only; our role-change UI is gone), so the `admin` arm is only owner-reachable.
- A `member.role` value written via a dormant route (e.g. `"admin"`) grants **nothing**
  in the IAM gate — only `"owner"` is read.

Hardening the dormant routes (a custom `ac` restricting invitable roles, or removing the
routes) is optional and unnecessary for safety.

## Key invariants (do not regress)

- `roleIsOwner` is **exact** `=== "owner"` (anti-escalation; pinned by a colocated test).
- Invitations are **member-only** at the contract (`InvitableRole = Schema.Literal("member")`);
  owner/admin are rejected at decode.
- `member:delete` has a **last-owner guard** (`countOwners <= 1` → Conflict).
- Self-minted api-keys hash exactly as better-auth's `defaultKeyHasher`
  (`base64url(SHA-256(plaintext))` unpadded) — pinned by a mint→`verifyApiKey` test.
- Org-structural IAM endpoints target the **active org only** (no cross-org id params).
