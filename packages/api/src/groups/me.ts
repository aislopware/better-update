import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { Me } from "../domain/me";

export class MeGroup extends HttpApiGroup.make("me")
  .add(
    HttpApiEndpoint.get("get", "/api/me")
      .addSuccess(Me)
      .annotateContext(
        OpenApi.annotations({
          title: "Get current actor",
          description:
            "Return the authenticated user + active organization. Useful for `whoami` and to verify the CLI's auth state.",
        }),
      ),
  )
  .annotateContext(
    OpenApi.annotations({
      title: "Me",
      description: "Current authenticated actor information",
    }),
  ) {}
