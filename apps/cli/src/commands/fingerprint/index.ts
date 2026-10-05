import { Command } from "effect/cli";

import { compareCommand } from "./compare";
import { generateCommand } from "./generate";

export const fingerprintCommand = Command.make("fingerprint").pipe(
  Command.withDescription("Fingerprint utilities"),
  Command.withSubcommands([generateCommand, compareCommand]),
);
