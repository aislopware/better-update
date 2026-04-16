import { createFileRoute } from "@tanstack/react-router";

import { throwRedirect } from "../../../lib/throw-redirect";

export const Route = createFileRoute("/_authed/_app/")({
  beforeLoad: () => {
    throwRedirect({ to: "/projects" });
  },
});
