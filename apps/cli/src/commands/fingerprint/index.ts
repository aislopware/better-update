import { defineCommand } from "citty";

import { compareCommand } from "./compare";
import { generateCommand } from "./generate";

export const fingerprintCommand = defineCommand({
  meta: { name: "fingerprint", description: "Fingerprint utilities" },
  subCommands: {
    generate: generateCommand,
    compare: compareCommand,
  },
});
