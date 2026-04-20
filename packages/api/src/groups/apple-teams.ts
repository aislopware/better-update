import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { AppleTeam } from "../domain/apple-team";

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
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Apple Teams",
      description: "Read-only view of Apple teams auto-created from uploaded credentials",
    }),
  ) {}
