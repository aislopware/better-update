import { defineCommand } from "citty";

import { runLogin } from "../application/login";
import { runEffect } from "../lib/citty-effect";

export const loginCommand = defineCommand({
  meta: { name: "login", description: "Log in to better-update" },
  args: {
    "api-key": {
      type: "boolean",
      description: "Paste an API key manually instead of opening the browser",
    },
  },
  run: async ({ args }) => runEffect(runLogin({ manualApiKey: args["api-key"] ?? false })),
});
