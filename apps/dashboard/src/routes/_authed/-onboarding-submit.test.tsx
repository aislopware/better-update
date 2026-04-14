import { useForm } from "@tanstack/react-form";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Deferred, Effect } from "effect";
import { useRef } from "react";

import { mockFetch } from "../../../tests/helpers/mock-fetch";
import { generateSlug, nameSchema, slugSchema } from "../../lib/form-utils";

/**
 * Standalone test form replicating Onboarding's submit handler.
 * The onboarding page creates an organization via
 * authClient.organization.create, then sets it active.
 * Derived-state wiring is covered in -derived-state-forms.test.tsx.
 */

const OnboardingSubmitTestForm = () => {
  const slugEdited = useRef(false);

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    onSubmit: async ({ value }) => {
      const response = await fetch("/api/auth/organization/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: value.name, slug: value.slug }),
      });

      if (!response.ok) {
        return;
      }

      const data: { id?: string } = await response.json();

      if (data.id) {
        await fetch("/api/auth/organization/set-active", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId: data.id }),
        });
      }
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
            <div>
              <label htmlFor="name">Organization name</label>
              <input
                id="name"
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
              {errorMessage ? <span role="alert">{errorMessage}</span> : null}
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
            <div>
              <label htmlFor="slug">URL slug</label>
              <input
                id="slug"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  slugEdited.current = event.target.value !== "";
                }}
                onBlur={field.handleBlur}
              />
              {errorMessage ? <span role="alert">{errorMessage}</span> : null}
            </div>
          );
        }}
      </form.Field>

      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
        {([canSubmit, isSubmitting]) => (
          <button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? "Creating..." : "Create organization"}
          </button>
        )}
      </form.Subscribe>
    </form>
  );
};

describe("onboarding form submit", () => {
  test("submitting calls organization create then set-active", async () => {
    const user = userEvent.setup();

    const fetchMock = mockFetch({
      "POST /api/auth/organization/create": () =>
        Response.json({ id: "org-new-1", name: "Acme", slug: "acme" }),
      "POST /api/auth/organization/set-active": () => Response.json({ success: true }),
    });

    render(<OnboardingSubmitTestForm />);

    await user.type(screen.getByLabelText("Organization name"), "Acme Inc.");
    await user.click(screen.getByRole("button", { name: "Create organization" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // First call: organization create
    const createCall = fetchMock.mock.calls[0]!;
    const createBody = JSON.parse(createCall[1]?.body as string);
    expect(createBody.name).toBe("Acme Inc.");
    expect(createBody.slug).toBe("acme-inc");

    // Second call: set active
    const activeCall = fetchMock.mock.calls[1]!;
    const activeBody = JSON.parse(activeCall[1]?.body as string);
    expect(activeBody.organizationId).toBe("org-new-1");

    vi.restoreAllMocks();
  });

  test("button is disabled while submitting", async () => {
    const user = userEvent.setup();

    const createDeferred = Effect.runSync(Deferred.make<undefined>());

    const SubmitStateForm = () => {
      const form = useForm({
        defaultValues: { name: "" },
        onSubmit: async () => {
          await Effect.runPromise(Deferred.await(createDeferred));
        },
      });

      return (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            await form.handleSubmit();
          }}
        >
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? "Creating..." : "Create organization"}
              </button>
            )}
          </form.Subscribe>
        </form>
      );
    };

    render(<SubmitStateForm />);

    await user.click(screen.getByRole("button", { name: "Create organization" }));

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeDisabled();
    });

    await Effect.runPromise(Deferred.succeed(createDeferred, undefined));

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeEnabled();
    });
  });

  test("name validation shows error for empty name on blur", async () => {
    const user = userEvent.setup();
    render(<OnboardingSubmitTestForm />);

    const nameInput = screen.getByLabelText("Organization name");
    await user.click(nameInput);
    await user.tab();

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      const nameAlert = alerts.find((el) => el.textContent.includes("Name"));
      expect(nameAlert).toHaveTextContent("Name must be at least 2 characters");
    });
  });
});
