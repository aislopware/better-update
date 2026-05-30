export interface CoordinatorFailure {
  readonly ok: false;
  readonly message: string;
}

export interface CoordinatorSuccess<Value> {
  readonly ok: true;
  readonly value: Value;
}

export type CoordinatorResult<Value> = CoordinatorFailure | CoordinatorSuccess<Value>;

export interface SerializedAssetRef {
  readonly key: string;
  readonly hash: string;
  readonly isLaunch: boolean;
  readonly contentChecksum?: string | undefined;
}

export interface SerializedUpdate {
  readonly id: string;
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly platform: "ios" | "android";
  readonly message: string;
  readonly metadataJson: string;
  readonly extraJson: string | null;
  readonly groupId: string;
  readonly rolloutPercentage: number;
  readonly isRollback: boolean;
  readonly signature: string | null;
  readonly certificateChain: string | null;
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
  readonly fingerprintHash: string | null;
  readonly gitCommit: string | null;
  readonly gitDirty: boolean;
  readonly totalAssetSize: number;
  readonly createdAt: string;
}

export interface EnsureBranchChannelResult {
  readonly branchId: string;
  readonly branchCreated: boolean;
  readonly channelId: string;
  readonly channelCreated: boolean;
}

interface PublishInputBase {
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly platform: "ios" | "android";
  readonly message: string;
  readonly metadataJson: string;
  readonly extraJson: string | null;
  readonly signature: string | null;
  readonly certificateChain: string | null;
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
  readonly fingerprintHash: string | null;
  // Git provenance captured at publish time (mirrors EAS + the builds path).
  // gitCommit is the resolved HEAD SHA or null (non-git project / empty repo);
  // gitDirty flags an uncommitted working tree (false when clean or unknown).
  readonly gitCommit: string | null;
  readonly gitDirty: boolean;
  readonly assets: readonly SerializedAssetRef[];
}

export interface CreateUpdateRequest extends PublishInputBase {
  readonly groupId: string;
  readonly rolloutPercentage: number;
  readonly isRollback: boolean;
  /**
   * Client-chosen update id for signed renders. When present the server
   * persists THIS id (instead of generating one) so the signed
   * `manifestBody.id` + bundle-route URL bind to the served row. Defaults to a
   * server-generated UUID when absent (unsigned path).
   */
  readonly id?: string;
  /**
   * When true, this update is recorded as the embedded baseline for its
   * (branch, runtimeVersion, platform) so the client's `expo-embedded-update-id`
   * can resolve a first-launch patch against it. Defaults to false.
   */
  readonly isEmbedded?: boolean;
}

export interface RepublishSourceUpdate {
  readonly runtimeVersion: string;
  readonly platform: "ios" | "android";
  readonly message: string;
  readonly metadataJson: string;
  readonly extraJson: string | null;
  readonly signature: string | null;
  readonly certificateChain: string | null;
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
  readonly fingerprintHash: string | null;
  readonly assets: readonly SerializedAssetRef[];
}

export interface RepublishUpdateRequest {
  readonly branchId: string;
  readonly message: string | null;
  readonly updates: readonly RepublishSourceUpdate[];
}
