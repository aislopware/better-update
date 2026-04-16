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
  readonly contentChecksum: string;
  readonly contentType: string;
  readonly fileExt: string;
  readonly isLaunch: boolean;
}

const assetUrl = (baseUrl: string, hash: string) => `${baseUrl}/assets/${hash}`;

const toAssetEntry = (baseUrl: string, asset: AssetData) => ({
  // ContentChecksum = raw SHA-256 of file bytes (client uses for integrity verification).
  // Hash = namespaced dedup key (used for URL routing to the correct R2 object).
  hash: asset.contentChecksum || asset.hash,
  key: asset.key,
  contentType: asset.contentType,
  fileExtension: `.${asset.fileExt}`,
  url: assetUrl(baseUrl, asset.hash),
});

const toLaunchEntry = (baseUrl: string, asset: AssetData) => ({
  hash: asset.contentChecksum || asset.hash,
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

export const buildExtensions = (): object => ({
  assetRequestHeaders: {},
});
