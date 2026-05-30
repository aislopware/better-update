import { toResponse } from "./bundle";

import type { BundleResolution } from "../application/resolve-bundle";
import type { StoredBlob } from "../cloudflare/asset-storage";

// Item 3: opt-in HTTP 226 IM Used for bsdiff patch responses. `toResponse` is
// the pure status/header selector — it maps a resolved BundleResolution to a
// Response given the EMIT_HTTP_226 flag. Default (flag off) keeps 200 for
// patches (the device accepts both 200 and 226; some proxy caches mishandle
// 226, so 200 is the safe default). The patch im:bsdiff + expo-base-update-id
// headers are identical regardless of status. This is framework-free pure
// logic, so no Effect runtime is needed.

const blob = (size: number): StoredBlob => ({
  body: null,
  size,
  etag: null,
  contentType: "application/octet-stream",
  uploaded: null,
  checksumSha256Base64: null,
});

const patchResolution: BundleResolution = {
  kind: "patch",
  baseUpdateId: "AAAA1111-0000-0000-0000-000000000000",
  blob: blob(4),
};

const fullResolution: BundleResolution = { kind: "full", blob: blob(8) };

const notFoundResolution: BundleResolution = { kind: "not-found" };

describe("bundle toResponse — Item 3 HTTP 226 opt-in", () => {
  describe("flag OFF (default)", () => {
    it("patch serves 200 + im:bsdiff + lowercased expo-base-update-id", () => {
      const response = toResponse(false)(patchResolution);
      expect(response.status).toBe(200);
      expect(response.headers.get("im")).toBe("bsdiff");
      // baseUpdateId is lowercased in the patch headers.
      expect(response.headers.get("expo-base-update-id")).toBe(
        "aaaa1111-0000-0000-0000-000000000000",
      );
      expect(response.headers.get("content-type")).toBe("application/octet-stream");
      expect(response.headers.get("content-length")).toBe("4");
    });

    it("full bundle serves 200 with no patch headers", () => {
      const response = toResponse(false)(fullResolution);
      expect(response.status).toBe(200);
      expect(response.headers.get("im")).toBeNull();
      expect(response.headers.get("expo-base-update-id")).toBeNull();
      expect(response.headers.get("content-length")).toBe("8");
    });
  });

  describe("flag ON", () => {
    it("patch serves 226 IM Used, headers unchanged", () => {
      const response = toResponse(true)(patchResolution);
      expect(response.status).toBe(226);
      // The opt-in flag only changes the status line — the patch headers + body
      // contract is byte-for-byte identical to the 200 path.
      expect(response.headers.get("im")).toBe("bsdiff");
      expect(response.headers.get("expo-base-update-id")).toBe(
        "aaaa1111-0000-0000-0000-000000000000",
      );
      expect(response.headers.get("content-length")).toBe("4");
    });

    it("full bundle still serves 200 regardless of the flag", () => {
      const response = toResponse(true)(fullResolution);
      expect(response.status).toBe(200);
      expect(response.headers.get("im")).toBeNull();
    });
  });

  it("not-found maps to 404 in both flag states", () => {
    expect(toResponse(false)(notFoundResolution).status).toBe(404);
    expect(toResponse(true)(notFoundResolution).status).toBe(404);
  });
});
