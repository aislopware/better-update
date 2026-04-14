import { buildRollbackDirectiveBody } from "./rollback-directive";

describe(buildRollbackDirectiveBody, () => {
  test("encodes a rollback directive with the provided commit time", () => {
    expect(JSON.parse(buildRollbackDirectiveBody("2026-04-14T08:00:00.000Z"))).toEqual({
      type: "rollBackToEmbedded",
      parameters: {
        commitTime: "2026-04-14T08:00:00.000Z",
      },
    });
  });
});
