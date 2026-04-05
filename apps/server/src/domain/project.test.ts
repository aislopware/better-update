import { Schema } from "effect";

import { CreateProjectBody, Project } from "./project";

describe(Project, () => {
  test("decodes valid project", () => {
    const result = Schema.decodeUnknownSync(Project)({
      id: "proj-1",
      organizationId: "org-1",
      name: "My App",
      scopeKey: "@my/app",
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(result).toBeInstanceOf(Project);
    expect(result.name).toBe("My App");
  });

  test("rejects missing required fields", () => {
    expect(() => Schema.decodeUnknownSync(Project)({ id: "proj-1" })).toThrow();
  });
});

describe(CreateProjectBody, () => {
  test("decodes valid body", () => {
    const result = Schema.decodeUnknownSync(CreateProjectBody)({
      name: "My App",
      scopeKey: "@my/app",
    });
    expect(result).toEqual({ name: "My App", scopeKey: "@my/app" });
  });

  test("rejects empty name", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateProjectBody)({
        name: "",
        scopeKey: "@my/app",
      }),
    ).toThrow();
  });

  test("rejects empty scopeKey", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateProjectBody)({
        name: "My App",
        scopeKey: "",
      }),
    ).toThrow();
  });
});
