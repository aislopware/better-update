import { it } from "@effect/vitest";
import { Effect } from "effect";

import { MissingCredentialsError } from "./exit-codes";
import { upsertIosBundleConfiguration } from "./ios-bundle-config-upsert";
import { failureError } from "./test-utils";

import type { ApiClient } from "../services/api-client";

interface ExistingConfig {
  readonly id: string;
  readonly bundleIdentifier: string;
  readonly distributionType: "APP_STORE" | "AD_HOC" | "DEVELOPMENT" | "ENTERPRISE";
  readonly appleTeamId: string;
}

interface CapturedPayload {
  readonly bundleIdentifier?: string;
  readonly distributionType?: string;
  readonly appleTeamId?: string;
  readonly appleDistributionCertificateId?: string;
  readonly appleProvisioningProfileId?: string;
  readonly ascApiKeyId?: string;
}

interface CapturedCreate {
  readonly type: "create";
  readonly projectId: string;
  readonly payload: CapturedPayload;
}

interface CapturedUpdate {
  readonly type: "update";
  readonly id: string;
  readonly payload: CapturedPayload;
}

type Captured = CapturedCreate | CapturedUpdate;

const buildApi = (existing: readonly ExistingConfig[], captured: Captured[]): ApiClient =>
  ({
    iosBundleConfigurations: {
      list: () =>
        Effect.succeed({
          items: existing.map((entry) => ({
            ...entry,
            organizationId: "org-1",
            projectId: "project-1",
            appleDistributionCertificateId: null,
            appleProvisioningProfileId: null,
            applePushKeyId: null,
            ascApiKeyId: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          })),
        }),
      create: ({
        path,
        payload,
      }: {
        readonly path: { readonly projectId: string };
        readonly payload: CapturedPayload;
      }) => {
        captured.push({ type: "create", projectId: path.projectId, payload });
        return Effect.succeed({});
      },
      update: ({
        path,
        payload,
      }: {
        readonly path: { readonly id: string };
        readonly payload: CapturedPayload;
      }) => {
        captured.push({ type: "update", id: path.id, payload });
        return Effect.succeed({});
      },
    },
  }) as unknown as ApiClient;

const baseInput = {
  projectId: "project-1",
  bundleIdentifier: "com.example.app",
  distributionType: "APP_STORE" as const,
  appleTeamId: "team-row-1",
  appleDistributionCertificateId: "cert-new",
  appleProvisioningProfileId: "profile-new",
};

describe(upsertIosBundleConfiguration, () => {
  it.effect("creates a fresh configuration when none exists", () =>
    Effect.gen(function* () {
      const captured: Captured[] = [];
      const api = buildApi([], captured);
      const result = yield* upsertIosBundleConfiguration(api, baseInput);
      expect(result.action).toBe("created");
      expect(captured).toHaveLength(1);
      expect(captured[0]?.type).toBe("create");
      const created = captured[0] as CapturedCreate;
      expect(created.projectId).toBe("project-1");
      expect(created.payload.appleDistributionCertificateId).toBe("cert-new");
      expect(created.payload.appleProvisioningProfileId).toBe("profile-new");
    }),
  );

  it.effect("rebinds cert + profile on the existing row when team matches", () =>
    Effect.gen(function* () {
      const captured: Captured[] = [];
      const existing: ExistingConfig = {
        id: "cfg-1",
        bundleIdentifier: "com.example.app",
        distributionType: "APP_STORE",
        appleTeamId: "team-row-1",
      };
      const api = buildApi([existing], captured);
      const result = yield* upsertIosBundleConfiguration(api, baseInput);
      expect(result.action).toBe("updated");
      expect(captured).toHaveLength(1);
      const updated = captured[0] as CapturedUpdate;
      expect(updated.type).toBe("update");
      expect(updated.id).toBe("cfg-1");
      expect(updated.payload.appleDistributionCertificateId).toBe("cert-new");
      expect(updated.payload.appleProvisioningProfileId).toBe("profile-new");
      // ascApiKeyId not passed → preserved (not present in payload).
      expect(updated.payload.ascApiKeyId).toBeUndefined();
    }),
  );

  it.effect("forwards ascApiKeyId on update when provided", () =>
    Effect.gen(function* () {
      const captured: Captured[] = [];
      const existing: ExistingConfig = {
        id: "cfg-1",
        bundleIdentifier: "com.example.app",
        distributionType: "APP_STORE",
        appleTeamId: "team-row-1",
      };
      const api = buildApi([existing], captured);
      yield* upsertIosBundleConfiguration(api, { ...baseInput, ascApiKeyId: "asc-1" });
      const updated = captured[0] as CapturedUpdate;
      expect(updated.payload.ascApiKeyId).toBe("asc-1");
    }),
  );

  it.effect("fails when existing row binds a different Apple team", () =>
    Effect.gen(function* () {
      const captured: Captured[] = [];
      const existing: ExistingConfig = {
        id: "cfg-1",
        bundleIdentifier: "com.example.app",
        distributionType: "APP_STORE",
        appleTeamId: "team-other",
      };
      const api = buildApi([existing], captured);
      const exit = yield* Effect.exit(upsertIosBundleConfiguration(api, baseInput));
      const err = failureError(exit);
      expect(err).toBeInstanceOf(MissingCredentialsError);
      expect(err?.message).toContain("different Apple team");
      expect(captured).toHaveLength(0);
    }),
  );

  it.effect("ignores rows with different bundle or distribution type", () =>
    Effect.gen(function* () {
      const captured: Captured[] = [];
      const existing: readonly ExistingConfig[] = [
        {
          id: "cfg-other-bundle",
          bundleIdentifier: "com.example.other",
          distributionType: "APP_STORE",
          appleTeamId: "team-row-1",
        },
        {
          id: "cfg-other-distribution",
          bundleIdentifier: "com.example.app",
          distributionType: "AD_HOC",
          appleTeamId: "team-row-1",
        },
      ];
      const api = buildApi(existing, captured);
      const result = yield* upsertIosBundleConfiguration(api, baseInput);
      expect(result.action).toBe("created");
      expect(captured[0]?.type).toBe("create");
    }),
  );
});
