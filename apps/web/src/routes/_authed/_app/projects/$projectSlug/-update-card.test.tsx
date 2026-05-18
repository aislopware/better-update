import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Channel, Update } from "@better-update/api";

import { renderWithQuery } from "../../../../../../tests/helpers/render-with-query";
import { UpdateCard } from "./-update-card";

const {
  apiReactModule,
  promoteUpdateDialogModule,
  republishUpdateDialogModule,
  rollbackDialogModule,
  toastModule,
  apiReactMocks,
  toastMocks,
} = vi.hoisted(() => ({
  apiReactModule: "@better-update/api-client/react",
  promoteUpdateDialogModule: "./-promote-update-dialog",
  republishUpdateDialogModule: "./-republish-update-dialog",
  rollbackDialogModule: "./-rollback-to-embedded-dialog",
  toastModule: "@better-update/ui/components/ui/toast",
  apiReactMocks: {
    deleteUpdateGroup: vi.fn<(groupId: string) => Promise<void>>(),
    editUpdateRollout: vi.fn<(id: string, body: { percentage: number }) => Promise<void>>(),
    completeUpdateRollout: vi.fn<(id: string) => Promise<void>>(),
    revertUpdateRollout: vi.fn<(id: string) => Promise<void>>(),
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
    deleteUpdateGroup: apiReactMocks.deleteUpdateGroup,
    editUpdateRollout: apiReactMocks.editUpdateRollout,
    completeUpdateRollout: apiReactMocks.completeUpdateRollout,
    revertUpdateRollout: apiReactMocks.revertUpdateRollout,
  };
});

vi.mock(promoteUpdateDialogModule, () => ({
  PromoteUpdateDialog: ({ open }: { open: boolean }) => (
    <div>{open ? "Promote dialog open" : "Promote dialog closed"}</div>
  ),
}));

vi.mock(republishUpdateDialogModule, () => ({
  RepublishUpdateDialog: ({ open }: { open: boolean }) => (
    <div>{open ? "Republish dialog open" : "Republish dialog closed"}</div>
  ),
}));

vi.mock(rollbackDialogModule, () => ({
  RollbackToEmbeddedDialog: ({ open }: { open: boolean }) => (
    <div>{open ? "Rollback dialog open" : "Rollback dialog closed"}</div>
  ),
}));

const orgId = "org-1";
const projectId = "proj-1";
const slug = "updates-test";
const branchName = "main";

const update = {
  id: "update-1",
  branchId: "branch-main",
  runtimeVersion: "1.0.0",
  platform: "ios",
  message: "Release update",
  metadataJson: "{}",
  extraJson: null,
  groupId: "group-1",
  rolloutPercentage: 25,
  isRollback: false,
  signature: null,
  certificateChain: null,
  manifestBody: null,
  directiveBody: null,
  fingerprintHash: null,
  totalAssetSize: 0,
  createdAt: "2026-01-02T00:00:00Z",
} satisfies typeof Update.Type;

const channels = [
  {
    id: "channel-main",
    projectId,
    name: "main",
    branchId: "branch-main",
    branchMappingJson: null,
    cacheVersion: 0,
    isPaused: false,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "channel-release",
    projectId,
    name: "release",
    branchId: "branch-release",
    branchMappingJson: null,
    cacheVersion: 0,
    isPaused: false,
    createdAt: "2026-01-03T00:00:00Z",
  },
] satisfies readonly (typeof Channel.Type)[];

const expectUpdatesInvalidated = async (invalidateSpy: ReturnType<typeof vi.spyOn>) => {
  await waitFor(() => {
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["org", orgId, "projects", projectId, "updates"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["org", orgId, "projects", projectId, "build-compatibility-matrix"],
    });
  });
};

describe(UpdateCard, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiReactMocks.deleteUpdateGroup.mockResolvedValue(undefined);
    apiReactMocks.editUpdateRollout.mockResolvedValue(undefined);
    apiReactMocks.completeUpdateRollout.mockResolvedValue(undefined);
    apiReactMocks.revertUpdateRollout.mockResolvedValue(undefined);
  });

  it("deletes update groups and invalidates the compatibility matrix", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithQuery(
      <UpdateCard
        update={update}
        channels={channels}
        branchName={branchName}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />,
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.click(screen.getByRole("button", { name: "Delete update group" }));

    await waitFor(() => {
      expect(apiReactMocks.deleteUpdateGroup).toHaveBeenCalledWith(update.groupId);
    });

    await expectUpdatesInvalidated(invalidateSpy);
  });

  it("validates rollout input before sending the mutation", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <UpdateCard
        update={update}
        channels={channels}
        branchName={branchName}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />,
    );

    await user.clear(screen.getByRole("spinbutton"));
    await user.type(screen.getByRole("spinbutton"), "0");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(apiReactMocks.editUpdateRollout).not.toHaveBeenCalled();
    expect(toastMocks.add).toHaveBeenCalledWith({
      title: "Rollout percentage must be between 1 and 100",
      type: "error",
    });
  });

  it("edits rollout percentages and invalidates the compatibility matrix", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithQuery(
      <UpdateCard
        update={update}
        channels={channels}
        branchName={branchName}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />,
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.clear(screen.getByRole("spinbutton"));
    await user.type(screen.getByRole("spinbutton"), "50");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(apiReactMocks.editUpdateRollout).toHaveBeenCalledWith(update.id, {
        percentage: 50,
      });
    });

    await expectUpdatesInvalidated(invalidateSpy);
  });

  it.each([
    {
      name: "completes rollouts",
      buttonName: "Complete rollout (100%)",
      expectCall: () => expect(apiReactMocks.completeUpdateRollout).toHaveBeenCalledWith(update.id),
    },
    {
      name: "reverts rollouts",
      buttonName: "Revert rollout (0%)",
      expectCall: () => expect(apiReactMocks.revertUpdateRollout).toHaveBeenCalledWith(update.id),
    },
  ])("$name and invalidates the compatibility matrix", async ({ buttonName, expectCall }) => {
    const user = userEvent.setup();
    const { queryClient } = renderWithQuery(
      <UpdateCard
        update={update}
        channels={channels}
        branchName={branchName}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />,
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.click(screen.getByRole("button", { name: buttonName }));

    await waitFor(() => {
      expectCall();
    });

    await expectUpdatesInvalidated(invalidateSpy);
  });

  it("opens the promote dialog when a compatible target channel exists", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <UpdateCard
        update={update}
        channels={channels}
        branchName={branchName}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />,
    );

    expect(screen.getByText("Promote dialog closed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Promote to another channel" }));

    expect(screen.getByText("Promote dialog open")).toBeInTheDocument();
  });

  it("opens the rollback dialog when branch context is available", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <UpdateCard
        update={update}
        channels={channels}
        branchName={branchName}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />,
    );

    expect(screen.getByText("Rollback dialog closed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rollback to embedded" }));

    expect(screen.getByText("Rollback dialog open")).toBeInTheDocument();
  });

  it("opens the republish dialog when branch context is available", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <UpdateCard
        update={update}
        channels={channels}
        branchName={branchName}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />,
    );

    expect(screen.getByText("Republish dialog closed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Republish update" }));

    expect(screen.getByText("Republish dialog open")).toBeInTheDocument();
  });

  it("disables rollback/republish/promote buttons when the update itself is a rollback", () => {
    renderWithQuery(
      <UpdateCard
        update={{ ...update, isRollback: true }}
        channels={channels}
        branchName={branchName}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />,
    );

    expect(screen.getByRole("button", { name: "Rollback to embedded" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Republish update" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Promote to another channel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete update group" })).not.toBeDisabled();
  });

  it("disables follow-up actions when the update is signed", () => {
    renderWithQuery(
      <UpdateCard
        update={{ ...update, signature: "sig-1234" }}
        channels={channels}
        branchName={branchName}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />,
    );

    expect(screen.getByRole("button", { name: "Rollback to embedded" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Republish update" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Promote to another channel" })).toBeDisabled();
  });

  it("disables promote when there is no other channel to promote to", () => {
    renderWithQuery(
      <UpdateCard
        update={update}
        channels={channels.filter((channel) => channel.branchId === update.branchId)}
        branchName={branchName}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />,
    );

    expect(screen.getByRole("button", { name: "Promote to another channel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rollback to embedded" })).not.toBeDisabled();
  });

  it("disables rollback/republish when branch name is unavailable", () => {
    renderWithQuery(
      <UpdateCard
        update={update}
        channels={channels}
        branchName={undefined}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />,
    );

    expect(screen.getByRole("button", { name: "Rollback to embedded" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Republish update" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Promote to another channel" })).not.toBeDisabled();
  });

  it("disables Complete rollout when already at 100%", () => {
    renderWithQuery(
      <UpdateCard
        update={{ ...update, rolloutPercentage: 100 }}
        channels={channels}
        branchName={branchName}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />,
    );

    expect(screen.getByRole("button", { name: "Complete rollout (100%)" })).toBeDisabled();
  });

  it("disables Revert rollout when already at 0%", () => {
    renderWithQuery(
      <UpdateCard
        update={{ ...update, rolloutPercentage: 0 }}
        channels={channels}
        branchName={branchName}
        slug={slug}
        orgId={orgId}
        projectId={projectId}
      />,
    );

    expect(screen.getByRole("button", { name: "Revert rollout (0%)" })).toBeDisabled();
  });
});
