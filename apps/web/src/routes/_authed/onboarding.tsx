import { Button } from "@better-update/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/card";
import { FieldGroup } from "@better-update/ui/components/field-layout";
import { Input } from "@better-update/ui/components/input";
import { Link } from "@better-update/ui/components/link";
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
    <p className="text-kumo-subtle text-center text-sm">
      Signed in as <span className="text-kumo-default font-medium">{user.email}</span>.{" "}
      <Link
        render={
          // eslint-disable-next-line jsx-a11y/control-has-associated-label -- the Link supplies this button's label as its children
          <button
            type="button"
            disabled={logoutMutation.isPending}
            onClick={() => {
              logoutMutation.mutate();
            }}
          />
        }
      >
        Log out
      </Link>
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
    <div className="bg-kumo-canvas relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-16">
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
                      <Input
                        label="Organization name"
                        error={errorMessage}
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
                      <Input
                        label="URL slug"
                        error={errorMessage}
                        id="slug"
                        placeholder="acme-inc"
                        value={field.state.value}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                          slugEdited.current = event.target.value !== "";
                        }}
                        onBlur={field.handleBlur}
                      />
                    );
                  }}
                </form.Field>
              </FieldGroup>
              <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                {([canSubmit, isSubmitting]) => (
                  <Button
                    variant="primary"
                    type="submit"
                    className="w-full"
                    disabled={!canSubmit || Boolean(isSubmitting)}
                    loading={Boolean(isSubmitting)}
                  >
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
