import { Button } from "@better-update/ui/components/button";
import { DropdownMenu } from "@better-update/ui/components/dropdown";
import {
  DeviceMobileIcon,
  DotsThreeVerticalIcon,
  DownloadSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import type { BuildWithArtifact } from "@better-update/api";

import { DeleteBuildDialog } from "../-delete-build-dialog";
import { InstallLinkDialog } from "../-install-link-dialog";

/**
 * Row actions for the builds list, in the same ⋮ menu every other list uses.
 * Bare icon buttons used to sit in the row, but install and download only exist
 * once a build has an artifact — so the delete button slid sideways from row to
 * row depending on whether the build had finished. A menu has one anchor
 * whatever it holds, and the items that do not apply simply are not offered.
 *
 * Both dialogs' open-state is lifted out of the menu, per the Menu→Dialog
 * convention: picking an item unmounts the menu, and an uncontrolled dialog
 * would go with it.
 */
export const BuildRowActions = ({
  build,
  orgId,
  projectId,
}: {
  build: BuildWithArtifact;
  orgId: string;
  projectId: string;
}) => {
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenu.Trigger
          render={
            <Button
              variant="ghost"
              shape="square"
              className="text-kumo-subtle/70 hover:text-kumo-default"
              aria-label="Build actions"
            />
          }
        >
          <DotsThreeVerticalIcon weight="bold" />
        </DropdownMenu.Trigger>
        {/* w-auto: size to the labels, not the icon-button anchor width. */}
        <DropdownMenu.Content align="end" className="w-auto">
          {build.artifact ? (
            <>
              <DropdownMenu.Item
                icon={DeviceMobileIcon}
                onClick={() => {
                  setIsInstallOpen(true);
                }}
              >
                Install link
              </DropdownMenu.Item>
              {/* A real anchor, so the browser downloads it rather than the app
                  routing to it. */}
              <DropdownMenu.LinkItem
                icon={DownloadSimpleIcon}
                href={`/api/builds/${build.id}/artifact`}
              >
                Download artifact
              </DropdownMenu.LinkItem>
            </>
          ) : null}
          <DropdownMenu.Item
            variant="danger"
            icon={TrashIcon}
            onClick={() => {
              setIsDeleteOpen(true);
            }}
          >
            Delete build
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>
      {build.artifact ? (
        <InstallLinkDialog build={build} open={isInstallOpen} onOpenChange={setIsInstallOpen} />
      ) : null}
      <DeleteBuildDialog
        build={build}
        orgId={orgId}
        projectId={projectId}
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
      />
    </>
  );
};
