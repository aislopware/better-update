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
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod/v4";

const emailSchema = z.email("Please enter a valid email address");

const ForgotPassword = () => {
  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      const response = await fetch("/api/auth/forget-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value.email, redirectTo: "/reset-password" }),
      });
      if (!response.ok) {
        const data: unknown = await response.json();
        const message =
          typeof data === "object" && data !== null && "message" in data
            ? String(data.message)
            : "Failed to send reset link";
        toast.error(message);
        return;
      }
      toast.success("Check your email for a reset link");
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Forgot password</CardTitle>
          <CardDescription>Enter your email and we&apos;ll send you a reset link</CardDescription>
        </CardHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await form.handleSubmit();
          }}
        >
          <CardContent>
            <form.Field
              name="email"
              validators={{
                onBlur: ({ value }) => {
                  const result = emailSchema.safeParse(value);
                  return result.success ? undefined : result.error.issues[0]?.message;
                },
              }}
            >
              {(field) => {
                const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
                return (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
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
          <CardFooter className="flex flex-col gap-4">
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Sending..." : "Send reset link"}
                </Button>
              )}
            </form.Subscribe>
            <Link to="/login" className="text-muted-foreground text-sm hover:underline">
              Back to login
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export const Route = createFileRoute("/(auth)/forgot-password")({
  beforeLoad: ({ context }) => {
    if (context.session?.user) {
      throw redirect({ to: "/" });
    }
  },
  component: ForgotPassword,
});
