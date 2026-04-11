import { getApiError } from "@better-update/api-client";
import { deleteProject } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import { Separator } from "@better-update/ui/components/ui/separator";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import type { ProjectDetail } from "@better-update/api-client/react";

export const DeleteProjectSection = ({ project }: { project: ProjectDetail }) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setConfirmText("");
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await deleteProject(project.id);
    } catch (error) {
      toast.error(getApiError(error));
      setIsDeleting(false);
      return;
    }
    setIsDeleting(false);
    toast.success("Project deleted");
    await queryClient.invalidateQueries({ queryKey: ["org", project.organizationId, "projects"] });
    queryClient.removeQueries({ queryKey: ["project", project.id] });
    await router.navigate({ to: "/projects" });
  };

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
          <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger>
              <Button variant="destructive">Delete project</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete {project.name}?</DialogTitle>
                <DialogDescription>
                  This action cannot be undone. All branches, channels, and updates will be
                  permanently removed.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2 py-4">
                <Label htmlFor="confirm-delete-project">
                  Type <span className="font-mono font-bold">{project.name}</span> to confirm
                </Label>
                <Input
                  id="confirm-delete-project"
                  value={confirmText}
                  onChange={(event) => {
                    setConfirmText(event.target.value);
                  }}
                  placeholder={project.name}
                />
              </div>
              <DialogFooter>
                <DialogClose>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  disabled={confirmText !== project.name || isDeleting}
                  onClick={handleDelete}
                >
                  {isDeleting ? "Deleting..." : "Delete permanently"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardFooter>
      </Card>
    </>
  );
};
