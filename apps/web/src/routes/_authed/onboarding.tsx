import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useRef } from "react";

import { BrandWordmark } from "../../components/brand-mark";
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
        disabled={logoutMutation.isPending}
        onClick={() => {
          logoutMutation.mutate();
        }}
      >
        {logoutMutation.isPending && <Spinner data-icon="inline-start" />}
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
    <div className="bg-background relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-16">
      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-6">
        <BrandWordmark />
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Create your organization</CardTitle>
            <CardDescription>
              Organizations are shared workspaces where teams manage projects and API keys together.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
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
                      <Field data-invalid={Boolean(errorMessage)}>
                        <FieldLabel htmlFor="name">Organization name</FieldLabel>
                        <Input
                          id="name"
                          placeholder="Acme Inc."
                          aria-invalid={Boolean(errorMessage) || undefined}
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
                        {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
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
                      <Field data-invalid={Boolean(errorMessage)}>
                        <FieldLabel htmlFor="slug">URL slug</FieldLabel>
                        <Input
                          id="slug"
                          placeholder="acme-inc"
                          aria-invalid={Boolean(errorMessage) || undefined}
                          value={field.state.value}
                          onChange={(event) => {
                            field.handleChange(event.target.value);
                            slugEdited.current = event.target.value !== "";
                          }}
                          onBlur={field.handleBlur}
                        />
                        {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
                      </Field>
                    );
                  }}
                </form.Field>
              </FieldGroup>
              <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                {([canSubmit, isSubmitting]) => (
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={!canSubmit || Boolean(isSubmitting)}
                  >
                    {Boolean(isSubmitting) && <Spinner data-icon="inline-start" />}
                    Create organization
                  </Button>
                )}
              </form.Subscribe>
            </form>
          </CardContent>
        </Card>
        <SignedInAs />
      </div>
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
