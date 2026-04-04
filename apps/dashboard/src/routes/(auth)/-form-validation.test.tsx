import { useForm } from "@tanstack/react-form";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod/v4";

/**
 * These tests verify the validator + error display pattern used in auth forms.
 * The pattern: safeParse → return first issue message → .map(String).filter(Boolean).join(", ")
 * Regression: passing raw Zod schemas to validators produces "[object Object]".
 */

const emailValidator = z.email("Invalid email address");
const passwordValidator = z
  .string()
  .check(z.minLength(8, "Password must be at least 8 characters"));
const nameValidator = z.string().check(z.minLength(2, "Name must be at least 2 characters"));

const TestForm = () => {
  const form = useForm({
    defaultValues: { email: "", password: "", name: "" },
    onSubmit: async () => {},
  });

  return (
    <form>
      <form.Field
        name="email"
        validators={{
          onBlur: ({ value }) => {
            const result = emailValidator.safeParse(value);
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
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(ev) => field.handleChange(ev.target.value)}
              />
              {errorMessage && <span role="alert">{errorMessage}</span>}
            </div>
          );
        }}
      </form.Field>

      <form.Field
        name="password"
        validators={{
          onBlur: ({ value }) => {
            const result = passwordValidator.safeParse(value);
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
              {errorMessage && <span role="alert">{errorMessage}</span>}
            </div>
          );
        }}
      </form.Field>

      <form.Field
        name="name"
        validators={{
          onBlur: ({ value }) => {
            const result = nameValidator.safeParse(value);
            return result.success ? undefined : result.error.issues[0]?.message;
          },
        }}
      >
        {(field) => {
          const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
          return (
            <div>
              <label htmlFor="name">Name</label>
              <input
                id="name"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(ev) => field.handleChange(ev.target.value)}
              />
              {errorMessage && <span role="alert">{errorMessage}</span>}
            </div>
          );
        }}
      </form.Field>
    </form>
  );
};

describe("auth form validation errors", () => {
  test("invalid email shows readable message", async () => {
    const user = userEvent.setup();
    render(<TestForm />);

    const emailInput = screen.getByLabelText("Email");
    await user.type(emailInput, "not-an-email");
    await user.tab();

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("Invalid email address");
      expect(alert.textContent).not.toContain("[object Object]");
    });
  });

  test("short password shows readable message", async () => {
    const user = userEvent.setup();
    render(<TestForm />);

    const passwordInput = screen.getByLabelText("Password");
    await user.type(passwordInput, "short");
    await user.tab();

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      const passwordAlert = alerts.find((el) => el.textContent.includes("Password"));
      expect(passwordAlert).toHaveTextContent("Password must be at least 8 characters");
      expect(passwordAlert!.textContent).not.toContain("[object Object]");
    });
  });

  test("short name shows readable message", async () => {
    const user = userEvent.setup();
    render(<TestForm />);

    const nameInput = screen.getByLabelText("Name");
    await user.type(nameInput, "A");
    await user.tab();

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      const nameAlert = alerts.find((el) => el.textContent.includes("Name"));
      expect(nameAlert).toHaveTextContent("Name must be at least 2 characters");
      expect(nameAlert!.textContent).not.toContain("[object Object]");
    });
  });

  test("valid inputs show no error messages", async () => {
    const user = userEvent.setup();
    render(<TestForm />);

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.tab();
    await user.type(screen.getByLabelText("Password"), "securepassword123");
    await user.tab();
    await user.type(screen.getByLabelText("Name"), "John");
    await user.tab();

    await waitFor(() => {
      expect(screen.queryAllByRole("alert")).toHaveLength(0);
    });
  });
});
