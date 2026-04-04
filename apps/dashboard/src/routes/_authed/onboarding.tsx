import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useRef } from "react";
import { toast } from "sonner";

import { authClient } from "../../lib/auth-client";
import { generateSlug, nameSchema, slugSchema } from "../../lib/form-utils";

const Onboarding = () => {
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

      // Explicitly activate the new org — create may not update the session cookie
      if (data.id) {
        await authClient.organization.setActive({ organizationId: data.id });
      }

      await queryClient.resetQueries({ queryKey: ["auth"] });
      await router.navigate({ to: "/" });
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create your organization</CardTitle>
          <CardDescription>
            Organizations are shared workspaces where teams manage projects and API keys together.
          </CardDescription>
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
                    <Label htmlFor="name">Organization name</Label>
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
                    <Label htmlFor="slug">URL slug</Label>
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
                    {errorMessage ? (
                      <p className="text-destructive text-sm">{errorMessage}</p>
                    ) : null}
                  </div>
                );
              }}
            </form.Field>
          </CardContent>
          <CardFooter>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create organization"}
                </Button>
              )}
            </form.Subscribe>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export const Route = createFileRoute("/_authed/onboarding")({
  beforeLoad: ({ context }) => {
    if (context.orgs.length > 0) {
      throw redirect({ to: "/" });
    }
  },
  component: Onboarding,
});
