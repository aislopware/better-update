import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  BUILD_SELECTOR_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuild } from "../../../application/app-store-versions";
import { addBuildToGroups } from "../../../application/testflight-builds";
import { findBetaGroup } from "../../../application/testflight-groups";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const groupAddBuildCommand = Command.make(
  "add-build",
  {
    ...ASC_COMMON_ARGS,
    ...BUILD_SELECTOR_ARGS,
    group: Flag.String("group").pipe(
      Flag.withDescription("Beta group to assign the build to (by name)"),
      optionalFlag,
    ),
    "group-id": Flag.String("group-id").pipe(
      Flag.withDescription("Beta group to assign the build to (by id)"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Assign an uploaded build to a TestFlight beta group"));
