import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
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
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "../../../../lib/auth-client";
import { generateSlug, nameSchema, slugSchema } from "../../../../lib/form-utils";
import { orgsQueryOptions, sessionQueryOptions } from "../../../../queries/auth";

const OrgGeneralForm = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  const { data: orgs } = useSuspenseQuery(orgsQueryOptions);
  const activeOrgId = session?.user.activeOrganizationId;
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const slugEdited = useRef(false);

  const form = useForm({
    defaultValues: {
      name: activeOrg?.name ?? "",
      slug: activeOrg?.slug ?? "",
    },
    onSubmit: async ({ value }) => {
      const { error } = await authClient.organization.update({
        data: { name: value.name, slug: value.slug },
      });

      if (error) {
        toast.error(error.message ?? "Failed to update organization");
        return;
      }

      toast.success("Organization updated");
      await queryClient.resetQueries({ queryKey: ["auth"] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>Update your organization details.</CardDescription>
      </CardHeader>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await form.handleSubmit();
        }}
      >
        <CardContent className="flex flex-col gap-4">
          <form.Field
            name="name"
            validators={{
              onBlur: ({ value }) => {
                const result = nameSchema.safeParse(value);
                return result.success ? undefined : result.error.issues[0]?.message;
              },
            }}
          >
            {(field) => {
              const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
              return (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="org-name">Organization name</Label>
                  <Input
                    id="org-name"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      if (!slugEdited.current) {
                        form.setFieldValue("slug", generateSlug(event.target.value), {
                          dontUpdateMeta: true,
                          dontValidate: true,
                        });
                      }
                    }}
                    onBlur={field.handleBlur}
                  />
                  {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
                </div>
              );
            }}
          </form.Field>

          <form.Field
            name="slug"
            validators={{
              onBlur: ({ value }) => {
                const result = slugSchema.safeParse(value);
                return result.success ? undefined : result.error.issues[0]?.message;
              },
            }}
          >
            {(field) => {
              const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
              return (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="org-slug">URL slug</Label>
                  <Input
                    id="org-slug"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      slugEdited.current = event.target.value !== "";
                    }}
                    onBlur={field.handleBlur}
                  />
                  {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
                </div>
              );
            }}
          </form.Field>
        </CardContent>
        <CardFooter>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? "Saving..." : "Save changes"}
              </Button>
            )}
          </form.Subscribe>
        </CardFooter>
      </form>
    </Card>
  );
};

const DeleteOrgSection = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  const { data: orgs } = useSuspenseQuery(orgsQueryOptions);
  const activeOrgId = session?.user.activeOrganizationId;
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!activeOrg) {
      return;
    }
    setIsDeleting(true);
    const { error } = await authClient.organization.delete({
      organizationId: activeOrg.id,
    });
    setIsDeleting(false);

    if (error) {
      toast.error(error.message ?? "Failed to delete organization");
      return;
    }

    toast.success("Organization deleted");
    await queryClient.resetQueries({ queryKey: ["auth"] });
    await router.invalidate();
  };

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle>Danger zone</CardTitle>
        <CardDescription>Permanently delete this organization and all of its data.</CardDescription>
      </CardHeader>
      <CardFooter>
        <Dialog>
          <DialogTrigger>
            <Button variant="destructive">Delete organization</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {activeOrg?.name}?</DialogTitle>
              <DialogDescription>
                This action cannot be undone. All projects, API keys, and members will be
                permanently removed.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 py-4">
              <Label htmlFor="confirm-delete">
                Type <span className="font-mono font-bold">{activeOrg?.slug}</span> to confirm
              </Label>
              <Input
                id="confirm-delete"
                value={confirmText}
                onChange={(event) => {
                  setConfirmText(event.target.value);
                }}
                placeholder={activeOrg?.slug ?? ""}
              />
            </div>
            <DialogFooter>
              <DialogClose>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                variant="destructive"
                disabled={confirmText !== activeOrg?.slug || isDeleting}
                onClick={handleDelete}
              >
                {isDeleting ? "Deleting..." : "Delete permanently"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
};

const Settings = () => (
  <div className="mx-auto flex max-w-2xl flex-col gap-6">
    <div>
      <h1 className="text-2xl font-bold">Organization Settings</h1>
      <p className="text-muted-foreground mt-1">
        Manage your organization details and preferences.
      </p>
    </div>
    <OrgGeneralForm />
    <Separator />
    <DeleteOrgSection />
  </div>
);

export const Route = createFileRoute("/_authed/_app/settings/")({
  component: Settings,
});
