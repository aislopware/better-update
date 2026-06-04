import { useForm } from "@tanstack/react-form";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod/v4";

import { mockFetch } from "../../../../tests/helpers/mock-fetch";
import { getFieldError } from "../../../lib/form-utils";
import { RemoveDialog } from "./-invite-dialog";

/**
 * Tests for the invite dialog components.
 * InviteDialog now invites via the IAM-gated api-client helper `createInvitation`
 * (POST /api/invitations), not the better-auth organization plugin route.
 * RemoveDialog is a pure props confirmation dialog.
 */

// ── RemoveDialog (pure props) ─────────────────────────────────────

describe(RemoveDialog, () => {
  const makeProps = (
    overrides?: Partial<{ onConfirm: () => Promise<void>; isRemoving: boolean }>,
  ) =>
    ({
      open: true as const,
      onOpenChange: vi.fn<(open: boolean) => void>(),
      onConfirm: vi.fn<() => Promise<void>>(async () => {}),
      isRemoving: false,
      ...overrides,
    }) as const;

  it("renders title and description", () => {
    const props = makeProps();
    render(
      <RemoveDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        onConfirm={props.onConfirm}
        isRemoving={props.isRemoving}
      />,
    );

    expect(screen.getByText("Remove member")).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to remove this member/)).toBeInTheDocument();
  });

  it("remove button calls onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<() => Promise<void>>(async () => {});
    const props = makeProps({ onConfirm });
    render(
      <RemoveDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        onConfirm={props.onConfirm}
        isRemoving={props.isRemoving}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("remove button is disabled when isRemoving=true", () => {
    const props = makeProps({ isRemoving: true });
    render(
      <RemoveDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        onConfirm={props.onConfirm}
        isRemoving={props.isRemoving}
      />,
    );

    const button = screen.getByRole("button", { name: /Remove/ });
    expect(button).toBeDisabled();
  });

  it("cancel button is visible", () => {
    const props = makeProps();
    render(
      <RemoveDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        onConfirm={props.onConfirm}
        isRemoving={props.isRemoving}
      />,
    );

    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });
});

// ── InviteFormContent (standalone test form) ──────────────────────

const emailSchema = z.string().check(z.email("Please enter a valid email"));

const InviteTestForm = ({ onSubmit }: { onSubmit: (email: string) => Promise<void> }) => {
  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      await onSubmit(value.email);
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
            const result = emailSchema.safeParse(value);
            return result.success ? undefined : result.error.issues[0]?.message;
          },
        }}
      >
        {(field) => {
          const errorMessage = getFieldError(field);
          return (
            <div>
              <label htmlFor="invite-email">Email address</label>
              <input
                id="invite-email"
                type="email"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
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
            {isSubmitting ? "Sending..." : "Send invitation"}
          </button>
        )}
      </form.Subscribe>
    </form>
  );
};

describe("invite form", () => {
  it("empty email shows validation error on blur", async () => {
    const user = userEvent.setup();
    render(<InviteTestForm onSubmit={vi.fn<(email: string) => Promise<void>>()} />);

    const emailInput = screen.getByLabelText("Email address");
    await user.click(emailInput);
    await user.tab();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Please enter a valid email");
    });
  });

  it("invalid email shows validation error on blur", async () => {
    const user = userEvent.setup();
    render(<InviteTestForm onSubmit={vi.fn<(email: string) => Promise<void>>()} />);

    await user.type(screen.getByLabelText("Email address"), "not-an-email");
    await user.tab();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Please enter a valid email");
    });
  });

  // Invites are member-ONLY in the unified IAM model: the dialog sends `{ email }`
  // with no role (admin-ness comes from policy attachments post-accept).
  it("submitting with valid email calls invite endpoint with email only", async () => {
    const user = userEvent.setup();

    const fetchMock = mockFetch({
      "POST /api/invitations": () => Response.json({ id: "inv-1" }),
    });

    const onSubmit = vi.fn<(email: string) => Promise<void>>(async (email) => {
      await fetch("/api/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
    });

    render(<InviteTestForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Email address"), "new@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("new@example.com");
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/invitations",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const call = fetchMock.mock.calls[0]!;
    const body = JSON.parse(call[1]?.body as string);
    expect(body.email).toBe("new@example.com");
    expect(body.role).toBeUndefined();

    vi.restoreAllMocks();
  });
});
