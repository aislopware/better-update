import type {
  AndroidBuildCredentialsItem,
  AndroidUploadKeystoreItem,
  IosBundleConfigurationItem,
} from "@better-update/api-client/react";

import { groupIosConfigs, summarizeAndroidCredentials } from "./-credentials-index-helpers";

const iosConfig = (
  overrides: Partial<IosBundleConfigurationItem> & { bundleIdentifier: string },
): IosBundleConfigurationItem => ({
  id: `cfg-${overrides.bundleIdentifier}-${overrides.distributionType ?? "APP_STORE"}`,
  organizationId: "org-1",
  projectId: "prj-1",
  distributionType: "APP_STORE",
  appleTeamId: "team-1",
  appleDistributionCertificateId: null,
  appleProvisioningProfileId: null,
  applePushKeyId: null,
  ascApiKeyId: null,
  targetName: null,
  parentBundleIdentifier: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe(groupIosConfigs, () => {
  it("collapses a bundle's configurations into one row", () => {
    const groups = groupIosConfigs([
      iosConfig({
        bundleIdentifier: "com.example.app",
        distributionType: "AD_HOC",
        appleProvisioningProfileId: "prof-1",
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
      iosConfig({
        bundleIdentifier: "com.example.app",
        distributionType: "APP_STORE",
        appleDistributionCertificateId: "cert-1",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.distributionTypes).toStrictEqual(["APP_STORE", "AD_HOC"]);
    expect(groups[0]?.slots).toStrictEqual({
      certificate: true,
      profile: true,
      pushKey: false,
      ascKey: false,
    });
    expect(groups[0]?.updatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(groups[0]?.appleTeamIds).toStrictEqual(["team-1"]);
  });

  it("sorts by identifier and carries target and parent through", () => {
    const groups = groupIosConfigs([
      iosConfig({
        bundleIdentifier: "com.example.app.widget",
        targetName: "Widget",
        parentBundleIdentifier: "com.example.app",
      }),
      iosConfig({ bundleIdentifier: "com.example.app" }),
    ]);

    expect(groups.map((group) => group.bundleIdentifier)).toStrictEqual([
      "com.example.app",
      "com.example.app.widget",
    ]);
    expect(groups[1]?.targetName).toBe("Widget");
    expect(groups[1]?.parentBundleIdentifier).toBe("com.example.app");
  });

  it("lists every distinct team a bundle signs under", () => {
    const groups = groupIosConfigs([
      iosConfig({ bundleIdentifier: "com.example.app", appleTeamId: "team-1" }),
      iosConfig({
        bundleIdentifier: "com.example.app",
        distributionType: "ENTERPRISE",
        appleTeamId: "team-2",
      }),
    ]);

    expect(groups[0]?.appleTeamIds).toStrictEqual(["team-1", "team-2"]);
  });
});

const buildCredentials = (
  overrides: Partial<AndroidBuildCredentialsItem> & { name: string },
): AndroidBuildCredentialsItem => ({
  id: `grp-${overrides.name}`,
  organizationId: "org-1",
  androidApplicationIdentifierId: "aai-1",
  androidUploadKeystoreId: null,
  googleServiceAccountKeyForSubmissionsId: null,
  googleServiceAccountKeyForFcmV1Id: null,
  isDefault: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const keystore = { id: "ks-1", keyAlias: "upload" } as AndroidUploadKeystoreItem;

describe(summarizeAndroidCredentials, () => {
  it("reads the default group, not the first one", () => {
    const summary = summarizeAndroidCredentials(
      [
        buildCredentials({ name: "alpha" }),
        buildCredentials({
          name: "release",
          isDefault: true,
          androidUploadKeystoreId: "ks-1",
          googleServiceAccountKeyForSubmissionsId: "gsa-1",
        }),
      ],
      [keystore],
    );

    expect(summary).toStrictEqual({
      groupCount: 2,
      defaultGroupName: "release",
      keystoreAlias: "upload",
      hasSubmissionsKey: true,
      hasFcmKey: false,
    });
  });

  it("falls back to the first group by name when none is default", () => {
    const summary = summarizeAndroidCredentials(
      [buildCredentials({ name: "beta" }), buildCredentials({ name: "alpha" })],
      [],
    );

    expect(summary.defaultGroupName).toBe("alpha");
    expect(summary.keystoreAlias).toBeNull();
  });

  it("reports an unconfigured identifier as empty", () => {
    expect(summarizeAndroidCredentials([], [keystore])).toStrictEqual({
      groupCount: 0,
      defaultGroupName: null,
      keystoreAlias: null,
      hasSubmissionsKey: false,
      hasFcmKey: false,
    });
  });
});
