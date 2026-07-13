import { act, screen } from "@testing-library/react";

import { renderWithQuery } from "../../tests/helpers/render-with-query";
import { ErrorBoundary } from "./error-boundary";

const Thrower = ({ value }: { value: unknown }): never => {
  throw value;
};

let transientShouldThrow = true;
const TransientThrower = () => {
  if (transientShouldThrow) {
    return <Thrower value={undefined} />;
  }
  return <div>recovered</div>;
};

describe(ErrorBoundary, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recovers via a delayed reset when a transient non-Error value is thrown", () => {
    // TanStack Router suspends by throwing a match's loadPromise; mid-transition
    // that promise can be `undefined`. The boundary must swallow it (no
    // "undefined" flash) and self-reset once the transition settles.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    transientShouldThrow = true;

    const { container } = renderWithQuery(
      <ErrorBoundary>
        <TransientThrower />
      </ErrorBoundary>,
    );

    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(container).toBeEmptyDOMElement();

    // The transition settles (the throw stops), then the scheduled reset fires.
    transientShouldThrow = false;
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByText("recovered")).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("surfaces a reload screen when a non-Error throw persists past the reset budget", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = renderWithQuery(
      <ErrorBoundary>
        <Thrower value={undefined} />
      </ErrorBoundary>,
    );

    expect(container).toBeEmptyDOMElement();

    // Each reset re-throws and schedules the next attempt; after the budget
    // (3 resets) the boundary stops hiding the failure.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      act(() => {
        vi.runAllTimers();
      });
    }

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("The page failed to load.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();

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
