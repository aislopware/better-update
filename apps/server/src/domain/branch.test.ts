import { Schema } from "effect";

import { CreateBranchBody, UpdateBranchBody } from "./branch";

describe(CreateBranchBody, () => {
  test("decodes valid body", () => {
    const result = Schema.decodeUnknownSync(CreateBranchBody)({
      projectId: "proj-1",
      name: "staging",
    });
    expect(result).toEqual({ projectId: "proj-1", name: "staging" });
  });

  test("rejects empty name", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateBranchBody)({
        projectId: "proj-1",
        name: "",
      }),
    ).toThrow();
  });
});

describe(UpdateBranchBody, () => {
  test("decodes valid body", () => {
    const result = Schema.decodeUnknownSync(UpdateBranchBody)({
      name: "production",
    });
    expect(result).toEqual({ name: "production" });
  });

  test("rejects empty name", () => {
    expect(() => Schema.decodeUnknownSync(UpdateBranchBody)({ name: "" })).toThrow();
  });
});
