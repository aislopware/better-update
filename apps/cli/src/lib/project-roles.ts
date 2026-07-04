import { Effect } from "effect";

import { InvalidArgumentError } from "./exit-codes";

// GitLab-style RBAC (GITLAB-RBAC-SPEC §1/§1b): fixed project roles. A robot
// account holds exactly one of these on exactly one project.
const PROJECT_ROLES = ["maintainer", "developer", "reporter"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

const isProjectRole = (value: string): value is ProjectRole =>
  (PROJECT_ROLES as readonly string[]).includes(value);

/** Parse `--role`; omitted defaults to "developer" (the typical CI rank). */
export const parseProjectRole = (
  raw: string | undefined,
): Effect.Effect<ProjectRole, InvalidArgumentError> => {
  const value = raw?.trim();
  if (value === undefined || value.length === 0) {
    return Effect.succeed("developer");
  }
  if (!isProjectRole(value)) {
    return new InvalidArgumentError({
      message: `Invalid --role "${value}" — expected one of ${PROJECT_ROLES.join("|")}.`,
    });
  }
  return Effect.succeed(value);
};
