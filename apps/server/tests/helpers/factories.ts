import { Asset } from "../../src/domain/asset";
import { Branch } from "../../src/domain/branch";
import { Channel } from "../../src/domain/channel";
import { Project } from "../../src/domain/project";
import { Update } from "../../src/domain/update";

export const makeProject = (overrides?: Partial<typeof Project.Type>) =>
  new Project({
    id: "test-project-id",
    organizationId: "test-org-id",
    name: "Test Project",
    scopeKey: "@test/project",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

export const makeBranch = (overrides?: Partial<typeof Branch.Type>) =>
  new Branch({
    id: "test-branch-id",
    projectId: "test-project-id",
    name: "main",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

export const makeChannel = (overrides?: Partial<typeof Channel.Type>) =>
  new Channel({
    id: "test-channel-id",
    projectId: "test-project-id",
    name: "production",
    branchId: "test-branch-id",
    branchMappingJson: null,
    cacheVersion: 1,
    isPaused: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

export const makeUpdate = (overrides?: Partial<typeof Update.Type>) =>
  new Update({
    id: "test-update-id",
    branchId: "test-branch-id",
    runtimeVersion: "1.0.0",
    platform: "ios",
    message: "Test update",
    metadataJson: "{}",
    extraJson: null,
    groupId: "test-group-id",
    rolloutPercentage: 100,
    isRollback: false,
    signature: null,
    certificateChain: null,
    manifestBody: null,
    directiveBody: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

export const makeAsset = (overrides?: Partial<typeof Asset.Type>) =>
  new Asset({
    hash: "abc123",
    contentType: "application/javascript",
    fileExt: ".js",
    byteSize: 1024,
    r2Key: "assets/abc123.js",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });
