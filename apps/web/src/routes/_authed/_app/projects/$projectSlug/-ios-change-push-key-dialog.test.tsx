import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ApplePushKeyItem, AppleTeamItem } from "@better-update/api-client/react";

import { renderWithQuery } from "../../../../../../tests/helpers/render-with-query";
import { IosChangePushKeyDialog } from "./-ios-change-push-key-dialog";

const { apiReactModule, toastModule, apiReactMocks, toastMocks } = vi.hoisted(() => ({
  apiReactModule: "@better-update/api-client/react",
  toastModule: "@better-update/ui/components/ui/toast",
  apiReactMocks: {
    uploadApplePushKey: vi.fn<
      (body: { keyId: string; p8Pem: string; appleTeamIdentifier: string }) => Promise<{
        id: string;
      }>
    >(),
    updateIosBundleConfiguration:
      vi.fn<(id: string, body: { applePushKeyId: string }) => Promise<void>>(),
  },
  toastMocks: {
    add: vi.fn<(args: { title: string; type?: string }) => void>(),
  },
}));

vi.mock(toastModule, () => ({
  toastManager: toastMocks,
}));

vi.mock(apiReactModule, async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    uploadApplePushKey: apiReactMocks.uploadApplePushKey,
    updateIosBundleConfiguration: apiReactMocks.updateIosBundleConfiguration,
  };
});

const orgId = "org-1";
const projectId = "proj-1";
const appleTeamId = "apple-team-1";
const teamIdentifier = "ABCDE12345";

const team = {
  id: appleTeamId,
  organizationId: orgId,
  appleTeamId: teamIdentifier,
  appleTeamType: "COMPANY_ORGANIZATION",
  name: "Acme Inc.",
  distributionCertificateCount: 0,
  pushKeyCount: 1,
  ascApiKeyCount: 0,
  provisioningProfileCount: 0,
  deviceCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} satisfies AppleTeamItem;

const savedKey = {
  id: "push-key-1",
  organizationId: orgId,
  keyId: "ZYXWV98765",
  appleTeamId,
  createdAt: "2026-01-02T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
} satisfies ApplePushKeyItem;

const seedCacheEntries: [readonly unknown[], unknown][] = [
  [["org", orgId, "apple-push-keys"], { items: [savedKey] }],
  [["org", orgId, "apple-teams"], { items: [team] }],
];

const renderDialog = (overrides?: { onOpenChange?: (next: boolean) => void }) =>
  renderWithQuery(
    <IosChangePushKeyDialog
      open
      onOpenChange={overrides?.onOpenChange ?? vi.fn<(next: boolean) => void>()}
      orgId={orgId}
      projectId={projectId}
      configIds={["config-1"]}
      appleTeamId={appleTeamId}
      currentKey={null}
    />,
    { seedCache: seedCacheEntries },
  );

describe(IosChangePushKeyDialog, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiReactMocks.uploadApplePushKey.mockResolvedValue({ id: "uploaded-key" });
    apiReactMocks.updateIosBundleConfiguration.mockResolvedValue(undefined);
  });

  it("renders saved push keys for the current Apple Team by default", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(savedKey.keyId)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("enables Save once a saved key is selected and persists the binding", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn<(next: boolean) => void>();
    renderDialog({ onOpenChange });

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText(savedKey.keyId));

    const saveButton = within(dialog).getByRole("button", { name: "Save" });
    await waitFor(() => {
      expect(saveButton).toBeEnabled();
    });
    await user.click(saveButton);

    await waitFor(() => {
      expect(apiReactMocks.updateIosBundleConfiguration).toHaveBeenCalledWith("config-1", {
        applePushKeyId: savedKey.id,
      });
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(apiReactMocks.uploadApplePushKey).not.toHaveBeenCalled();
    expect(toastMocks.add).toHaveBeenCalledWith({
      title: "Push key updated",
      type: "success",
    });
  });

  it("uploads a new key when Upload-new tab submits a valid form", async () => {
    const user = userEvent.setup();
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("tab", { name: "Upload new" }));

    const saveButton = within(dialog).getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Key ID"), "NEWKEY1234");
    await user.type(within(dialog).getByLabelText("Apple Team ID"), teamIdentifier);

    const file = new File(
      ["-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----"],
      "AuthKey.p8",
      { type: "text/plain" },
    );
    const fileInput = within(dialog).getByLabelText(".p8 file", {
      selector: 'input[type="file"]',
    });
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(saveButton).toBeEnabled();
    });

    await user.click(saveButton);

    await waitFor(() => {
      expect(apiReactMocks.uploadApplePushKey).toHaveBeenCalledWith({
        keyId: "NEWKEY1234",
        p8Pem: expect.stringContaining("BEGIN PRIVATE KEY"),
        appleTeamIdentifier: teamIdentifier,
      });
    });
    expect(apiReactMocks.updateIosBundleConfiguration).toHaveBeenCalledWith("config-1", {
      applePushKeyId: "uploaded-key",
    });
  });
});
