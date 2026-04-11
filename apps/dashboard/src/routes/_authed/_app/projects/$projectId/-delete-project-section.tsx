import { deleteProject } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Separator } from "@better-update/ui/components/ui/separator";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import type { ProjectDetail } from "@better-update/api-client/react";

import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";

export const DeleteProjectSection = ({ project }: { project: ProjectDetail }) => {
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <>
      <Separator />
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this project and all of its branches, channels, and updates.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <ConfirmDeleteDialog
            name={project.name}
            title={`Delete ${project.name}?`}
            description="This action cannot be undone. All branches, channels, and updates will be permanently removed."
            onConfirm={async () => deleteProject(project.id)}
            successMessage="Project deleted"
            onSuccess={async () => {
              await queryClient.invalidateQueries({
                queryKey: ["org", project.organizationId, "projects"],
              });
              queryClient.removeQueries({ queryKey: ["project", project.id] });
              await router.navigate({ to: "/projects" });
            }}
          >
            <Button variant="destructive">Delete project</Button>
          </ConfirmDeleteDialog>
        </CardFooter>
      </Card>
    </>
  );
};
