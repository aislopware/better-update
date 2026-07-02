import { Button } from "@better-update/ui/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { EllipsisVerticalIcon, ScrollTextIcon } from "lucide-react";
import { useState } from "react";

import { RobotPoliciesDialog } from "./-robot-policies-dialog";

export const RobotRowActions = ({
  orgId,
  robotId,
  robotName,
  canManagePolicies,
}: {
  orgId: string;
  robotId: string;
  robotName: string;
  canManagePolicies: boolean;
}) => {
  const [policiesOpen, setPoliciesOpen] = useState(false);

  if (!canManagePolicies) {
    return null;
  }

  return (
    <>
      <Menu>
        <MenuTrigger
          render={<Button variant="ghost" size="icon" aria-label="Robot account actions" />}
        >
          <EllipsisVerticalIcon strokeWidth={2} />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuGroup>
            <MenuItem
              onClick={() => {
                setPoliciesOpen(true);
              }}
            >
              <ScrollTextIcon strokeWidth={2} />
              <span>Manage access</span>
            </MenuItem>
          </MenuGroup>
        </MenuPopup>
      </Menu>
      <RobotPoliciesDialog
        orgId={orgId}
        robotId={robotId}
        robotName={robotName}
        open={policiesOpen}
        onOpenChange={setPoliciesOpen}
      />
    </>
  );
};
