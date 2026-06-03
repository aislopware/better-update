import { acRoles, buildStatement, statement } from "./access-control";
import { permissions } from "./permissions";

import type { BuiltinRole } from "../models";

const BUILTIN_ROLES: readonly BuiltinRole[] = ["owner", "admin", "developer", "viewer"];

// The set of every resource named by any built-in role's permission map.
const allResources = (): readonly string[] => {
  const seen = new Set<string>();
  for (const resourceMap of Object.values(permissions)) {
    for (const resource of Object.keys(resourceMap)) {
      seen.add(resource);
    }
  }
  return [...seen];
};

// Union of actions a single resource is granted across all four built-in roles.
const unionActionsForResource = (resource: string): readonly string[] => {
  const seen = new Set<string>();
  for (const role of BUILTIN_ROLES) {
    const actions = permissions[role][resource as keyof (typeof permissions)[typeof role]];
    for (const action of actions ?? []) {
      seen.add(action);
    }
  }
  return [...seen];
};

const sorted = (xs: readonly string[]): readonly string[] => [...xs].toSorted();

describe(buildStatement, () => {
  it("collapses permissions.ts into a per-resource action superset", () => {
    const built = buildStatement();
    for (const resource of allResources()) {
      expect(sorted(built[resource] ?? [])).toStrictEqual(
        sorted(unionActionsForResource(resource)),
      );
    }
  });

  it("includes the ac meta-resource superset (owner/admin grant all four actions)", () => {
    const built = buildStatement();
    expect(sorted(built["ac"] ?? [])).toStrictEqual(["create", "delete", "read", "update"]);
  });

  it("does not invent resources beyond those named in permissions.ts", () => {
    const built = buildStatement();
    expect(sorted(Object.keys(built))).toStrictEqual(sorted(allResources()));
  });
});

describe("statement (merged AccessControl menu)", () => {
  it("is a superset of every resource named in any role", () => {
    for (const resource of allResources()) {
      expect(statement).toHaveProperty(resource);
      expect(sorted([...statement[resource as keyof typeof statement]])).toStrictEqual(
        sorted(unionActionsForResource(resource)),
      );
    }
  });

  it("keeps team from better-auth defaultStatements (not in our permission map)", () => {
    // `team` is supplied by better-auth's org defaultStatements and is NOT in
    // permissions.ts — it must survive the merge.
    expect(statement).toHaveProperty("team");
  });

  it("exposes ac with the full create/read/update/delete action menu", () => {
    expect(sorted([...statement.ac])).toStrictEqual(["create", "delete", "read", "update"]);
  });
});

describe("acRoles statement parity vs permissions.ts", () => {
  it.each(BUILTIN_ROLES)("%s grants exactly its permissions.ts actions per resource", (role) => {
    const roleStatements = acRoles[role].statements as Record<string, readonly string[]>;
    const expectedMap = permissions[role];

    // Every resource the role grants maps to the same action set.
    for (const [resource, actions] of Object.entries(expectedMap)) {
      expect(sorted([...(roleStatements[resource] ?? [])])).toStrictEqual(sorted([...actions]));
    }

    // The role's statement keys are exactly the resources permissions.ts grants —
    // no extra resources leak in, none are dropped.
    expect(sorted(Object.keys(roleStatements))).toStrictEqual(sorted(Object.keys(expectedMap)));
  });

  it.each(BUILTIN_ROLES)("%s omits every resource it is not granted", (role) => {
    const roleStatements = acRoles[role].statements as Record<string, readonly string[]>;
    const granted = new Set(Object.keys(permissions[role]));
    for (const resource of allResources()) {
      if (!granted.has(resource)) {
        expect(roleStatements[resource]).toBeUndefined();
      }
    }
  });
});

describe("ac (role-management meta-resource) gating", () => {
  it("is granted to owner and admin", () => {
    const ownerStatements = acRoles.owner.statements as Record<string, readonly string[]>;
    const adminStatements = acRoles.admin.statements as Record<string, readonly string[]>;
    expect(sorted([...(ownerStatements["ac"] ?? [])])).toStrictEqual([
      "create",
      "delete",
      "read",
      "update",
    ]);
    expect(sorted([...(adminStatements["ac"] ?? [])])).toStrictEqual([
      "create",
      "delete",
      "read",
      "update",
    ]);
  });

  it("is withheld from developer and viewer", () => {
    const developerStatements = acRoles.developer.statements as Record<string, readonly string[]>;
    const viewerStatements = acRoles.viewer.statements as Record<string, readonly string[]>;
    expect(developerStatements["ac"]).toBeUndefined();
    expect(viewerStatements["ac"]).toBeUndefined();
  });
});

// `{ ...defaultStatements, ...buildStatement() }` widens the statement type to a
// string-indexed record, so better-auth only type-narrows `authorize` requests to
// the strongly-typed default resources (organization/member/invitation/team/ac).
// Our derived resources (channel/rollout/...) exist at runtime but not in that
// narrowed request type. `authorizeFor` exercises the real runtime `authorize`
// against an arbitrary resource:actions request to assert behavior.
const authorizeFor = (role: BuiltinRole, request: Record<string, readonly string[]>): boolean => {
  const fn = acRoles[role].authorize as (req: Record<string, readonly string[]>) => {
    success: boolean;
  };
  return fn(request).success;
};

describe("acRoles authorize smoke", () => {
  it("lets a viewer read a channel", () => {
    expect(authorizeFor("viewer", { channel: ["read"] })).toBe(true);
  });

  it("forbids a viewer from deleting a channel", () => {
    expect(authorizeFor("viewer", { channel: ["delete"] })).toBe(false);
  });

  it("lets an owner delete a channel and manage roles via ac", () => {
    expect(authorizeFor("owner", { channel: ["delete"] })).toBe(true);
    expect(authorizeFor("owner", { ac: ["create", "delete"] })).toBe(true);
  });

  it("forbids a developer from managing roles via ac", () => {
    expect(authorizeFor("developer", { ac: ["create"] })).toBe(false);
  });
});
