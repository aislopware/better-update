import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useRef } from "react";
import { toast } from "sonner";

import { authClient } from "../../lib/auth-client";
import { generateSlug, nameSchema, slugSchema } from "../../lib/form-utils";

export const CreateOrgDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const slugEdited = useRef(false);

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    onSubmit: async ({ value }) => {
      const { data, error } = await authClient.organization.create({
        name: value.name,
        slug: value.slug,
      });

      if (error) {
        toast.error(error.message ?? "Failed to create organization");
        return;
      }

      if (data.id) {
        await authClient.organization.setActive({ organizationId: data.id });
      }
      await queryClient.resetQueries({ queryKey: ["auth"] });
      form.reset();
      slugEdited.current = false;
      onOpenChange(false);
      await router.navigate({ to: "/" });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          form.reset();
          slugEdited.current = false;
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Organizations are shared workspaces where teams manage projects and API keys together.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await form.handleSubmit();
          }}
        >
          <div className="flex flex-col gap-4">
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
                    <Label htmlFor="create-org-name">Organization name</Label>
                    <Input
                      id="create-org-name"
                      placeholder="Acme Inc."
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
                    {errorMessage ? (
                      <p className="text-destructive text-sm">{errorMessage}</p>
                    ) : null}
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
                    <Label htmlFor="create-org-slug">URL slug</Label>
                    <Input
                      id="create-org-slug"
                      placeholder="acme-inc"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                        slugEdited.current = event.target.value !== "";
                      }}
                      onBlur={field.handleBlur}
                    />
                    {errorMessage ? (
                      <p className="text-destructive text-sm">{errorMessage}</p>
                    ) : null}
                  </div>
                );
              }}
            </form.Field>
          </div>

          <DialogFooter className="mt-6">
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create organization"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
