import { Schema } from "effect";

import {
  CreateBranchRolloutBody,
  CreateChannelBody,
  UpdateChannelBody,
  UpdateRolloutBody,
} from "./channel";

describe(CreateChannelBody, () => {
  test("decodes valid body", () => {
    const result = Schema.decodeUnknownSync(CreateChannelBody)({
      projectId: "proj-1",
      name: "production",
    });
    expect(result).toEqual({ projectId: "proj-1", name: "production" });
  });

  test("rejects empty name", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateChannelBody)({
        projectId: "proj-1",
        name: "",
      }),
    ).toThrow();
  });
});

describe(UpdateChannelBody, () => {
  test("decodes valid body", () => {
    const result = Schema.decodeUnknownSync(UpdateChannelBody)({
      branchId: "branch-1",
    });
    expect(result).toEqual({ branchId: "branch-1" });
  });
});

describe(CreateBranchRolloutBody, () => {
  test("accepts valid percentage", () => {
    const result = Schema.decodeUnknownSync(CreateBranchRolloutBody)({
      newBranchId: "branch-2",
      percentage: 25,
    });
    expect(result.percentage).toBe(25);
  });

  test("rejects percentage out of range", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateBranchRolloutBody)({
        newBranchId: "branch-2",
        percentage: 0,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CreateBranchRolloutBody)({
        newBranchId: "branch-2",
        percentage: 101,
      }),
    ).toThrow();
  });
});

describe("UpdateRolloutBody (channel)", () => {
  test("accepts valid percentage", () => {
    const result = Schema.decodeUnknownSync(UpdateRolloutBody)({
      percentage: 75,
    });
    expect(result.percentage).toBe(75);
  });

  test("rejects non-integer", () => {
    expect(() => Schema.decodeUnknownSync(UpdateRolloutBody)({ percentage: 50.5 })).toThrow();
  });
});
