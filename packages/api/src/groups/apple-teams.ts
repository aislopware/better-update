import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { AppleTeam } from "../domain/apple-team";
import { Conflict } from "../domain/errors";

const idParam = { id: Schema.String };

export const AppleTeamsGroup = HttpApiGroup.make("appleTeams")
  .add(
    HttpApiEndpoint.get("list", "/api/apple-teams", {
      success: Schema.Struct({ items: Schema.Array(AppleTeam) }),
      error: [Forbidden, NotFound, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List Apple teams",
        description:
          "List Apple developer teams derived from uploaded artifacts (certs, push keys, ASC keys)",
      }),
    ),
    HttpApiEndpoint.put("protect", "/api/apple-teams/:id/protection", {
      params: { ...idParam },
      success: AppleTeam,
      error: [Forbidden, NotFound, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Protect Apple team",
        description:
          "Mark the team protected (GITLAB-RBAC-SPEC §3b): every credential under it — certs, push keys/certs, provisioning profiles, ASC API keys — requires Maintainer+. Org admin only. Idempotent.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("unprotect", "/api/apple-teams/:id/protection", {
      params: { ...idParam },
      success: AppleTeam,
      error: [Forbidden, NotFound, Conflict],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Unprotect Apple team",
        description: "Remove the team's protection. Org admin only. Idempotent.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Apple Teams",
      description:
        "Apple teams auto-created from uploaded credentials, plus the protected-team toggle",
    }),
  );
