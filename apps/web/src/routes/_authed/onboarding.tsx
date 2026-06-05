import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardPanel } from "@better-update/ui/components/ui/card";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
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
import { logout } from "../../lib/logout";
import { useCreateAndActivateOrgMutation } from "../../lib/org-mutations";
import { safeSubmit, useApiMutation } from "../../lib/use-api-mutation";
import { orgsQueryOptions, sessionQueryOptions } from "../../queries/auth";

const SignedInAs = () => {
  const queryClient = useQueryClient();
  const { session } = Route.useRouteContext();
  const { user } = session;

  const logoutMutation = useApiMutation({
    mutationFn: async () => logout(queryClient),
  });

  return (
    <p className="text-muted-foreground text-center text-sm">
      Signed in as <span className="text-foreground font-medium">{user.email}</span>.{" "}
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 align-baseline"
        loading={logoutMutation.isPending}
        onClick={() => {
          logoutMutation.mutate();
        }}
      >
        Log out
      </Button>
    </p>
  );
};

const Onboarding = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const slugEdited = useRef(false);

  const createOrg = useCreateAndActivateOrgMutation({
    onSuccess: async () => {
      // Prime the auth guards (session + orgs) with fresh data BEFORE navigating
      // so the redirect chain reads warm cache instead of fetching — and
      // suspending — mid-transition (which surfaces a router `undefined` throw).
      await Promise.all([
        queryClient.refetchQueries({ queryKey: sessionQueryOptions.queryKey, type: "all" }),
        queryClient.refetchQueries({ queryKey: orgsQueryOptions.queryKey, type: "all" }),
      ]);
      await router.navigate({ to: "/" });
    },
  });

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(createOrg.mutateAsync(value));
    },
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-16">
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
              <div className="grid gap-4">
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
                      <Field invalid={Boolean(errorMessage)}>
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
                      <Field invalid={Boolean(errorMessage)}>
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
                        />
                        <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
                      </Field>
                    );
                  }}
                </form.Field>
              </div>
              <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                {([canSubmit, isSubmitting]) => (
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={!canSubmit}
                    loading={Boolean(isSubmitting)}
                  >
                    Create organization
                  </Button>
                )}
              </form.Subscribe>
            </Form>
          </CardPanel>
        </Card>
      </Frame>
      <SignedInAs />
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
