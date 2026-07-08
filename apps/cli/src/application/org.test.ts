import { it } from "@effect/vitest";
import { Effect } from "effect";

import { resolveOrganization, switchOrganization } from "./org";

import type { AuthOrganization } from "../services/api-client";
import type { OrgGateway } from "./org";

const ORGS: readonly AuthOrganization[] = [
  { id: "org-alpha", name: "Alpha", slug: "alpha" },
  { id: "org-beta", name: "Beta", slug: "beta" },
  // A pathological row whose id collides with another org's slug: the slug
  // match must win, so "beta" can never silently select this one.
  { id: "beta", name: "Gamma", slug: "gamma" },
];

const buildGateway = (switched: string[]): OrgGateway => ({
  listOrganizations: Effect.succeed(ORGS),
  setActiveOrganization: (organizationId) =>
    Effect.sync(() => {
      switched.push(organizationId);
    }),
});

describe("resolving an organization selector", () => {
  it("matches by slug before id", () => {
    expect(resolveOrganization(ORGS, "beta")?.id).toBe("org-beta");
  });

  it("falls back to the raw id", () => {
    expect(resolveOrganization(ORGS, "org-alpha")?.slug).toBe("alpha");
  });

  it("returns undefined when nothing matches", () => {
    expect(resolveOrganization(ORGS, "nope")).toBeUndefined();
  });
});

describe("switching the active organization", () => {
  it.effect("sets the resolved organization active and returns it", () =>
    Effect.gen(function* () {
      const switched: string[] = [];
      const target = yield* switchOrganization(buildGateway(switched), "beta");
      expect(target.id).toBe("org-beta");
      expect(switched).toStrictEqual(["org-beta"]);
    }),
  );

  it.effect("fails with InvalidArgumentError for an unknown selector", () =>
    Effect.gen(function* () {
      const switched: string[] = [];
      const error = yield* switchOrganization(buildGateway(switched), "nope").pipe(Effect.flip);
      expect(error._tag).toBe("InvalidArgumentError");
      expect(switched).toStrictEqual([]);
    }),
  );
});
