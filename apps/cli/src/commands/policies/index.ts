import { defineCommand } from "citty";

import { createPolicyCommand } from "./create";
import { deletePolicyCommand } from "./delete";
import { listPoliciesCommand } from "./list";
import { updatePolicyCommand } from "./update";

export const policiesCommand = defineCommand({
  meta: {
    name: "policies",
    description: "Manage IAM policies (named, reusable permission grants)",
  },
  subCommands: {
    list: listPoliciesCommand,
    create: createPolicyCommand,
    update: updatePolicyCommand,
    delete: deletePolicyCommand,
  },
});
