import { defineCommand } from "citty";

import { attachGroupPolicyCommand } from "./attach";
import { createGroupCommand } from "./create";
import { deleteGroupCommand } from "./delete";
import { detachGroupPolicyCommand } from "./detach";
import { listGroupsCommand } from "./list";
import { membersCommand } from "./members";
import { listGroupPoliciesCommand } from "./policies";
import { updateGroupCommand } from "./update";

export const groupsCommand = defineCommand({
  meta: {
    name: "groups",
    description: "Manage member groups for collective policy attachment",
  },
  subCommands: {
    list: listGroupsCommand,
    create: createGroupCommand,
    update: updateGroupCommand,
    delete: deleteGroupCommand,
    members: membersCommand,
    policies: listGroupPoliciesCommand,
    attach: attachGroupPolicyCommand,
    detach: detachGroupPolicyCommand,
  },
});
