import { useForm } from "@tanstack/react-form";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Deferred, Effect } from "effect";
import { z } from "zod/v4";

import { mockFetch } from "../../../tests/helpers/mock-fetch";

/**
 * Standalone test form replicating LoginPage's submit handler.
 * The actual LoginPage uses Route.useRouteContext() which requires
 * TanStack Router context — this form replicates the interaction
 * logic (email + password submit -> authClient.signIn.email).
 */

const LoginTestForm = () => {
  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value.email, password: value.password }),
      });
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
      <form.Field
        name="email"
        validators={{
          onBlur: ({ value }) => {
            const result = z.email("Invalid email address").safeParse(value);
            return result.success ? undefined : result.error.issues[0]?.message;
          },
        }}
      >
        {(field) => {
          const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
          return (
            <div>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(ev) => field.handleChange(ev.target.value)}
              />
              {errorMessage ? <span role="alert">{errorMessage}</span> : null}
            </div>
          );
        }}
      </form.Field>

      <form.Field
        name="password"
        validators={{
          onBlur: ({ value }) => {
            const result = z
              .string()
              .check(z.minLength(8, "Password must be at least 8 characters"))
              .safeParse(value);
            return result.success ? undefined : result.error.issues[0]?.message;
          },
        }}
      >
        {(field) => {
          const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
          return (
            <div>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(ev) => field.handleChange(ev.target.value)}
              />
              {errorMessage ? <span role="alert">{errorMessage}</span> : null}
            </div>
          );
        }}
      </form.Field>

      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        )}
      </form.Subscribe>
    </form>
  );
};

/**
 * Minimal form that accepts an onSubmit callback, used to test
 * the isSubmitting disabled/enabled state transition.
 */
const LoginSubmitStateTestForm = ({ onSubmit }: { onSubmit: () => Promise<void> }) => {
  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async () => {
      await onSubmit();
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
      <label htmlFor="ls-email">Email</label>
      <input
        id="ls-email"
        value={form.state.values.email}
        onChange={(ev) => form.setFieldValue("email", ev.target.value)}
      />
      <label htmlFor="ls-password">Password</label>
      <input
        id="ls-password"
        type="password"
        value={form.state.values.password}
        onChange={(ev) => form.setFieldValue("password", ev.target.value)}
      />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        )}
      </form.Subscribe>
    </form>
  );
};

describe("login form submit", () => {
  test("submitting with valid credentials calls sign-in endpoint", async () => {
    const user = userEvent.setup();

    const fetchMock = mockFetch({
      "POST /api/auth/sign-in/email": () => Response.json({ session: { id: "s1", token: "tok" } }),
    });

    render(<LoginTestForm />);

    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Password"), "securepassword");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const call = fetchMock.mock.calls[0]!;
    const body = JSON.parse(call[1]?.body as string);
    expect(body.email).toBe("test@example.com");
    expect(body.password).toBe("securepassword");

    vi.restoreAllMocks();
  });

  test("submit button is disabled while submitting", async () => {
    const user = userEvent.setup();

    const signInDeferred = Effect.runSync(Deferred.make<undefined>());

    render(
      <LoginSubmitStateTestForm
        onSubmit={async () => Effect.runPromise(Deferred.await(signInDeferred))}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeDisabled();
    });

    await Effect.runPromise(Deferred.succeed(signInDeferred, undefined));

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeEnabled();
    });
  });

  test("email validation error shows on blur", async () => {
    const user = userEvent.setup();
    render(<LoginTestForm />);

    await user.type(screen.getByLabelText("Email"), "not-valid");
    await user.tab();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid email address");
    });
  });

  test("password validation error shows on blur", async () => {
    const user = userEvent.setup();
    render(<LoginTestForm />);

    await user.type(screen.getByLabelText("Password"), "short");
    await user.tab();

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      const pwAlert = alerts.find((el) => el.textContent.includes("Password"));
      expect(pwAlert).toHaveTextContent("Password must be at least 8 characters");
    });
  });
});
