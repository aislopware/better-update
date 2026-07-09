import { debugArtifactContentType, debugArtifactKey } from "./build-debug-artifacts";
import { updateSourcemapKey } from "./update-sourcemaps";

describe(debugArtifactKey, () => {
  it("builds a deterministic per-(build, type) key under the builds prefix", () => {
    expect(
      debugArtifactKey({
        organizationId: "org_1",
        projectId: "proj_1",
        buildId: "build_1",
        type: "dsym",
      }),
    ).toBe("builds/org_1/proj_1/build_1/debug/dsym.zip");
    expect(
      debugArtifactKey({
        organizationId: "org_1",
        projectId: "proj_1",
        buildId: "build_1",
        type: "js-sourcemap",
      }),
    ).toBe("builds/org_1/proj_1/build_1/debug/js-sourcemap.map");
    expect(
      debugArtifactKey({
        organizationId: "org_1",
        projectId: "proj_1",
        buildId: "build_1",
        type: "proguard-mapping",
      }),
    ).toBe("builds/org_1/proj_1/build_1/debug/proguard-mapping.txt");
  });
});

describe(debugArtifactContentType, () => {
  it("maps each artifact kind to its content type", () => {
    expect(debugArtifactContentType("dsym")).toBe("application/zip");
    expect(debugArtifactContentType("native-symbols")).toBe("application/zip");
    expect(debugArtifactContentType("js-sourcemap")).toBe("application/json");
    expect(debugArtifactContentType("proguard-mapping")).toBe("text/plain");
  });
});

describe(updateSourcemapKey, () => {
  it("keys sourcemaps per update under the private sourcemaps prefix", () => {
    expect(
      updateSourcemapKey({ organizationId: "org_1", projectId: "proj_1", updateId: "upd_1" }),
    ).toBe("sourcemaps/org_1/proj_1/upd_1.map");
  });
});
