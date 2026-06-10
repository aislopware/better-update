import { Forbidden } from "@better-update/api";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect } from "effect";

import { renderWithQuery } from "../../tests/helpers/render-with-query";
import { QueryErrorState } from "./query-error-state";

const captureRejection = async (effect: Effect.Effect<never, unknown>): Promise<unknown> =>
  Effect.runPromise(effect).then(
    () => {
      throw new Error("expected rejection");
    },
    (error: unknown) => error,
  );

describe(QueryErrorState, () => {
  it("renders the access-denied surface for Forbidden errors without a retry action", async () => {
    const error = await captureRejection(
      Effect.fail(new Forbidden({ message: "missing project read permission" })),
    );

    renderWithQuery(<QueryErrorState error={error} onRetry={vi.fn<() => void>()} />);

    expect(screen.getByText("You do not have access")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("renders the API message and retries for non-Forbidden errors", async () => {
    const onRetry = vi.fn<() => void>();
    renderWithQuery(<QueryErrorState error={new Error("network down")} onRetry={onRetry} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("network down")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
