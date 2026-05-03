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
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useRef } from "react";

import { SlugInput } from "../../components/slug-input";
import { generateSlug, getFieldError, nameSchema, slugSchema } from "../../lib/form-utils";
import { createAndActivateOrg } from "../../lib/org-mutations";

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
      const result = await createAndActivateOrg(value);
      if (!result) {
        return;
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
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            A workspace where teams collaborate on projects, credentials, and API keys.
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await form.handleSubmit();
          }}
        >
          <DialogPanel>
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
                  const invalid = Boolean(errorMessage);
                  return (
                    <Field invalid={invalid}>
                      <FieldLabel htmlFor="create-org-name">Organization name</FieldLabel>
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
                      <FieldError match={invalid}>{errorMessage}</FieldError>
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
                  const invalid = Boolean(errorMessage);
                  return (
                    <Field invalid={invalid}>
                      <FieldLabel htmlFor="create-org-slug">Workspace URL</FieldLabel>
                      <SlugInput
                        addonStart="better-update.dev/"
                        id="create-org-slug"
                        placeholder="acme-inc"
                        value={field.state.value}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                          slugEdited.current = event.target.value !== "";
                        }}
                        onBlur={field.handleBlur}
                      />
                      <p className="text-muted-foreground text-xs">
                        Lowercase letters, numbers and dashes only.
                      </p>
                      <FieldError match={invalid}>{errorMessage}</FieldError>
                    </Field>
                  );
                }}
              </form.Field>
            </FieldGroup>
          </DialogPanel>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Creating…" : "Create organization"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
};
