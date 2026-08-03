import {
  applyInvitationGrants,
  seedProtectedEnvironments,
  sweepInvitationGrants,
} from "./org-lifecycle";

// These hooks run inside better-auth plugin routes and speak raw D1, so the
// unit tests drive them with a recording fake: every prepared statement
// captures its SQL + bound args, and SELECTs answer from a canned result set.

interface RecordedCall {
  readonly sql: string;
  readonly args: readonly unknown[];
}

const makeFakeD1 = (
  grantRows: readonly { project_id: string; role: string }[],
  orgGrantRow: { role: string } | null = null,
) => {
  const calls: RecordedCall[] = [];
  const statement = (sql: string, args: readonly unknown[]) => ({
    bind: (...bound: unknown[]) => statement(sql, bound),
    run: async () => {
      calls.push({ sql, args });
      return {};
    },
    all: async () => {
      calls.push({ sql, args });
      return { results: grantRows };
    },
    first: async () => {
      calls.push({ sql, args });
      return orgGrantRow;
    },
  });
  const db = {
    prepare: (sql: string) => statement(sql, []),
    batch: async (statements: readonly { run: () => Promise<unknown> }[]) => {
      for (const stmt of statements) {
        // eslint-disable-next-line no-await-in-loop -- sequential like D1.batch
        await stmt.run();
      }
      return [];
    },
  };
  return { db: db as unknown as D1Database, calls };
};

describe(seedProtectedEnvironments, () => {
  it("protects production for the new org", async () => {
    const { db, calls } = makeFakeD1([]);
    await seedProtectedEnvironments(db, "org-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('INSERT INTO "protected_environment"');
    expect(calls[0]?.args).toStrictEqual(["org-1"]);
  });
});

describe(applyInvitationGrants, () => {
  it("materializes project grants as project_member rows and sweeps", async () => {
    const { db, calls } = makeFakeD1([{ project_id: "proj-1", role: "developer" }]);
    await applyInvitationGrants(db, {
      invitationId: "inv-1",
      organizationId: "org-1",
      memberId: "member-1",
      actorEmail: "new@example.com",
    });
    const sqls = calls.map((call) => call.sql);
    expect(sqls.some((sql) => sql.includes('INSERT INTO "project_member"'))).toBe(true);
    expect(sqls.some((sql) => sql.includes("'member.grants_applied'"))).toBe(true);
    expect(sqls.some((sql) => sql.includes('DELETE FROM "invitation_project_grant"'))).toBe(true);
    const insert = calls.find((call) => call.sql.includes('INSERT INTO "project_member"'));
    expect(insert?.args).toContain("proj-1");
    expect(insert?.args).toContain("developer");
    expect(insert?.args).toContain("member-1");
  });

  it("materializes the org-wide grant as an org_project_member row", async () => {
    const { db, calls } = makeFakeD1([], { role: "maintainer" });
    await applyInvitationGrants(db, {
      invitationId: "inv-4",
      organizationId: "org-1",
      memberId: "member-4",
      actorEmail: "new@example.com",
    });
    const sqls = calls.map((call) => call.sql);
    expect(sqls.some((sql) => sql.includes('INSERT INTO "project_member"'))).toBe(false);
    expect(sqls.some((sql) => sql.includes('DELETE FROM "invitation_org_project_grant"'))).toBe(
      true,
    );
    const insert = calls.find((call) => call.sql.includes('INSERT INTO "org_project_member"'));
    expect(insert?.args).toContain("member-4");
    expect(insert?.args).toContain("maintainer");
    const audit = calls.find((call) => call.sql.includes("'member.grants_applied'"));
    expect(String(audit?.args.at(-1))).toContain('"allProjectsRole":"maintainer"');
  });

  it("just sweeps when the invitation carried no grants", async () => {
    const { db, calls } = makeFakeD1([]);
    await applyInvitationGrants(db, {
      invitationId: "inv-2",
      organizationId: "org-1",
      memberId: "member-2",
      actorEmail: "new@example.com",
    });
    const writes = calls.filter((call) => !call.sql.trimStart().startsWith("SELECT"));
    expect(writes).toHaveLength(2);
    expect(writes[0]?.sql).toContain('DELETE FROM "invitation_project_grant"');
    expect(writes[1]?.sql).toContain('DELETE FROM "invitation_org_project_grant"');
  });
});

describe(sweepInvitationGrants, () => {
  it("deletes the invitation's grant rows in both tables", async () => {
    const { db, calls } = makeFakeD1([]);
    await sweepInvitationGrants(db, "inv-3");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain('DELETE FROM "invitation_project_grant"');
    expect(calls[1]?.sql).toContain('DELETE FROM "invitation_org_project_grant"');
    expect(calls[0]?.args).toStrictEqual(["inv-3"]);
    expect(calls[1]?.args).toStrictEqual(["inv-3"]);
  });
});
