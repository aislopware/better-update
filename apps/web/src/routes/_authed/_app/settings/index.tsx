import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { PageHeader } from "../../../../components/page-header";
import { SettingCard } from "../../../../components/setting-card";
import { authClient } from "../../../../lib/auth-client";
import { generateSlug, getFieldError, nameSchema, slugSchema } from "../../../../lib/form-utils";
import { useDeleteOrgMutation } from "../../../../lib/org-mutations";

const deleteOrgTrigger = <Button variant="destructive">Delete organization</Button>;

const OrgGeneralForm = () => {
  const queryClient = useQueryClient();
  const { activeOrg } = Route.useRouteContext();
  const slugEdited = useRef(false);

  const form = useForm({
    defaultValues: {
      name: activeOrg.name,
      slug: activeOrg.slug,
    },
    onSubmit: async ({ value }) => {
      const { error } = await authClient.organization.update({
        data: { name: value.name, slug: value.slug },
      });

      if (error) {
        toastManager.add({
          title: error.message ?? "Failed to update organization",
          type: "error",
        });
        return;
      }

      toastManager.add({ title: "Organization updated", type: "success" });
      await queryClient.resetQueries({ queryKey: ["auth"] });
    },
  });

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <SettingCard
        title="General"
        description="Update your organization details."
        footer={
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit} loading={Boolean(isSubmitting)}>
                Save changes
              </Button>
            )}
          </form.Subscribe>
        }
      >
        <FieldGroup>
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
              const errorMessage = getFieldError(field);
              return (
                <Field data-invalid={errorMessage ? true : undefined}>
                  <FieldLabel htmlFor="org-name">Organization name</FieldLabel>
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
                    aria-invalid={errorMessage ? true : undefined}
                  />
                  <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
                </Field>
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
              const errorMessage = getFieldError(field);
              return (
                <Field data-invalid={errorMessage ? true : undefined}>
                  <FieldLabel htmlFor="org-slug">URL slug</FieldLabel>
                  <Input
                    id="org-slug"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      slugEdited.current = event.target.value !== "";
                    }}
                    onBlur={field.handleBlur}
                    aria-invalid={errorMessage ? true : undefined}
                  />
                  <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
                </Field>
              );
            }}
          </form.Field>
        </FieldGroup>
      </SettingCard>
    </form>
  );
};

const DeleteOrgSection = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeOrg } = Route.useRouteContext();
  const [confirmText, setConfirmText] = useState("");

  const deleteOrgMutation = useDeleteOrgMutation({
    orgId: activeOrg.id,
    onSuccess: async () => {
      toastManager.add({ title: "Organization deleted", type: "success" });
      await queryClient.resetQueries({ queryKey: ["auth"] });
      await router.invalidate();
    },
  });

  const handleDelete = () => {
    deleteOrgMutation.mutate();
  };

  return (
    <SettingCard
      className="border-destructive"
      title="Danger zone"
      description="Permanently delete this organization and all of its data."
      footer={
        <Dialog>
          <DialogTrigger render={deleteOrgTrigger} />
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Delete {activeOrg.name}?</DialogTitle>
              <DialogDescription>
                This action cannot be undone. All projects, API keys, and members will be
                permanently removed.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <Field>
                <FieldLabel htmlFor="confirm-delete">
                  Type <span className="font-mono font-bold">{activeOrg.slug}</span> to confirm
                </FieldLabel>
                <Input
                  id="confirm-delete"
                  value={confirmText}
                  onChange={(event) => {
                    setConfirmText(event.target.value);
                  }}
                  placeholder={activeOrg.slug}
                />
              </Field>
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button
                variant="destructive"
                disabled={confirmText !== activeOrg.slug}
                loading={deleteOrgMutation.isPending}
                onClick={handleDelete}
              >
                Delete permanently
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      }
    />
  );
};

const Settings = () => (
  <div className="flex w-full flex-col gap-6">
    <PageHeader
      title="Organization settings"
      description="Update organization details or permanently delete the organization."
    />
    <OrgGeneralForm />
    <DeleteOrgSection />
  </div>
);

export const Route = createFileRoute("/_authed/_app/settings/")({
  component: Settings,
});
