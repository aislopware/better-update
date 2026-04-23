import { useForm } from "@tanstack/react-form";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";

import { mockFetch } from "../../../../../tests/helpers/mock-fetch";
import { generateSlug, getFieldError, nameSchema, slugSchema } from "../../../../lib/form-utils";

/**
 * Standalone test form replicating OrgGeneralForm's submit handler.
 * The derived-state (name -> slug) wiring is already tested in
 * -derived-state-forms.test.tsx. This test covers the submit flow.
 */

const SettingsFormTest = ({
  initialName,
  initialSlug,
}: {
  initialName: string;
  initialSlug: string;
}) => {
  const slugEdited = useRef(false);

  const form = useForm({
    defaultValues: { name: initialName, slug: initialSlug },
    onSubmit: async ({ value }) => {
      await fetch("/api/auth/organization/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: value.name, slug: value.slug }),
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
            <div>
              <label htmlFor="org-name">Organization name</label>
              <input
                id="org-name"
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
          const errorMessage = getFieldError(field);
          return (
            <div>
              <label htmlFor="org-slug">URL slug</label>
              <input
                id="org-slug"
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
            {isSubmitting ? "Saving..." : "Save changes"}
          </button>
        )}
      </form.Subscribe>
    </form>
  );
};

describe("settings org general form submit", () => {
  it("submitting with valid data calls organization update endpoint", async () => {
    const user = userEvent.setup();

    const fetchMock = mockFetch({
      "POST /api/auth/organization/update": () => Response.json({ success: true }),
    });

    render(<SettingsFormTest initialName="Old Org" initialSlug="old-org" />);

    const nameInput = screen.getByLabelText("Organization name");
    await user.clear(nameInput);
    await user.type(nameInput, "New Org Name");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith();
    });

    const call = fetchMock.mock.calls[0]!;
    const body = JSON.parse(call[1]?.body as string);
    expect(body.name).toBe("New Org Name");
    expect(body.slug).toBe("new-org-name");

    vi.restoreAllMocks();
  });

  it("name validation shows error for too-short name", async () => {
    const user = userEvent.setup();
    render(<SettingsFormTest initialName="" initialSlug="" />);

    const nameInput = screen.getByLabelText("Organization name");
    await user.type(nameInput, "A");
    await user.tab();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Name must be at least 2 characters");
    });
  });

  it("slug validation shows error for invalid slug", async () => {
    const user = userEvent.setup();
    render(<SettingsFormTest initialName="Test" initialSlug="" />);

    const slugInput = screen.getByLabelText("URL slug");
    await user.type(slugInput, "AB");
    await user.tab();

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      const slugAlert = alerts.find(
        (el) => el.textContent.includes("lowercase") || el.textContent.includes("Slug"),
      );
      expect(slugAlert).toBeDefined();
    });
  });
});
