import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-submission");

const BUNDLE = "com.example.submit";
const ANDROID_PKG = "com.example.submit";

// Submissions are a success-only ledger: a row is created by the CLI only after a
// client-side upload succeeds. There is no status lifecycle to patch or cancel.
describe("Submission flow", () => {
  let cookies: string;
  let projectId: string;
  let iosSubmissionId: string;

  it("signs up + creates project", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Submit User",
      email: "submit-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    cookies = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Submit Org", slug: "submit-org" },
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
      { name: "Submit Proj", slug: "submit-proj" },
      { cookie: cookies },
    );
    expect(projRes.status).toBe(201);
    projectId = (await projRes.json()).id;
  });

  it("records an iOS submission from URL archive source", async () => {
    const res = await post(
      `/api/projects/${projectId}/submissions`,
      {
        platform: "ios",
        profileName: "production",
        archiveSource: "url",
        archiveUrl: "https://example.com/build.ipa",
        iosConfig: {
          bundleIdentifier: BUNDLE,
          sku: "EXAMPLE-001",
          language: "en-US",
        },
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.platform).toBe("ios");
    expect(body.profileName).toBe("production");
    expect(body.archiveSource).toBe("url");
    expect(body.status).toBeUndefined();
    expect(body.iosConfig?.bundleIdentifier).toBe(BUNDLE);
    iosSubmissionId = body.id;
  });

  it("rejects iOS submission with missing iosConfig", async () => {
    const res = await post(
      `/api/projects/${projectId}/submissions`,
      {
        platform: "ios",
        archiveSource: "url",
        archiveUrl: "https://example.com/build.ipa",
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(400);
  });

  it("lists submissions filtered by platform", async () => {
    const res = await get(`/api/projects/${projectId}/submissions?platform=ios`, {
      cookie: cookies,
    });
    expect(res.status).toBe(200);
    const items = (await res.json()).items as Array<{ id: string }>;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(iosSubmissionId);
  });

  it("gets an iOS submission by id", async () => {
    const res = await get(`/api/submissions/${iosSubmissionId}`, { cookie: cookies });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(iosSubmissionId);
    expect(body.iosConfig?.bundleIdentifier).toBe(BUNDLE);
  });

  it("records an Android submission with track + rollout", async () => {
    const res = await post(
      `/api/projects/${projectId}/submissions`,
      {
        platform: "android",
        archiveSource: "url",
        archiveUrl: "https://example.com/build.aab",
        androidConfig: {
          applicationId: ANDROID_PKG,
          track: "internal",
          releaseStatus: "draft",
          changesNotSentForReview: false,
        },
      },
      { cookie: cookies },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.platform).toBe("android");
    expect(body.androidConfig?.applicationId).toBe(ANDROID_PKG);
    expect(body.androidConfig?.track).toBe("internal");
    expect(body.androidConfig?.releaseStatus).toBe("draft");
  });

  it("deletes a submission", async () => {
    const res = await del(`/api/submissions/${iosSubmissionId}`, { cookie: cookies });
    expect(res.status).toBe(200);

    const list = await get(`/api/projects/${projectId}/submissions`, { cookie: cookies });
    const items = (await list.json()).items as Array<{ id: string }>;
    expect(items.some((item) => item.id === iosSubmissionId)).toBe(false);
  });
});
