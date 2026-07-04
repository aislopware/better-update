import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { AppleTeam } from "../domain/apple-team";
import { Conflict } from "../domain/errors";

const idParam = HttpApiSchema.param("id", Schema.String);

export class AppleTeamsGroup extends HttpApiGroup.make("appleTeams")
  .add(
    HttpApiEndpoint.get("list", "/api/apple-teams")
      .addSuccess(Schema.Struct({ items: Schema.Array(AppleTeam) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List Apple teams",
          description:
            "List Apple developer teams derived from uploaded artifacts (certs, push keys, ASC keys)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("protect")`/api/apple-teams/${idParam}/protection`
      .addSuccess(AppleTeam)
      .annotateContext(
        OpenApi.annotations({
          title: "Protect Apple team",
          description:
            "Mark the team protected (GITLAB-RBAC-SPEC §3b): every credential under it — certs, push keys/certs, provisioning profiles, ASC API keys — requires Maintainer+. Org admin only. Idempotent.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("unprotect")`/api/apple-teams/${idParam}/protection`
      .addSuccess(AppleTeam)
      .annotateContext(
        OpenApi.annotations({
          title: "Unprotect Apple team",
          description: "Remove the team's protection. Org admin only. Idempotent.",
        }),
      ),
  )
  .addError(Forbidden)
  .addError(NotFound)
  .addError(Conflict)
  .annotateContext(
    OpenApi.annotations({
      title: "Apple Teams",
      description:
        "Apple teams auto-created from uploaded credentials, plus the protected-team toggle",
    }),
  ) {}
