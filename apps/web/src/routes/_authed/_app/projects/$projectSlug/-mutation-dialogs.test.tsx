import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { BuildWithArtifact, Channel, Update } from "@better-update/api";
import type { BranchItem } from "@better-update/api-client/react";

import { renderWithQuery } from "../../../../../../tests/helpers/render-with-query";
import { CreateChannelDialog } from "./-create-channel-dialog";
import { DeleteBranchDialog } from "./-delete-branch-dialog";
import { DeleteBuildDialog } from "./-delete-build-dialog";
import { DeleteChannelDialog } from "./-delete-channel-dialog";
import { PromoteUpdateDialog } from "./-promote-update-dialog";
import { RollbackToEmbeddedDialog } from "./-rollback-to-embedded-dialog";

const { apiReactModule, selectModule, sonnerModule, apiReactMocks, toastMocks } = vi.hoisted(
  () => ({
    apiReactModule: "@better-update/api-client/react",
    selectModule: "@better-update/ui/components/ui/select",
    sonnerModule: "sonner",
    apiReactMocks: {
      createUpdate:
        vi.fn<
          (body: {
            branch: string;
            project: string;
            runtimeVersion: string;
            platform: "ios" | "android";
            message: string;
            groupId: string;
            metadata: Record<string, unknown>;
            assets: never[];
            isRollback: true;
            directiveBody: string;
          }) => Promise<void>
        >(),
      createChannel:
        vi.fn<(body: { projectId: string; name: string; branchId: string }) => Promise<void>>(),
      deleteBranch: vi.fn<(id: string) => Promise<void>>(),
      deleteBuild: vi.fn<(id: string) => Promise<void>>(),
      deleteChannel: vi.fn<(id: string) => Promise<void>>(),
      republishUpdate:
        vi.fn<(body: { sourceUpdateId: string; destinationChannel: string }) => Promise<void>>(),
    },
    toastMocks: {
      success: vi.fn<(message: string) => void>(),
      error: vi.fn<(message: string) => void>(),
    },
  }),
);

vi.mock(sonnerModule, () => ({
  toast: toastMocks,
}));

vi.mock(selectModule, async () => {
  const React = await import("react");

  const SelectContext = React.createContext<((value: string) => void) | null>(null);

  return {
    Select: ({
      onValueChange,
      children,
    }: {
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <SelectContext.Provider value={onValueChange ?? null}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const onValueChange = React.useContext(SelectContext);

      return (
        <button
          type="button"
          onClick={() => {
            onValueChange?.(value);
          }}
        >
          {children}
        </button>
      );
    },
  };
});

vi.mock(apiReactModule, async (importOriginal) => {
  const actual = await importOriginal();
  const actualModule = typeof actual === "object" && actual !== null ? actual : {};

  return {
    ...actualModule,
    createUpdate: apiReactMocks.createUpdate,
    createChannel: apiReactMocks.createChannel,
    deleteBranch: apiReactMocks.deleteBranch,
    deleteBuild: apiReactMocks.deleteBuild,
    deleteChannel: apiReactMocks.deleteChannel,
    republishUpdate: apiReactMocks.republishUpdate,
  };
});

const orgId = "org-1";
const projectId = "proj-1";
const slug = "updates-test";

const branch = {
  id: "branch-main",
  projectId,
  name: "main",
  createdAt: "2026-01-01T00:00:00Z",
} satisfies BranchItem;

const build = {
  id: "build-1",
  projectId,
  platform: "ios",
  profile: "production",
  distribution: "development",
  runtimeVersion: "1.0.0",
  appVersion: "1.0.0",
  buildNumber: "42",
  bundleId: "com.example.app",
  gitRef: null,
  gitCommit: null,
  message: "Release build",
  metadataJson: "{}",
  createdAt: "2026-01-01T00:00:00Z",
  artifact: null,
} satisfies typeof BuildWithArtifact.Type;

const channel = {
  id: "channel-production",
  projectId,
  name: "production",
  branchId: "branch-main",
  branchMappingJson: null,
  cacheVersion: 0,
  isPaused: false,
  createdAt: "2026-01-01T00:00:00Z",
} satisfies typeof Channel.Type;

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
  createdAt: "2026-01-02T00:00:00Z",
} satisfies typeof Update.Type;

const expectInvalidation = async (
  invalidateSpy: ReturnType<typeof vi.spyOn>,
  queryKeys: readonly (readonly unknown[])[],
) => {
  await waitFor(() => {
    queryKeys.forEach((queryKey) => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
    });
  });
};

const confirmDeletion = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole("button"));

  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByPlaceholderText(name), name);
  await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
};

describe("mutation dialogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiReactMocks.createUpdate.mockResolvedValue(undefined);
    apiReactMocks.createChannel.mockResolvedValue(undefined);
    apiReactMocks.deleteBranch.mockResolvedValue(undefined);
    apiReactMocks.deleteBuild.mockResolvedValue(undefined);
    apiReactMocks.deleteChannel.mockResolvedValue(undefined);
    apiReactMocks.republishUpdate.mockResolvedValue(undefined);
  });

  it("createChannelDialog invalidates channels and compatibility matrix after creation", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithQuery(
      <CreateChannelDialog orgId={orgId} projectId={projectId} />,
      {
        seedCache: [
          [
            ["org", orgId, "projects", projectId, "branches"],
            { items: [branch], total: 1, page: 1, limit: 1000 },
          ],
        ],
      },
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.click(screen.getByRole("button", { name: "Create channel" }));

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "production");
    await user.click(within(dialog).getByRole("button", { name: "main" }));
    await user.click(within(dialog).getByRole("button", { name: "Create channel" }));

    await waitFor(() => {
      expect(apiReactMocks.createChannel).toHaveBeenCalledWith({
        projectId,
        name: "production",
        branchId: branch.id,
      });
    });

    await expectInvalidation(invalidateSpy, [
      ["org", orgId, "projects", projectId, "channels"],
      ["org", orgId, "projects", projectId, "build-compatibility-matrix"],
    ]);
  });

  it("deleteBranchDialog invalidates branches, channels, updates, and compatibility matrix", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithQuery(
      <DeleteBranchDialog branch={branch} orgId={orgId} projectId={projectId} />,
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await confirmDeletion(user, branch.name);

    await waitFor(() => {
      expect(apiReactMocks.deleteBranch).toHaveBeenCalledWith(branch.id);
    });

    await expectInvalidation(invalidateSpy, [
      ["org", orgId, "projects", projectId, "branches"],
      ["org", orgId, "projects", projectId, "channels"],
      ["org", orgId, "projects", projectId, "updates"],
      ["org", orgId, "projects", projectId, "build-compatibility-matrix"],
    ]);
  });

  it("deleteBuildDialog invalidates builds and compatibility matrix", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithQuery(
      <DeleteBuildDialog build={build} orgId={orgId} projectId={projectId} />,
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await confirmDeletion(user, "Release build");

    await waitFor(() => {
      expect(apiReactMocks.deleteBuild).toHaveBeenCalledWith(build.id);
    });

    await expectInvalidation(invalidateSpy, [
      ["org", orgId, "projects", projectId, "builds"],
      ["org", orgId, "projects", projectId, "build-compatibility-matrix"],
    ]);
  });

  it("deleteChannelDialog invalidates channels and compatibility matrix", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithQuery(
      <DeleteChannelDialog channel={channel} orgId={orgId} projectId={projectId} />,
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await confirmDeletion(user, channel.name);

    await waitFor(() => {
      expect(apiReactMocks.deleteChannel).toHaveBeenCalledWith(channel.id);
    });

    await expectInvalidation(invalidateSpy, [
      ["org", orgId, "projects", projectId, "channels"],
      ["org", orgId, "projects", projectId, "build-compatibility-matrix"],
    ]);
  });

  it("promoteUpdateDialog invalidates updates and compatibility matrix after republish", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const { queryClient } = renderWithQuery(
      <PromoteUpdateDialog
        update={update}
        channels={[channel]}
        orgId={orgId}
        projectId={projectId}
        open
        onOpenChange={onOpenChange}
      />,
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.click(screen.getByRole("button", { name: "production" }));
    await user.click(screen.getByRole("button", { name: "Promote" }));

    await waitFor(() => {
      expect(apiReactMocks.republishUpdate).toHaveBeenCalledWith({
        sourceUpdateId: update.id,
        destinationChannel: channel.name,
      });
    });

    await expectInvalidation(invalidateSpy, [
      ["org", orgId, "projects", projectId, "updates"],
      ["org", orgId, "projects", projectId, "build-compatibility-matrix"],
    ]);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("rollbackToEmbeddedDialog invalidates updates and compatibility matrix after create", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const { queryClient } = renderWithQuery(
      <RollbackToEmbeddedDialog
        update={update}
        branchName="main"
        slug={slug}
        orgId={orgId}
        projectId={projectId}
        open
        onOpenChange={onOpenChange}
      />,
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.click(screen.getByRole("button", { name: "Create rollback" }));

    await waitFor(() => {
      expect(apiReactMocks.createUpdate).toHaveBeenCalledTimes(1);
    });

    const payload = apiReactMocks.createUpdate.mock.calls[0]?.[0];
    expect(payload).toStrictEqual(
      expect.objectContaining({
        branch: "main",
        slug,
        runtimeVersion: update.runtimeVersion,
        platform: update.platform,
        message: "Rollback to embedded",
        metadata: {},
        assets: [],
        isRollback: true,
        groupId: expect.any(String),
        directiveBody: expect.any(String),
      }),
    );
    expect(JSON.parse(payload?.directiveBody ?? "")).toStrictEqual({
      type: "rollBackToEmbedded",
      parameters: {
        commitTime: expect.any(String),
      },
    });

    await expectInvalidation(invalidateSpy, [
      ["org", orgId, "projects", projectId, "updates"],
      ["org", orgId, "projects", projectId, "build-compatibility-matrix"],
    ]);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
