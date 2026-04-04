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
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod/v4";
const passwordSchema = z.string().check(z.minLength(8, "Password must be at least 8 characters"));

const ResetPasswordForm = ({
  token,
  router,
}: {
  token: string;
  router: ReturnType<typeof useRouter>;
}) => {
  const form = useForm({
    defaultValues: { password: "", confirmPassword: "" },
    onSubmit: async ({ value }) => {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: value.password, token }),
      });
      if (!response.ok) {
        const data: unknown = await response.json();
        const message =
          typeof data === "object" && data !== null && "message" in data
            ? String(data.message)
            : "Failed to reset password";
        toast.error(message);
        return;
      }
      toast.success("Password reset successfully");
      await router.navigate({ to: "/login" });
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
      <CardContent className="flex flex-col gap-4">
        <form.Field
          name="password"
          validators={{
            onBlur: ({ value }) => {
              const result = passwordSchema.safeParse(value);
              return result.success ? undefined : result.error.issues[0]?.message;
            },
          }}
        >
          {(field) => {
            const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
            return (
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
              </div>
            );
          }}
        </form.Field>

        <form.Field
          name="confirmPassword"
          validators={{
            onChangeListenTo: ["password"],
            onChange: ({ value, fieldApi }) =>
              value === fieldApi.form.getFieldValue("password")
                ? undefined
                : "Passwords do not match",
          }}
        >
          {(field) => {
            const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
            return (
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
              </div>
            );
          }}
        </form.Field>
      </CardContent>
      <CardFooter className="flex flex-col gap-4">
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Resetting..." : "Reset password"}
            </Button>
          )}
        </form.Subscribe>
        <Link to="/login" className="text-muted-foreground text-sm hover:underline">
          Back to login
        </Link>
      </CardFooter>
    </form>
  );
};

const ResetPassword = () => {
  const router = useRouter();
  const { token } = Route.useSearch();

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Invalid reset link</CardTitle>
            <CardDescription>This password reset link is invalid or has expired.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Link to="/forgot-password">
              <Button variant="outline">Request a new reset link</Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reset password</CardTitle>
          <CardDescription>Enter your new password below</CardDescription>
        </CardHeader>
        <ResetPasswordForm token={token} router={router} />
      </Card>
    </div>
  );
};

export const Route = createFileRoute("/(auth)/reset-password")({
  validateSearch: (search) => ({
    token: typeof search["token"] === "string" ? search["token"] : "",
  }),
  beforeLoad: ({ context }) => {
    if (context.session?.user) {
      throw redirect({ to: "/" });
    }
  },
  component: ResetPassword,
});
