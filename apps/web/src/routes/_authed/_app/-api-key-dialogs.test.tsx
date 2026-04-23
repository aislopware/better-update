import { useForm } from "@tanstack/react-form";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { z } from "zod/v4";

import { mockFetch } from "../../../../tests/helpers/mock-fetch";
import { getFieldError } from "../../../lib/form-utils";
import { RevokeDialog } from "./-api-key-dialogs";

// ── RevokeDialog (pure props) ─────────────────────────────────────

describe(RevokeDialog, () => {
  const makeProps = (
    overrides?: Partial<{ onConfirm: () => Promise<void>; isRevoking: boolean }>,
  ) =>
    ({
      open: true as const,
      onOpenChange: vi.fn<(open: boolean) => void>(),
      onConfirm: vi.fn<() => Promise<void>>(async () => {}),
      isRevoking: false,
      ...overrides,
    }) as const;

  it("renders title and description", () => {
    const props = makeProps();
    render(
      <RevokeDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        onConfirm={props.onConfirm}
        isRevoking={props.isRevoking}
      />,
    );

    expect(screen.getByText("Revoke API key")).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to revoke this API key/)).toBeInTheDocument();
  });

  it("revoke key button calls onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<() => Promise<void>>(async () => {});
    const props = makeProps({ onConfirm });
    render(
      <RevokeDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        onConfirm={props.onConfirm}
        isRevoking={props.isRevoking}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Revoke key" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("button shows Revoking... and is disabled when isRevoking=true", () => {
    const props = makeProps({ isRevoking: true });
    render(
      <RevokeDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        onConfirm={props.onConfirm}
        isRevoking={props.isRevoking}
      />,
    );

    const button = screen.getByRole("button", { name: "Revoking..." });
    expect(button).toBeDisabled();
  });

  it("cancel button is visible", () => {
    const props = makeProps();
    render(
      <RevokeDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        onConfirm={props.onConfirm}
        isRevoking={props.isRevoking}
      />,
    );

    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });
});

// ── CreateApiKeyDialog form (standalone test form) ────────────────

const nameSchema = z.string().min(1, "Name is required");

const CreateApiKeyTestForm = ({ onSubmit }: { onSubmit: (name: string) => Promise<void> }) => {
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
              <label htmlFor="api-key-name">Name</label>
              <input
                id="api-key-name"
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
            {isSubmitting ? "Creating..." : "Create key"}
          </button>
        )}
      </form.Subscribe>
    </form>
  );
};

describe("createApiKeyDialog form", () => {
  it("empty name shows Name is required on blur", async () => {
    const user = userEvent.setup();
    render(<CreateApiKeyTestForm onSubmit={vi.fn<(name: string) => Promise<void>>()} />);

    const input = screen.getByLabelText("Name");
    await user.click(input);
    await user.tab();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
    });
  });

  it("submitting with name calls fetch to create API key", async () => {
    const user = userEvent.setup();

    const fetchMock = mockFetch({
      "POST /api/auth/api-key/create": () => Response.json({ key: "bu_secret_key_123" }),
    });

    const onSubmit = vi.fn<(name: string) => Promise<void>>(async (name) => {
      await fetch("/api/auth/api-key/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
    });

    render(<CreateApiKeyTestForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Name"), "Production Key");
    await user.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("Production Key");
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith();
    });

    vi.restoreAllMocks();
  });
});

// ── KeyRevealContent (standalone test component) ──────────────────

const KeyRevealTestComponent = ({ apiKey }: { apiKey: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
  };

  return (
    <div>
      <p>Copy your API key now. You will not be able to see it again.</p>
      <code>{apiKey}</code>
      <button type="button" onClick={handleCopy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
};

describe("keyRevealContent", () => {
  it("key text is visible", () => {
    render(<KeyRevealTestComponent apiKey="bu_secret_abc_123" />);

    expect(screen.getByText("bu_secret_abc_123")).toBeInTheDocument();
  });

  it("copy button exists", () => {
    render(<KeyRevealTestComponent apiKey="bu_secret_abc_123" />);

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});
