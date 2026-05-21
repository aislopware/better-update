import { screen } from "@testing-library/react";

import { renderWithQuery } from "../../tests/helpers/render-with-query";
import { ErrorBoundary } from "./error-boundary";

const Thrower = ({ value }: { value: unknown }): never => {
  throw value;
};

describe(ErrorBoundary, () => {
  it("renders nothing when a non-Error value is thrown (transient router race)", () => {
    // TanStack Router suspends by throwing a match's loadPromise; mid-transition
    // that promise can be `undefined`. The boundary must swallow it, not flash
    // "undefined" at the user, and recover via resetKeys once navigation settles.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = renderWithQuery(
      <ErrorBoundary>
        <Thrower value={undefined} />
      </ErrorBoundary>,
    );

    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(container).toBeEmptyDOMElement();

    consoleError.mockRestore();
  });

  it("shows the message and a retry button for a real Error", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithQuery(
      <ErrorBoundary>
        <Thrower value={new Error("boom")} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    consoleError.mockRestore();
  });
});
