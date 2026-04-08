import { HttpApi, OpenApi } from "@effect/platform";

import { ManifestGroup } from "./groups/manifest";

/**
 * Documentation-only contract for OpenAPI/Scalar generation.
 * The manifest endpoint bypasses HttpApiBuilder at runtime because the Expo Updates
 * protocol requires multipart/mixed responses that do not fit the standard pipeline.
 */
export class ProtocolApi extends HttpApi.make("protocol-api")
  .add(ManifestGroup)
  .annotateContext(
    OpenApi.annotations({
      title: "Better Update Protocol API",
      version: "1.0.0",
      description: "Expo Updates protocol endpoints (unauthenticated)",
    }),
  ) {}
