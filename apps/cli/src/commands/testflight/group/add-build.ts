import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { addBuildToGroups } from "../../../application/testflight-builds";
import { findBetaGroup } from "../../../application/testflight-groups";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface GroupAddBuildArgs extends AscCommonArgs {
  readonly build?: string | undefined;
  readonly "build-version"?: string | undefined;
  readonly group?: string | undefined;
  readonly "group-id"?: string | undefined;
}

export const groupAddBuildCommand = defineCommand({
  meta: {
    name: "add-build",
    description: "Assign an uploaded build to a TestFlight beta group",
  },
  args: {
    ...ASC_COMMON_ARGS,
    ...BUILD_SELECTOR_ARGS,
    group: { type: "string", description: "Beta group to assign the build to (by name)" },
    "group-id": { type: "string", description: "Beta group to assign the build to (by id)" },
  },
  run: async ({ args }: { readonly args: GroupAddBuildArgs }) =>
    runEffect(
      Effect.gen(function* () {
        if (args.group === undefined && args["group-id"] === undefined) {
          return yield* new InvalidArgumentError({ message: "Pass --group or --group-id." });
        }
        const session = yield* openAscSession(args);
        const group = yield* findBetaGroup(session.ctx, session.appId, {
          id: args["group-id"],
          name: args.group,
        });
        const build = yield* resolveBuild(session.ctx, session.appId, {
          buildId: args.build,
          buildVersion: args["build-version"],
        });
        yield* addBuildToGroups(build, [group.id]);
        yield* printHuman(`Assigned build ${build.attributes.version} to "${group.name}".`);
        return { buildId: build.id, buildVersion: build.attributes.version, groupId: group.id };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
