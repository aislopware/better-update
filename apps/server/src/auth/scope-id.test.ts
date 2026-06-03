import {
  buildEnvVarScopeId,
  ENV_VAR_GLOBAL_SENTINEL,
  ENV_VAR_SCOPE_KIND,
  parseEnvVarScopeId,
} from "./scope";

// Pure scope-id builder/parser + the named constants. No Effect, no I/O — plain
// `test` over the framework-agnostic helpers in `auth/scope.ts`.

describe("env-var scope-id constants", () => {
  it("global sentinel is the literal 'global' token", () => {
    expect(ENV_VAR_GLOBAL_SENTINEL).toBe("global");
  });

  it("scope kind is 'env_var_environment'", () => {
    expect(ENV_VAR_SCOPE_KIND).toBe("env_var_environment");
  });
});

describe(buildEnvVarScopeId, () => {
  it("builds <projectId>:<environment> for a project-scoped var", () => {
    expect(buildEnvVarScopeId("proj-1", "production")).toBe("proj-1:production");
  });

  it("uses the global sentinel segment when projectId is null", () => {
    expect(buildEnvVarScopeId(null, "development")).toBe("global:development");
  });

  it("the global segment is the exported sentinel, not an inline literal", () => {
    expect(buildEnvVarScopeId(null, "preview")).toBe(`${ENV_VAR_GLOBAL_SENTINEL}:preview`);
  });
});

describe(parseEnvVarScopeId, () => {
  it("splits a project scope id back into project + environment", () => {
    expect(parseEnvVarScopeId("proj-1:production")).toStrictEqual({
      project: "proj-1",
      environment: "production",
    });
  });

  it("splits a global scope id back into the sentinel + environment", () => {
    expect(parseEnvVarScopeId("global:development")).toStrictEqual({
      project: "global",
      environment: "development",
    });
  });

  it("splits on the FIRST colon only (environment may not, but stays total)", () => {
    // A well-formed environment never contains a colon; this guards the contract
    // that only the first delimiter splits, so a hypothetical trailing colon lands
    // in the environment segment rather than corrupting the project segment.
    expect(parseEnvVarScopeId("proj-1:a:b")).toStrictEqual({
      project: "proj-1",
      environment: "a:b",
    });
  });

  it("a scope id with no colon yields an empty environment", () => {
    expect(parseEnvVarScopeId("proj-1")).toStrictEqual({ project: "proj-1", environment: "" });
  });
});

describe("buildEnvVarScopeId / parseEnvVarScopeId round-trip", () => {
  it("project scope round-trips through build then parse", () => {
    expect(parseEnvVarScopeId(buildEnvVarScopeId("proj-1", "preview"))).toStrictEqual({
      project: "proj-1",
      environment: "preview",
    });
  });

  it("global scope round-trips to the sentinel segment", () => {
    expect(parseEnvVarScopeId(buildEnvVarScopeId(null, "production"))).toStrictEqual({
      project: "global",
      environment: "production",
    });
  });
});
