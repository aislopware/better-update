import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { printHumanKeyValue } from "../lib/output";
import { apiClient } from "../services/api-client";

export const whoamiCommand = defineCommand({
  meta: { name: "whoami", description: "Show the currently authenticated user + organization" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const me = yield* api.me.get();
        const rows: (readonly [string, string])[] = [];
        if (me.user) {
          rows.push(["User ID", me.user.id]);
          rows.push(["Name", me.user.name]);
          rows.push(["Email", me.user.email]);
        } else {
          rows.push(["Actor", me.actorEmail]);
        }
        rows.push(["Source", me.source]);
        if (me.activeOrganization) {
          rows.push(["Organization", me.activeOrganization.name]);
          rows.push(["Org slug", me.activeOrganization.slug]);
          rows.push(["Org ID", me.activeOrganization.id]);
          rows.push(["Role", me.activeOrganization.role ?? "—"]);
        } else {
          rows.push(["Organization", "(none)"]);
        }
        yield* printHumanKeyValue(rows);
        return me;
      }),
      { json: "value" },
    ),
});
