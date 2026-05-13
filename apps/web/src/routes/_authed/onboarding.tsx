import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardPanel } from "@better-update/ui/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Form } from "@better-update/ui/components/ui/form";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FrameTitle,
} from "@better-update/ui/components/ui/frame";
import { Input } from "@better-update/ui/components/ui/input";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useRef } from "react";

import { generateSlug, getFieldError, nameSchema, slugSchema } from "../../lib/form-utils";
import { createAndActivateOrg } from "../../lib/org-mutations";

const Onboarding = () => {
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
      await router.navigate({ to: "/" });
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Frame className="w-full max-w-md">
        <FrameHeader>
          <FrameTitle>Create your organization</FrameTitle>
          <FrameDescription>
            Organizations are shared workspaces where teams manage projects and API keys together.
          </FrameDescription>
        </FrameHeader>
        <Card>
          <CardPanel>
            <Form
              className="flex w-full flex-col gap-4"
              onSubmit={async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await form.handleSubmit();
              }}
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
                        <FieldLabel htmlFor="name">Organization name</FieldLabel>
                        <Input
                          id="name"
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
                        <FieldLabel htmlFor="slug">URL slug</FieldLabel>
                        <Input
                          id="slug"
                          placeholder="acme-inc"
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
              <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                {([canSubmit, isSubmitting]) => (
                  <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? "Creating..." : "Create organization"}
                  </Button>
                )}
              </form.Subscribe>
            </Form>
          </CardPanel>
        </Card>
      </Frame>
    </div>
  );
};

export const Route = createFileRoute("/_authed/onboarding")({
  beforeLoad: ({ context }) => {
    if (context.orgs.length > 0) {
      // eslint-disable-next-line functional/no-throw-statements, typescript/only-throw-error -- TanStack Router idiom: throw redirect preserves typed `to` inference
      throw redirect({ to: "/" });
    }
  },
  component: Onboarding,
});
