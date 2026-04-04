import { useForm } from "@tanstack/react-form";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";

import { generateScopeKey, generateSlug } from "../../lib/form-utils";

/**
 * These tests verify the derived-state wiring pattern used in org and project
 * forms: typing a name field auto-fills a secondary field (slug or scopeKey).
 *
 * Each TestForm replicates the real component's onChange logic so the pattern
 * itself is covered without needing provider mocks.
 *
 * The pattern uses a ref to track manual edits. Programmatic setFieldValue
 * passes { dontUpdateMeta: true, dontValidate: true } to prevent TanStack
 * Form from marking the derived field as touched.
 */

// ── Onboarding pattern: name → slug (ref guard) ────────────────

const OnboardingTestForm = () => {
  const slugEdited = useRef(false);
  const form = useForm({
    defaultValues: { name: "", slug: "" },
    onSubmit: async () => {},
  });

  return (
    <form>
      <form.Field name="name">
        {(field) => (
          <div>
            <label htmlFor="ob-name">Organization name</label>
            <input
              id="ob-name"
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
            />
          </div>
        )}
      </form.Field>
      <form.Field name="slug">
        {(field) => (
          <div>
            <label htmlFor="ob-slug">URL slug</label>
            <input
              id="ob-slug"
              value={field.state.value}
              onChange={(event) => {
                field.handleChange(event.target.value);
                slugEdited.current = event.target.value !== "";
              }}
              onBlur={field.handleBlur}
            />
          </div>
        )}
      </form.Field>
    </form>
  );
};

// ── Settings pattern: name → slug (ref guard, pre-filled) ──────

const SettingsTestForm = () => {
  const slugEdited = useRef(false);
  const form = useForm({
    defaultValues: { name: "Existing Org", slug: "existing-org" },
    onSubmit: async () => {},
  });

  return (
    <form>
      <form.Field name="name">
        {(field) => (
          <div>
            <label htmlFor="st-name">Organization name</label>
            <input
              id="st-name"
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
            />
          </div>
        )}
      </form.Field>
      <form.Field name="slug">
        {(field) => (
          <div>
            <label htmlFor="st-slug">URL slug</label>
            <input
              id="st-slug"
              value={field.state.value}
              onChange={(event) => {
                field.handleChange(event.target.value);
                slugEdited.current = event.target.value !== "";
              }}
              onBlur={field.handleBlur}
            />
          </div>
        )}
      </form.Field>
    </form>
  );
};

// ── Create project pattern: name → scopeKey (ref guard) ────────

const CreateProjectTestForm = () => {
  const scopeKeyEdited = useRef(false);
  const form = useForm({
    defaultValues: { name: "", scopeKey: "" },
    onSubmit: async () => {},
  });

  return (
    <form>
      <form.Field name="name">
        {(field) => (
          <div>
            <label htmlFor="cp-name">Project name</label>
            <input
              id="cp-name"
              value={field.state.value}
              onChange={(event) => {
                const name = event.target.value;
                field.handleChange(name);
                if (!scopeKeyEdited.current) {
                  form.setFieldValue("scopeKey", generateScopeKey(name), {
                    dontUpdateMeta: true,
                    dontValidate: true,
                  });
                }
              }}
            />
          </div>
        )}
      </form.Field>
      <form.Field name="scopeKey">
        {(field) => (
          <div>
            <label htmlFor="cp-scope">Scope key</label>
            <input
              id="cp-scope"
              value={field.state.value}
              onChange={(event) => {
                field.handleChange(event.target.value);
                scopeKeyEdited.current = event.target.value !== "";
              }}
            />
          </div>
        )}
      </form.Field>
    </form>
  );
};

// ── Tests ───────────────────────────────────────────────────────

describe("onboarding: name to slug sync", () => {
  test("typing name auto-generates slug", async () => {
    const user = userEvent.setup();
    render(<OnboardingTestForm />);

    await user.type(screen.getByLabelText("Organization name"), "Acme Inc.");

    expect(screen.getByLabelText<HTMLInputElement>("URL slug").value).toBe("acme-inc");
  });

  test("manually editing slug stops auto-generation", async () => {
    const user = userEvent.setup();
    render(<OnboardingTestForm />);

    // Type name first
    await user.type(screen.getByLabelText("Organization name"), "Acme");
    expect(screen.getByLabelText<HTMLInputElement>("URL slug").value).toBe("acme");

    // Manually edit slug
    const slugInput = screen.getByLabelText("URL slug");
    await user.clear(slugInput);
    await user.type(slugInput, "custom-slug");

    // Change name again — slug should NOT change
    const nameInput = screen.getByLabelText("Organization name");
    await user.clear(nameInput);
    await user.type(nameInput, "New Name");

    expect(screen.getByLabelText<HTMLInputElement>("URL slug").value).toBe("custom-slug");
  });

  test("clearing slug re-enables auto-generation", async () => {
    const user = userEvent.setup();
    render(<OnboardingTestForm />);

    // Type name
    await user.type(screen.getByLabelText("Organization name"), "Acme");

    // Manually edit slug then clear it
    const slugInput = screen.getByLabelText("URL slug");
    await user.type(slugInput, "x");
    await user.clear(slugInput);

    // Type new name — slug should auto-fill again
    const nameInput = screen.getByLabelText("Organization name");
    await user.clear(nameInput);
    await user.type(nameInput, "Beta Corp");

    expect(screen.getByLabelText<HTMLInputElement>("URL slug").value).toBe("beta-corp");
  });
});

describe("settings: name to slug sync", () => {
  test("typing name auto-generates slug when slug untouched", async () => {
    const user = userEvent.setup();
    render(<SettingsTestForm />);

    const nameInput = screen.getByLabelText("Organization name");
    await user.clear(nameInput);
    await user.type(nameInput, "New Org Name");

    expect(screen.getByLabelText<HTMLInputElement>("URL slug").value).toBe("new-org-name");
  });

  test("manually editing slug stops auto-generation", async () => {
    const user = userEvent.setup();
    render(<SettingsTestForm />);

    // Manually edit slug
    const slugInput = screen.getByLabelText("URL slug");
    await user.clear(slugInput);
    await user.type(slugInput, "my-custom-slug");

    // Change name — slug should NOT change
    const nameInput = screen.getByLabelText("Organization name");
    await user.clear(nameInput);
    await user.type(nameInput, "Something Else");

    expect(screen.getByLabelText<HTMLInputElement>("URL slug").value).toBe("my-custom-slug");
  });

  test("clearing slug re-enables auto-generation", async () => {
    const user = userEvent.setup();
    render(<SettingsTestForm />);

    // Type in slug then clear it
    const slugInput = screen.getByLabelText("URL slug");
    await user.type(slugInput, "x");
    await user.clear(slugInput);

    // Type new name
    const nameInput = screen.getByLabelText("Organization name");
    await user.clear(nameInput);
    await user.type(nameInput, "Fresh Org");

    expect(screen.getByLabelText<HTMLInputElement>("URL slug").value).toBe("fresh-org");
  });
});

describe("create project: name to scopeKey sync", () => {
  test("typing name auto-generates scope key", async () => {
    const user = userEvent.setup();
    render(<CreateProjectTestForm />);

    await user.type(screen.getByLabelText("Project name"), "My App");

    expect(screen.getByLabelText<HTMLInputElement>("Scope key").value).toBe("@my-app/app");
  });

  test("manually editing scopeKey stops auto-generation", async () => {
    const user = userEvent.setup();
    render(<CreateProjectTestForm />);

    // Type in scopeKey first
    await user.type(screen.getByLabelText("Scope key"), "@custom/pkg");

    // Type name — scopeKey should NOT change
    await user.type(screen.getByLabelText("Project name"), "New App");

    expect(screen.getByLabelText<HTMLInputElement>("Scope key").value).toBe("@custom/pkg");
  });

  test("clearing scopeKey re-enables auto-generation", async () => {
    const user = userEvent.setup();
    render(<CreateProjectTestForm />);

    // Type scopeKey then clear it
    const scopeInput = screen.getByLabelText("Scope key");
    await user.type(scopeInput, "@temp/pkg");
    await user.clear(scopeInput);

    // Type name — scopeKey should auto-fill
    await user.type(screen.getByLabelText("Project name"), "Fresh App");

    expect(screen.getByLabelText<HTMLInputElement>("Scope key").value).toBe("@fresh-app/app");
  });
});
