import { credentialEnvelope } from "../helpers/credential-envelope";
import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, parseCookies, post, put } = setupE2EWorker(".wrangler/state/e2e-credentials-android");

interface BuildCredsItem {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

describe("Credentials Android flow", () => {
  let cookies: string;
  let projectId: string;
  let appIdentifierId: string;
  let keystoreId: string;
  let saSubmissionsId: string;
  let saFcmId: string;
  let defaultCredsId: string;
  let secondCredsId: string;

  it("signs up, creates org + project", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Android Cred User",
      email: "android-cred-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    cookies = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Android Cred Org", slug: "android-cred-org" },
      { cookie: cookies },
    );
    expect(orgRes.status).toBe(200);
    const organizationId = (await orgRes.json()).id;
    cookies = parseCookies(orgRes) || cookies;

    const activeRes = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(activeRes.status).toBe(200);
    cookies = parseCookies(activeRes) || cookies;

    const projRes = await post(
      "/api/projects",
      { name: "Android Proj", slug: "android-proj" },
      { cookie: cookies },
    );
    expect(projRes.status).toBe(201);
    projectId = (await projRes.json()).id;
  });

  it("creates an Android application identifier with an auto-default credential group", async () => {
    const res = await post(
      `/api/projects/${projectId}/android-application-identifiers`,
      { packageName: "com.acme.app" },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.packageName).toBe("com.acme.app");
    appIdentifierId = body.id;

    const listRes = await get(
      `/api/android-application-identifiers/${appIdentifierId}/build-credentials`,
      { cookie: cookies },
    );
    const items = (await listRes.json()).items as BuildCredsItem[];
    expect(items).toHaveLength(1);
    expect(items[0]?.isDefault).toBe(true);
    expect(items[0]?.name).toBe("Default");
  });

  it("rejects invalid package names", async () => {
    const res = await post(
      `/api/projects/${projectId}/android-application-identifiers`,
      { packageName: "not-valid" },
      { cookie: cookies },
    );
    expect(res.status).toBe(400);
  });

  it("uploads a JKS keystore", async () => {
    const res = await post(
      "/api/android/upload-keystores",
      {
        ...credentialEnvelope(),
        keyAlias: "upload",
        sha256Fingerprint: "00:11:22:33:44:55:66:77",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.keyAlias).toBe("upload");
    expect(body.sha256Fingerprint).toBe("00:11:22:33:44:55:66:77");
    keystoreId = body.id;
  });

  it("uploads two Google service account keys", async () => {
    const subRes = await post(
      "/api/google/service-account-keys",
      {
        ...credentialEnvelope(),
        clientEmail: "submissions@play-project.iam.gserviceaccount.com",
        privateKeyId: "sub-key-id",
        googleProjectId: "play-project",
      },
      { cookie: cookies },
    );
    expect(subRes.status).toBe(201);
    saSubmissionsId = (await subRes.json()).id;

    const fcmRes = await post(
      "/api/google/service-account-keys",
      {
        ...credentialEnvelope(),
        clientEmail: "fcm@fcm-project.iam.gserviceaccount.com",
        privateKeyId: "fcm-key-id",
        googleProjectId: "fcm-project",
      },
      { cookie: cookies },
    );
    expect(fcmRes.status).toBe(201);
    saFcmId = (await fcmRes.json()).id;
  });

  it("binds keystore + service accounts to the auto-default group", async () => {
    const listRes = await get(
      `/api/android-application-identifiers/${appIdentifierId}/build-credentials`,
      { cookie: cookies },
    );
    const items = (await listRes.json()).items as BuildCredsItem[];
    defaultCredsId = items[0]?.id ?? "";
    expect(defaultCredsId).not.toBe("");

    const res = await put(
      `/api/android-build-credentials/${defaultCredsId}`,
      {
        androidUploadKeystoreId: keystoreId,
        googleServiceAccountKeyForSubmissionsId: saSubmissionsId,
        googleServiceAccountKeyForFcmV1Id: saFcmId,
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isDefault).toBe(true);
    expect(body.name).toBe("Default");
  });

  it("creates a second non-default group", async () => {
    const res = await post(
      `/api/android-application-identifiers/${appIdentifierId}/build-credentials`,
      {
        name: "Staging",
        androidUploadKeystoreId: keystoreId,
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.isDefault).toBe(false);
    secondCredsId = body.id;

    const listRes = await get(
      `/api/android-application-identifiers/${appIdentifierId}/build-credentials`,
      { cookie: cookies },
    );
    const items = (await listRes.json()).items as BuildCredsItem[];
    expect(items).toHaveLength(2);
    expect(items.filter((item) => item.isDefault)).toHaveLength(1);
  });

  it("promotes the second group to default and demotes the first", async () => {
    const res = await put(
      `/api/android-build-credentials/${secondCredsId}`,
      { isDefault: true },
      { cookie: cookies },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isDefault).toBe(true);

    const listRes = await get(
      `/api/android-application-identifiers/${appIdentifierId}/build-credentials`,
      { cookie: cookies },
    );
    const items = (await listRes.json()).items as BuildCredsItem[];
    const defaults = items.filter((item) => item.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(secondCredsId);
    const prevDefault = items.find((item) => item.id === defaultCredsId);
    expect(prevDefault?.isDefault).toBe(false);
  });
});
