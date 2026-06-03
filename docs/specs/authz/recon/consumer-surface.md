# Consumer Surface Recon — Role & Grant Management

## 1. API Contract Pattern

Every resource lives in two files under `packages/api/src/`:

- `domain/<resource>.ts` — Effect `Schema.Class` (or plain `Schema.Struct`) for each request/response shape, plus `Schema.Struct` for list params.
- `groups/<resource>.ts` — `HttpApiGroup.make("<name>")` with `.add(HttpApiEndpoint.<verb>(...))` chains, `.addError(...)` for shared error types, and `.annotateContext(OpenApi.annotations(...))` on every endpoint and on the group itself.

The group is then imported in `packages/api/src/api.ts` and appended to `ManagementApi` with `.add(...)`.

### Quoted example — `ChannelsGroup` (abbreviated)

```ts
// packages/api/src/groups/channels.ts
export class ChannelsGroup extends HttpApiGroup.make("channels")
  .add(
    HttpApiEndpoint.post("create", "/api/channels")
      .setPayload(CreateChannelBody)
      .addSuccess(Channel, { status: 201 })
      .annotateContext(OpenApi.annotations({ title: "Create channel", description: "..." })),
  )
  .add(
    HttpApiEndpoint.get("list", "/api/channels")
      .setUrlParams(ListChannelsParams)
      .addSuccess(pageResult(Channel))
      .annotateContext(OpenApi.annotations({ title: "List channels", description: "..." })),
  )
  .add(
    HttpApiEndpoint.patch("update")`/api/channels/${idParam}`
      .setPayload(UpdateChannelBody)
      .addSuccess(Channel)
      .annotateContext(OpenApi.annotations({ title: "Update channel", description: "..." })),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/channels/${idParam}`
      .addSuccess(DeleteChannelResult)
      .annotateContext(OpenApi.annotations({ title: "Delete channel", description: "..." })),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(Forbidden)
  .annotateContext(OpenApi.annotations({ title: "Channels", description: "..." })) {}
```

Path params use the `idParam` template-literal overload (`\`/api/channels/${idParam}\``).
List endpoints use `pageResult(Schema)`which returns`{ items, total, page, limit }`.
Cursor-paginated endpoints use `cursorPageResult(Schema)`returning`{ items, nextCursor }`.
Domain schemas go in `domain/<resource>.ts`as`Schema.Class`(for Response) or`Schema.Struct` (for payload/params).

---

## 2. Where to Add Role-CRUD + Grant-CRUD Endpoints

### 2a. Custom roles (org-scoped)

New files:

- `packages/api/src/domain/org-role.ts` — `OrgRole` schema class, `CreateOrgRoleBody`, `UpdateOrgRoleBody`, `ListOrgRolesParams`, `DeleteOrgRoleResult`.
- `packages/api/src/groups/org-roles.ts` — `OrgRolesGroup` with endpoints:
  - `GET    /api/roles` list org roles (urlParams: `{ organizationId }`)
  - `POST   /api/roles` create role (payload: `{ name, description?, permissions[] }`)
  - `GET    /api/roles/:id` get role
  - `PATCH  /api/roles/:id` update role (name/description/permissions)
  - `DELETE /api/roles/:id` delete role

Then add `.add(OrgRolesGroup)` to `ManagementApi` in `packages/api/src/api.ts`.

### 2b. Per-channel grants (project-scoped, member × channel × permission-set)

New files:

- `packages/api/src/domain/channel-grant.ts` — `ChannelGrant` schema class, `UpsertChannelGrantBody`, `DeleteChannelGrantResult`, `ListChannelGrantsParams`.
- `packages/api/src/groups/channel-grants.ts` — `ChannelGrantsGroup` with endpoints:
  - `GET    /api/channels/:id/grants` list grants for a channel
  - `PUT    /api/channels/:id/grants/:memberId` upsert grant (payload: `{ permissions[] }`)
  - `DELETE /api/channels/:id/grants/:memberId` revoke grant

Then add `.add(ChannelGrantsGroup)` to `ManagementApi`.

Both groups follow the exact same `domain + group` split and `addError(NotFound) / addError(Forbidden)` conventions shown in the quoted example.

---

## 3. Auth-Client Change for Dynamic AC

**Current** (`packages/auth-client/src/index.ts`):

```ts
export const createBetterUpdateAuthClient = (baseURL: string) =>
  createAuthClient({
    baseURL,
    plugins: [
      organizationClient(),
      apiKeyClient(),
      oneTimeTokenClient(),
      adminClient(),
      inferAdditionalFields({ user: { approved: { type: "boolean" } } }),
    ],
  });
```

`organizationClient()` infers member `.role` as the static union `"owner" | "admin" | "member"` from better-auth's built-in types. For dynamic custom roles the client plugin needs to accept an extended role union or the type must be widened to `string`.

**Change required**: pass a custom `ac` (access control) instance to `organizationClient()` once better-auth's `organization` plugin supports runtime-extended roles, OR widen the `role` type on `MemberItem` via `inferAdditionalFields` so the dashboard can render any string role returned by the API without a TypeScript error.

Concretely:

- Add `inferAdditionalFields({ member: { role: { type: "string" } } })` to the plugin list, or
- Construct an `accessControl` object with the extended role set and pass it as `organizationClient({ ac })` (follows better-auth AC plugin pattern — see `better-auth-best-practices` skill for exact API).

No new client plugin package is needed; this is a configuration change inside `packages/auth-client/src/index.ts`.

---

## 4. Web Pages to Add / Extend

### 4a. Org-level role management (new page)

**Mirror**: `apps/web/src/routes/_authed/_app/members.tsx` + `-members-table.tsx` + `-member-row-actions.tsx`

**New route file**: `apps/web/src/routes/_authed/_app/settings/roles.tsx`

Pattern to follow:

1. `createFileRoute("/_authed/_app/settings/roles")` with `validateSearch: zodValidator(rolesSearchSchema)` (page/sort in URL search params, same as members page).
2. `useSuspenseQuery(rolesQueryOptions(orgId))` — a new query in `apps/web/src/queries/org.ts` calling `runApi(() => api.orgRoles.list({ urlParams: { organizationId: orgId } }))`.
3. A `RolesTableView` component (mirrors `MembersTableView`) using `DataTableView` from `apps/web/src/lib/data-table`.
4. Actions column with `Menu` / `MenuPopup` / `MenuItem` pattern (mirrors `-member-row-actions.tsx`) for edit and delete.
5. A "Create role" dialog following the `key`-bump + keyed-child form pattern (feedback: `dialog_key_bump_pattern`).

Add a `Roles` link to the org settings sidebar (in `apps/web/src/components/settings-layout.tsx` or wherever the settings nav lives).

### 4b. Per-channel grant management (new panel inside channel settings)

**Mirror**: `apps/web/src/routes/_authed/_app/projects/$projectSlug/settings/index.tsx` (SettingCard layout) + members table pattern.

**New route file**: `apps/web/src/routes/_authed/_app/projects/$projectSlug/channels/$channelId/grants.tsx`

Or, if channels have a settings sub-route already, add a `GrantsSection` `SettingCard` there. Pattern:

1. `useSuspenseQuery(channelGrantsQueryOptions(channelId))` — new query calling `api.channelGrants.list(...)`.
2. A `GrantsTableView` with columns: Member, Permissions, Actions (using `DataTableView`).
3. "Add grant" dialog (upsert) + per-row revoke action via `Menu` → `MenuItem variant="destructive"`.

---

## 5. CLI Commands to Add

### 5a. `better-update roles` top-level group

New directory: `apps/cli/src/commands/roles/`

Sub-commands (follow `channels/` as the exact structural model):

- `list.ts` — `defineCommand` + `runEffect` + `apiClient` + `printList`
- `create.ts` — `args: { name, permissions }` + `api.orgRoles.create`
- `view.ts` — fetch by id + `printKeyValue`
- `update.ts` — `args: { id, name?, permissions? }` + `api.orgRoles.update`
- `delete.ts` — confirm prompt + `api.orgRoles.delete`
- `index.ts` — `defineCommand({ subCommands: { list, create, view, update, delete } })`

Register in `apps/cli/src/command-registry.ts` as `roles: rolesCommand`.

### 5b. `better-update channels grants` sub-group

New directory: `apps/cli/src/commands/channels/grants/`

Sub-commands:

- `list.ts` — resolve channel by name (reuse `resolveNamedResourceId` from `channels/helpers.ts`) + `api.channelGrants.list` + `printList`
- `set.ts` — `args: { channel, member, permissions }` + `api.channelGrants.upsert`
- `revoke.ts` — `args: { channel, member }` + `api.channelGrants.delete`
- `index.ts` — `defineCommand({ subCommands: { list, set, revoke } })`

Add `grants: grantsCommand` to the `channelsCommand` subCommands map in `apps/cli/src/commands/channels/index.ts`.

---

## 6. File Paths for New Artifacts

| Artifact                     | Path                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| Role domain schema           | `packages/api/src/domain/org-role.ts`                                                   |
| OrgRolesGroup                | `packages/api/src/groups/org-roles.ts`                                                  |
| ChannelGrant domain schema   | `packages/api/src/domain/channel-grant.ts`                                              |
| ChannelGrantsGroup           | `packages/api/src/groups/channel-grants.ts`                                             |
| Auth-client tweak            | `packages/auth-client/src/index.ts`                                                     |
| Web roles page               | `apps/web/src/routes/_authed/_app/settings/roles.tsx`                                   |
| Web channel grants panel     | `apps/web/src/routes/_authed/_app/projects/$projectSlug/channels/$channelId/grants.tsx` |
| Web new queries              | `apps/web/src/queries/org.ts` (extend)                                                  |
| CLI roles command            | `apps/cli/src/commands/roles/`                                                          |
| CLI channel grants sub-group | `apps/cli/src/commands/channels/grants/`                                                |
| CLI registry                 | `apps/cli/src/command-registry.ts` (add `roles`)                                        |
| CLI channels index           | `apps/cli/src/commands/channels/index.ts` (add `grants`)                                |
