import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { useForm } from "@tanstack/react-form";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { z } from "zod/v4";

import { mockFetch } from "../../../../tests/helpers/mock-fetch";
import { getFieldError } from "../../../lib/form-utils";
import { CreateApiKeyDialog, RevokeDialog } from "./-api-key-dialogs";

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
          const invalid = Boolean(errorMessage);
          return (
            <Field invalid={invalid}>
              <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
              <Input
                id="api-key-name"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
              <FieldError match={invalid}>{errorMessage}</FieldError>
            </Field>
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
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
  });

  it("submitting empty form (no prior blur) shows the inline error via FieldError", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(name: string) => Promise<void>>();
    render(<CreateApiKeyTestForm onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
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
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/api-key/create",
        expect.objectContaining({ method: "POST" }),
      );
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

// ── CreateApiKeyDialog (full integration) ─────────────────────────

interface CreateResponse {
  data: { key: string } | null;
  error: { message: string } | null;
}

const { authClientModule, authClientMocks } = vi.hoisted(() => ({
  authClientModule: "../../../lib/auth-client",
  authClientMocks: {
    create: vi.fn<(input: { name: string; organizationId: string }) => Promise<CreateResponse>>(),
  },
}));

vi.mock(authClientModule, () => ({
  authClient: {
    apiKey: {
      create: authClientMocks.create,
    },
  },
  rejectOnAuthClientError: vi.fn<() => Promise<unknown>>(),
}));

const CreateDialogHarness = ({ initialOpen = true }: { initialOpen?: boolean }) => {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button
        type="button"
        data-testid="reopen-trigger"
        onClick={() => {
          setOpen(true);
        }}
      >
        Reopen
      </button>
      <CreateApiKeyDialog orgId="org-1" open={open} onOpenChange={setOpen} />
    </>
  );
};

const renderCreateDialog = ({ initialOpen = true }: { initialOpen?: boolean } = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const result = render(
    <QueryClientProvider client={queryClient}>
      <CreateDialogHarness initialOpen={initialOpen} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient, invalidateSpy };
};

describe(CreateApiKeyDialog, () => {
  beforeEach(() => {
    authClientMocks.create.mockReset();
  });

  it("submit shows reveal and invalidates the api-keys query", async () => {
    authClientMocks.create.mockResolvedValue({ data: { key: "bu_test_abc" }, error: null });
    const user = userEvent.setup();
    const { invalidateSpy } = renderCreateDialog();

    await user.type(screen.getByLabelText("Name"), "My Key");
    await user.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => {
      expect(screen.getByText("bu_test_abc")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["org", "org-1", "api-keys"] }),
    );
  });

  it("clicking Done closes the reveal", async () => {
    authClientMocks.create.mockResolvedValue({ data: { key: "bu_test_xyz" }, error: null });
    const user = userEvent.setup();
    renderCreateDialog();

    await user.type(screen.getByLabelText("Name"), "Key");
    await user.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => {
      expect(screen.getByText("bu_test_xyz")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.queryByText("bu_test_xyz")).not.toBeInTheDocument();
    });
  });

  it("closing during in-flight submit invalidates but skips reveal on reopen", async () => {
    let resolveCreate: (value: CreateResponse) => void = () => {};
    authClientMocks.create.mockImplementation(
      async () =>
        new Promise<CreateResponse>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const user = userEvent.setup();
    const { invalidateSpy } = renderCreateDialog();

    await user.type(screen.getByLabelText("Name"), "RaceKey");
    await user.click(screen.getByRole("button", { name: "Create key" }));

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    resolveCreate({ data: { key: "bu_late_key" }, error: null });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["org", "org-1", "api-keys"] }),
      );
    });

    await user.click(screen.getByTestId("reopen-trigger"));

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toBeInTheDocument();
    });
    expect(screen.queryByText("bu_late_key")).not.toBeInTheDocument();
  });
});
