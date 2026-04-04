import { orgKeys, authKeys } from "./keys";

describe("auth keys", () => {
  test("session key", () => {
    expect(authKeys.session).toEqual(["auth", "session"]);
  });

  test("orgs key", () => {
    expect(authKeys.orgs).toEqual(["auth", "orgs"]);
  });
});

describe("org keys", () => {
  const keys = orgKeys("org-123");

  test("all key includes orgId", () => {
    expect(keys.all).toEqual(["org", "org-123"]);
  });

  test("projects query options have correct queryKey", () => {
    const opts = keys.projects();
    expect(opts.queryKey).toEqual(["org", "org-123", "projects"]);
  });

  test("members query options have correct queryKey", () => {
    const opts = keys.members();
    expect(opts.queryKey).toEqual(["org", "org-123", "members"]);
  });

  test("invitations query options have correct queryKey", () => {
    const opts = keys.invitations();
    expect(opts.queryKey).toEqual(["org", "org-123", "invitations"]);
  });

  test("apiKeys query options have correct queryKey", () => {
    const opts = keys.apiKeys();
    expect(opts.queryKey).toEqual(["org", "org-123", "api-keys"]);
  });

  test("different orgIds produce different keys", () => {
    const keysA = orgKeys("org-a");
    const keysB = orgKeys("org-b");
    expect(keysA.all).not.toEqual(keysB.all);
    expect(keysA.projects().queryKey).not.toEqual(keysB.projects().queryKey);
  });
});
