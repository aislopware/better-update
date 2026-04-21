import { Cause, Effect } from "effect";

import { Conflict } from "../errors";
import { D1StatementError, d1RunWithUniqueCheck } from "./d1-helpers";

describe(d1RunWithUniqueCheck, () => {
  it("returns void on success", async () => {
    await expect(
      Effect.runPromise(d1RunWithUniqueCheck(async () => ({}), "unused")),
    ).resolves.toBeUndefined();
  });

  it("maps unique constraint errors to Conflict", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        d1RunWithUniqueCheck(async () => {
          throw new Error("UNIQUE constraint failed: branches.project_id, name");
        }, "Branch already exists"),
      ),
    );

    expect(error).toBeInstanceOf(Conflict);
    expect(error.message).toBe("Branch already exists");
  });

  it("dies with a tagged D1 statement error for non-unique failures", async () => {
    const cause = await Effect.runPromise(
      Effect.flip(
        Effect.sandbox(
          d1RunWithUniqueCheck(async () => {
            throw new Error("database unavailable");
          }, "unused"),
        ),
      ),
    );

    const [defect] = [...Cause.defects(cause)];
    expect(defect).toBeInstanceOf(D1StatementError);
    expect((defect as D1StatementError)._tag).toBe("D1StatementError");
  });
});
