import { Layer } from "effect";

import { CryptoServiceLive } from "../cloudflare/crypto-service";
import { ManifestCacheStorageLive } from "../cloudflare/manifest-cache-storage";
import { ManifestRepoLive } from "../repositories/manifest";
import { ProjectProtocolMetadataRepoLive } from "../repositories/project-protocol-metadata";

export type { ManifestCacheStorage } from "../cloudflare/manifest-cache-storage";

export const ManifestServicesLive = Layer.mergeAll(
  ManifestRepoLive,
  ManifestCacheStorageLive,
  CryptoServiceLive,
  ProjectProtocolMetadataRepoLive,
);
