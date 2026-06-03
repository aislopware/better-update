# better-auth 1.6.13 — Access Control + Dynamic Access Control API (recon)

Source: `apps/server/node_modules/better-auth@1.6.13`. Every snippet below is quoted from the installed `.d.mts` / `.mjs` files (paths given inline). No memory used.

---

## 1. Core access-control plugin

### Import paths

```ts
// barrel re-export
import { createAccessControl, role } from "better-auth/plugins/access";
// types
import type {
  AccessControl,
  Role,
  Statements,
  RoleInput,
  ExactRoleStatements,
  RoleStatements,
  RoleAuthorizeRequest,
  AuthorizeResponse,
} from "better-auth/plugins/access";
```

Physical files: `dist/plugins/access/access.{d.mts,mjs}`, `dist/plugins/access/types.d.mts`, `dist/plugins/access/index.d.mts`.

### `createAccessControl` / `newRole` signatures (`access.d.mts`)

```ts
declare function createAccessControl<const TStatements extends Statements>(
  s: TStatements,
): {
  newRole<const TRoleStatements extends Statements>(
    statements: RoleInput<TStatements, TRoleStatements>,
  ): Role<ExactRoleStatements<TRoleStatements>, TStatements>;
  statements: TStatements;
};

declare function role<
  const TRoleStatements extends Statements,
  TAuthorizeStatements extends Statements = TRoleStatements,
>(statements: TRoleStatements): Role<ExactRoleStatements<TRoleStatements>, TAuthorizeStatements>;
```

Runtime (`access.mjs`): `createAccessControl(s)` returns `{ newRole(statements) { return role(statements); }, statements: s }`. So `ac.statements` is **literally the statements object you passed in**, and `ac.newRole(perm)` is just `role(perm)` — no validation that `perm` resources are a subset of `ac.statements` at this layer (subsetting is enforced only by the TS `RoleInput` type and, server-side, by `checkForInvalidResources`).

### `Statements` shape and how to read `role.statements` (`types.d.mts`)

```ts
type Statements = { readonly [resource: string]: readonly LiteralString[] };

type Role<
  TRoleStatements extends Statements = Record<string, any>,
  TAuthorizeStatements extends Statements = TRoleStatements,
> = {
  authorize: (
    request: RoleAuthorizeRequest<TAuthorizeStatements>,
    connector?: ("OR" | "AND") | undefined,
  ) => AuthorizeResponse;
  statements: TRoleStatements;
};

type RoleInput<
  TStatements extends Statements,
  TRoleStatements extends Statements,
> = TRoleStatements &
  (string extends keyof TRoleStatements
    ? {}
    : RoleStatements<TStatements> &
        Record<Exclude<keyof TRoleStatements, keyof TStatements>, never>);

type RoleAuthorizeRequest<TStatements extends Statements> = {
  [P in keyof TStatements]?:
    | SubArray<TStatements[P]>
    | { actions: SubArray<TStatements[P]>; connector: "OR" | "AND" };
};
type AuthorizeResponse = { success: false; error: string } | { success: true; error?: never };
```

**Reading a role's permission map:** `role.statements` is a plain object `{ resource: string[] }`. e.g. `ownerAc.statements` ⇒ `{ organization: ["update","delete"], member: ["create","update","delete"], invitation: ["create","cancel"], team: ["create","update","delete"], ac: ["create","read","update","delete"] }`. To check, call `role.authorize({ resource: ["action"] })` → `{ success: boolean }` (default connector `"AND"`; per-resource `{ actions, connector }` supported). `authorize` (in `access.mjs`) iterates the request, looks up `statements[resource]`, and requires every requested action ∈ allowed actions.

---

## 2. Organization default statements / roles

### Import paths

```ts
import {
  defaultStatements,
  defaultAc,
  defaultRoles,
  ownerAc,
  adminAc,
  memberAc,
} from "better-auth/plugins/organization/access"; // dist/plugins/organization/access/index.d.mts
```

### `defaultStatements` (resource → actions) (`organization/access/statement.mjs`)

```ts
const defaultStatements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"], // <-- the dynamic-AC meta-resource
};
const defaultAc = createAccessControl(defaultStatements);
```

Default role statement maps (from same file):

| role   | organization          | member                         | invitation            | team                           | ac                                    |
| ------ | --------------------- | ------------------------------ | --------------------- | ------------------------------ | ------------------------------------- |
| owner  | `["update","delete"]` | `["create","update","delete"]` | `["create","cancel"]` | `["create","update","delete"]` | `["create","read","update","delete"]` |
| admin  | `["update"]`          | `["create","update","delete"]` | `["create","cancel"]` | `["create","update","delete"]` | `["create","read","update","delete"]` |
| member | `[]`                  | `[]`                           | `[]`                  | `[]`                           | `["read"]`                            |

`defaultRoles = { admin: adminAc, owner: ownerAc, member: memberAc }`.

### Merging custom statements (canonical pattern)

```ts
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

const statement = {
  ...defaultStatements,
  project: ["create", "share", "update", "delete"],
} as const;
const ac = createAccessControl(statement);
const myCustomRole = ac.newRole({ project: ["create", "share"], member: ["create"] });
```

Spread `defaultStatements` to keep org built-ins (esp. `ac` — needed for dynamic AC), then add your own resources. Pass the merged `ac` + roles into `organization({ ac, roles })`.

---

## 3. `organization()` option types

From `dist/plugins/organization/types.d.mts` (`interface OrganizationOptions`):

```ts
/** Configure the roles and permissions for the organization plugin. */
ac?: AccessControl | undefined;
/** Custom permissions for roles. */
roles?: { [key in string]?: Role<any> } | undefined;
/** Dynamic access control for the organization plugin. */
dynamicAccessControl?: {
  /** Whether to enable dynamic access control... @default false */
  enabled?: boolean;
  /** The maximum number of roles that can be created for an organization. @default Infinite */
  maximumRolesPerOrganization?: number | ((organizationId: string) => Awaitable<number>);
} | undefined;
```

- `ac` = an `AccessControl` (the `createAccessControl(...)` return value).
- `roles` = name → `Role`. The plugin merges `{ ...defaultRoles, ...opts.roles }` (`organization.mjs` line ~132). Supplying `roles` **replaces the default-role name set** used by guard logic (`options.roles ? Object.keys(options.roles) : ["owner","admin","member"]`), so include owner/admin/member in `roles` if you keep them.
- **The exact dynamic config key is `dynamicAccessControl`** with shape `{ enabled?: boolean; maximumRolesPerOrganization?: number | (orgId) => Awaitable<number> }`. Endpoints + the `organizationRole` table only exist when `dynamicAccessControl.enabled === true` (`organization.mjs`: `if (opts.dynamicAccessControl?.enabled) endpoints = { ...endpoints, ...dynamicAccessControlEndpoints }`, and the schema block is gated the same way).
- `creatorRole?: string` (`@default "owner"`) controls which role string counts as creator in permission checks.

Client side mirror (`client.d.mts`, `OrganizationClientOptions`): `ac?`, `roles?: { [k]: Role }`, `dynamicAccessControl?: { enabled: boolean }`, plus `schema.organizationRole.additionalFields`.

---

## 4. Generated DB schema for dynamic roles (`organizationRole`)

### Model key / table name

The plugin model key is **`organizationRole`** (this is what you pass to `ctx.context.adapter.findMany({ model: "organizationRole", ... })`). Default `modelName` is `opts.schema?.organizationRole?.modelName` i.e. **undefined → the physical table name defaults to the model key `organizationRole`** (better-auth uses the schema key as the table when `modelName` is unset; override via `schema.organizationRole.modelName`). For a D1/SQL migration plan the snake_case table is conventionally `organization_role`, but better-auth's own default is the camelCase `organizationRole` model name unless you supply `modelName`.

### Columns (`schema.d.mts` `OrganizationRoleDefaultFields` + runtime `organization.mjs` lines 200-238)

| Field (model)    | type   | required | notes                                                                        |
| ---------------- | ------ | -------- | ---------------------------------------------------------------------------- |
| `id`             | string | yes      | PK, auto (every better-auth model has `id`)                                  |
| `organizationId` | string | yes      | FK → `organization.id`; `index: true`                                        |
| `role`           | string | yes      | the custom role **name** (lowercased via `normalizeRoleName`); `index: true` |
| `permission`     | string | yes      | **JSON string** of `Record<string, string[]>` (resource → actions)           |
| `createdAt`      | date   | yes      | `defaultValue: () => new Date()`                                             |
| `updatedAt`      | date   | no       | `onUpdate: () => new Date()`                                                 |

Runtime field block confirming column attrs:

```ts
organizationRole: { fields: {
  organizationId: { type: "string", required: true, references: { model: "organization", field: "id" }, index: true },
  role:           { type: "string", required: true, index: true },
  permission:     { type: "string", required: true },
  createdAt:      { type: "date", required: true, defaultValue: () => new Date() },
  updatedAt:      { type: "date", required: false, onUpdate: () => new Date() },
}, modelName: opts.schema?.organizationRole?.modelName }
```

Zod row type (`schema.d.mts`): `organizationRoleSchema` → `{ id, organizationId, role, permission: Record<string,string[]>, createdAt, updatedAt? }` (note: the **parsed** `permission` is an object; on disk it is `JSON.stringify`'d).

**Migration mapping (snake_case):** `id` → `id` (text PK), `organizationId` → `organization_id` (text, FK organization.id, indexed), `role` → `role` (text, indexed), `permission` → `permission` (text, JSON-encoded `Record<string,string[]>`), `createdAt` → `created_at` (timestamp), `updatedAt` → `updated_at` (timestamp nullable). better-auth's own field-name mapping respects `fieldName` overrides under `schema.organizationRole.fields.*` if you want explicit snake_case column names.

---

## 5. Server-side role CRUD endpoints (`routes/crud-access-control.mjs`)

Registered only when `dynamicAccessControl.enabled`. Endpoint id → HTTP path → method:

| export          | path                        | method | returns                                                        |
| --------------- | --------------------------- | ------ | -------------------------------------------------------------- |
| `createOrgRole` | `/organization/create-role` | POST   | `{ success, roleData: {...row, permission}, statements }`      |
| `updateOrgRole` | `/organization/update-role` | POST   | `{ success, roleData }`                                        |
| `deleteOrgRole` | `/organization/delete-role` | POST   | `{ success }`                                                  |
| `listOrgRoles`  | `/organization/list-roles`  | GET    | `OrganizationRole[]` (with `permission` JSON-parsed to object) |
| `getOrgRole`    | `/organization/get-role`    | GET    | `OrganizationRole` (single, `permission` parsed)               |

Request bodies (`crud-access-control.mjs`):

```ts
// create-role
{ organizationId?: string; role: string; permission: Record<string,string[]>; additionalFields?: {...} }
// update-role
{ organizationId?: string; data: { permission?: Record<string,string[]>; roleName?: string; ...additionalFields }; } & ({ roleName: string } | { roleId: string })
// delete-role / get-role (query)
{ organizationId?: string } & ({ roleName: string } | { roleId: string })
// list-roles (query)
{ organizationId?: string }
```

Authorization for these endpoints uses the **`ac` resource**: create requires `{ ac: ["create"] }`, update `{ ac: ["update"] }`, delete `{ ac: ["delete"] }`, list/get `{ ac: ["read"] }` — checked via `hasPermission(...)` against the caller's `member.role`. If `options.ac` is missing, create/update throw `MISSING_AC_INSTANCE` (`NOT_IMPLEMENTED`). `createOrgRole` also validates each provided resource is in `Object.keys(ac.statements)` (`checkForInvalidResources` → `INVALID_RESOURCE`) and that the caller already holds every permission they're granting (`checkIfMemberHasPermission`). Role names are lowercased and cannot collide with pre-defined role names or existing DB roles.

### Reading a custom org role's permission map WITHOUT an HTTP call (the key path for middleware)

Do **not** call `/organization/get-role` per request. Query the table directly via the better-auth adapter — exactly what `hasPermission` does internally (`has-permission.mjs`):

```ts
const roles = await ctx.context.adapter.findMany({
  model: "organizationRole",
  where: [{ field: "organizationId", value: organizationId }],
});
for (const { role, permission: permissionsString } of roles) {
  const parsed = JSON.parse(permissionsString); // Record<string, string[]>
  // merge over the built-in role of the same name, then ac.newRole(merged)
  const merged = { ...acRoles[role]?.statements };
  for (const [key, actions] of Object.entries(parsed))
    merged[key] = [...new Set([...(merged[key] ?? []), ...actions])];
  acRoles[role] = ac.newRole(merged);
}
```

So: read row(s) from `organizationRole` filtered by `organizationId` (+ `role`/`id` for one), `JSON.parse(row.permission)` → `Record<string,string[]>`, and (optionally) merge onto the same-named static role's `statements`. In our hexagonal server this means a `repositories/` adapter doing a single D1 `SELECT permission FROM organization_role WHERE organization_id = ? AND role = ?` and `JSON.parse`-ing the column — no HTTP, no per-request endpoint hit. `hasPermission` also keeps an in-process `cacheAllRoles` Map (`permission.mjs`) keyed by `organizationId` when `useMemoryCache: true`.

### Built-in resolver you can call from server code

`hasPermission` is the canonical resolver (`has-permission.d.mts`):

```ts
declare const hasPermission: (
  input: {
    organizationId: string;
    useMemoryCache?: boolean; // in-memory role cache to avoid repeated DB reads
  } & HasPermissionBaseInput /* = { role: string; options: OrganizationOptions; permissions: Record<string,string[]>; allowCreatorAllPermissions?: boolean } */,
  ctx: GenericEndpointContext,
) => Promise<boolean>;
```

It merges static `options.roles ?? defaultRoles` with DB rows from `organizationRole` (only when `dynamicAccessControl.enabled && options.ac`), then `hasPermissionFn` splits `input.role` on `","`, and for each role calls `acRoles[role]?.authorize(input.permissions)`.

---

## 6. How `member.role` stores a custom role

`member.role` is a **string of the role NAME(s), not an id** (`schema.d.mts` MemberDefaultFields: `role: { type: "string", required: true, defaultValue: "member" }`). Multiple roles are stored comma-joined: `hasPermissionFn` does `input.role.split(",")`, and `deleteOrgRole` checks `member.role.split(",").map(r => r.trim()).includes(roleToDelete)`. Custom-role rows are matched by `role` **name** (`normalizeRoleName` lowercases it) — so a member with a custom role has `member.role = "<lowercased-custom-role-name>"`, and that name is the join key into `organizationRole.role`. (Endpoints also accept `roleId` for direct row addressing, but member assignment is by name.)

---

## 7. Client plugin methods (role CRUD)

`organizationClient()` (`client.d.mts`/`mjs`) does NOT hand-define role methods; they are auto-derived from the server endpoints via `$InferServerPlugin: OrganizationPlugin<...>` + better-auth's path→method inference (`/organization/create-role` → `authClient.organization.createRole`). Resulting methods (kebab → camel):

```ts
authClient.organization.createRole({ role, permission, organizationId? })
authClient.organization.updateRole({ data: { permission?, roleName? }, roleName? | roleId?, organizationId? })
authClient.organization.deleteRole({ roleName? | roleId?, organizationId? })
authClient.organization.listRoles({ organizationId? })   // GET
authClient.organization.getRole({ roleName? | roleId?, organizationId? }) // GET
```

Plus an **offline** client-only permission check (no network), explicitly defined in `client.mjs`:

```ts
organization: {
  checkRolePermission: (data) =>
    clientSideHasPermission({
      role: data.role,
      options: { ac: options?.ac, roles },
      permissions: data.permissions,
    });
}
```

`clientSideHasPermission` (`client.mjs`) = `hasPermissionFn(input, input.options.roles || defaultRoles)` — only knows static roles, not DB custom roles. Client options to enable role CRUD typing: `organizationClient({ ac, roles, dynamicAccessControl: { enabled: true } })`.

---

## 8. Is the `ac` statement resource required for createRole authorization?

**Yes.** Authorizing `/organization/create-role` checks the caller's role against `permissions: { ac: ["create"] }` (and update/delete/read use `ac:["update"/"delete"/"read"]`). The caller's role must therefore include the `ac` resource with the relevant action. The built-in `owner`/`admin` roles have `ac: ["create","read","update","delete"]` and `member` has `ac: ["read"]`, so out of the box only owner/admin can create roles. Separately, the **server plugin must be configured with an `ac` instance** (`options.ac`) or create/update throw `MISSING_AC_INSTANCE`. And every resource named in the new role's `permission` must exist in `Object.keys(ac.statements)` (else `INVALID_RESOURCE`), and the caller must already hold each permission they grant.
