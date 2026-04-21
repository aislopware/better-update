import { createFileRoute } from "@tanstack/react-router";

import { consoleUrl } from "../lib/console-redirect";
import { throwRedirect } from "../lib/throw-redirect";

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    if (context.session?.user) {
      throwRedirect({ href: consoleUrl() });
    }
    throwRedirect({ to: "/login" });
  },
});
