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
  readonly assets: readonly SerializedAssetRef[];
}

export interface CreateUpdateRequest extends PublishInputBase {
  readonly groupId: string;
  readonly rolloutPercentage: number;
  readonly isRollback: boolean;
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
