interface UpdateData {
  readonly id: string;
  readonly createdAt: string;
  readonly runtimeVersion: string;
  readonly metadata: Record<string, unknown>;
  readonly extra: Record<string, unknown> | undefined;
}

interface AssetData {
  readonly key: string;
  readonly hash: string;
  readonly contentType: string;
  readonly fileExt: string;
  readonly isLaunch: boolean;
}

const assetUrl = (baseUrl: string, hash: string) => `${baseUrl}/assets/${hash}`;

const toAssetEntry = (baseUrl: string, asset: AssetData) => ({
  hash: asset.hash,
  key: asset.key,
  contentType: asset.contentType,
  fileExtension: `.${asset.fileExt}`,
  url: assetUrl(baseUrl, asset.hash),
});

const toLaunchEntry = (baseUrl: string, asset: AssetData) => ({
  hash: asset.hash,
  key: asset.key,
  contentType: asset.contentType,
  url: assetUrl(baseUrl, asset.hash),
});

export const buildManifest = (params: {
  readonly update: UpdateData;
  readonly assets: readonly AssetData[];
  readonly scopeKey: string;
  readonly assetBaseUrl: string;
}): object => {
  const { update, assets, scopeKey, assetBaseUrl } = params;
  const launch = assets.find((asset) => asset.isLaunch);
  const regular = assets.filter((asset) => !asset.isLaunch);

  return {
    id: update.id,
    createdAt: update.createdAt,
    runtimeVersion: update.runtimeVersion,
    launchAsset: launch ? toLaunchEntry(assetBaseUrl, launch) : undefined,
    assets: regular.map((asset) => toAssetEntry(assetBaseUrl, asset)),
    metadata: update.metadata,
    extra: { scopeKey, ...update.extra },
  };
};

export const buildDirective = (params: { readonly update: UpdateData }): object => ({
  type: "rollBackToEmbedded",
  parameters: {
    commitTime: params.update.createdAt,
  },
});

export interface PatchedAssetInfo {
  readonly patchUrl: string;
  readonly patchSize: number;
  readonly baseHash: string;
}

export const buildExtensions = (params?: { readonly patchedAsset?: PatchedAssetInfo }): object => ({
  assetRequestHeaders: {},
  ...(params?.patchedAsset
    ? {
        patchedAssets: {
          launchAsset: params.patchedAsset,
        },
      }
    : {}),
});
