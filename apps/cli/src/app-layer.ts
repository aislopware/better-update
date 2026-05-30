import { FetchHttpClient } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Layer } from "effect";

import { makeInteractiveModeLayer } from "./lib/interactive-mode";
import { makeOutputModeLayer } from "./lib/output-mode";
import { ApiClientLive } from "./services/api-client";
import { AppleAuthLive } from "./services/apple-auth";
import { AppleSessionStoreLive } from "./services/apple-session-store";
import { AuthStoreLive } from "./services/auth-store";
import { BsdiffServiceLive } from "./services/bsdiff";
import { CliRuntimeLive } from "./services/cli-runtime";
import { ConfigStoreLive } from "./services/config-store";
import { IdentityStoreLive } from "./services/identity-store";
import { PatchUploaderLive } from "./services/patch-uploader";
import { PresignedDownloadClientLive } from "./services/presigned-download";
import { PresignedUploadClientLive } from "./services/presigned-upload";
import { UpdateAssetUploaderLive } from "./services/update-asset-uploader";
import { VersionCheckLive } from "./services/version-check";

const CliPlatformLayer = Layer.mergeAll(CliRuntimeLive, NodeContext.layer, FetchHttpClient.layer);
const CliStoreLayer = Layer.mergeAll(
  AuthStoreLive,
  ConfigStoreLive,
  AppleSessionStoreLive,
  IdentityStoreLive,
).pipe(Layer.provide(CliPlatformLayer));
const CliAdapterDependencies = Layer.mergeAll(CliPlatformLayer, CliStoreLayer);
const ApiClientLayer = ApiClientLive.pipe(Layer.provide(CliAdapterDependencies));
const AppleAuthLayer = AppleAuthLive.pipe(Layer.provide(CliAdapterDependencies));
const PresignedUploadLayer = PresignedUploadClientLive.pipe(Layer.provide(CliPlatformLayer));
const UpdateAssetUploaderLayer = UpdateAssetUploaderLive.pipe(
  Layer.provide(Layer.mergeAll(ApiClientLayer, PresignedUploadLayer)),
);
const PresignedDownloadLayer = PresignedDownloadClientLive.pipe(Layer.provide(CliPlatformLayer));
const PatchUploaderLayer = PatchUploaderLive.pipe(
  Layer.provide(Layer.mergeAll(ApiClientLayer, PresignedUploadLayer)),
);
const VersionCheckLayer = VersionCheckLive.pipe(Layer.provide(CliPlatformLayer));

export const makeCliLive = (options: { readonly json: boolean; readonly interactive: boolean }) =>
  Layer.mergeAll(
    CliAdapterDependencies,
    ApiClientLayer,
    AppleAuthLayer,
    PresignedUploadLayer,
    UpdateAssetUploaderLayer,
    PresignedDownloadLayer,
    PatchUploaderLayer,
    BsdiffServiceLive,
    VersionCheckLayer,
    makeOutputModeLayer(options.json),
    makeInteractiveModeLayer(options.interactive),
  );

/** Default CLI layer: human-readable, interactive. Override via flags at the entrypoint. */
export const CliLive = makeCliLive({ json: false, interactive: true });
