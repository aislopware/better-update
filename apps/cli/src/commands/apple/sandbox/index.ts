import { Command } from "effect/unstable/cli";

import { sandboxCreateCommand } from "./create";
import { sandboxDeleteCommand } from "./delete";
import { sandboxListCommand } from "./list";

export const appleSandboxCommand = Command.make("sandbox").pipe(
  Command.withDescription(
    "Manage App Store sandbox testers for IAP testing (list: ASC API key or Apple ID; create/delete: Apple ID login)",
  ),
  Command.withSubcommands([sandboxListCommand, sandboxCreateCommand, sandboxDeleteCommand]),
);
