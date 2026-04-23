import { useForm } from "@tanstack/react-form";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { getFieldError, nameSchema } from "../../../../../lib/form-utils";

// -- CreateBranchTestForm ---------------------------------------------------

const CreateBranchTestForm = ({ onSubmit }: { onSubmit: (name: string) => Promise<void> }) => {
  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      await onSubmit(value.name);
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
              <label htmlFor="branch-name">Branch name</label>
              <input
                id="branch-name"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
              {errorMessage ? <p role="alert">{errorMessage}</p> : null}
            </div>
          );
        }}
      </form.Field>
      <button type="submit">Create branch</button>
    </form>
  );
};

// -- RenameBranchTestForm ---------------------------------------------------

const RenameBranchTestForm = ({ onSubmit }: { onSubmit: (name: string) => Promise<void> }) => {
  const form = useForm({
    defaultValues: { name: "main" },
    onSubmit: async ({ value }) => {
      await onSubmit(value.name);
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
              <label htmlFor="branch-name">Branch name</label>
              <input
                id="branch-name"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
              {errorMessage ? <p role="alert">{errorMessage}</p> : null}
            </div>
          );
        }}
      </form.Field>
      <button type="submit">Rename</button>
    </form>
  );
};

// -- Tests ------------------------------------------------------------------

describe("create branch form", () => {
  it("shows validation error when name is empty on blur", async () => {
    const user = userEvent.setup();
    render(<CreateBranchTestForm onSubmit={vi.fn<(name: string) => Promise<void>>()} />);

    const input = screen.getByLabelText("Branch name");
    await user.click(input);
    await user.tab();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Name must be at least 2 characters");
    });
  });

  it("calls onSubmit with branch name", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(name: string) => Promise<void>>(async () => {});

    render(<CreateBranchTestForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Branch name"), "production");
    await user.click(screen.getByRole("button", { name: "Create branch" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("production");
    });
  });
});

describe("rename branch form", () => {
  it("pre-populates with current branch name", () => {
    render(<RenameBranchTestForm onSubmit={vi.fn<(name: string) => Promise<void>>()} />);

    expect(screen.getByLabelText("Branch name")).toHaveValue("main");
  });
});
