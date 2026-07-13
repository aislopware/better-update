import { CatchBoundary } from "@tanstack/react-router";
import { screen } from "@testing-library/react";

import { renderWithQuery } from "../../tests/helpers/render-with-query";

const Thrower = ({ value }: { value: unknown }): never => {
  throw value;
};

// Guards patches/@tanstack%2Freact-router@*.patch (PR TanStack/router#7741):
// bun pins patches to an exact version, so a dependency bump silently stops
// applying it. This test fails loudly when the patched CatchBoundary behavior
// is gone — on failure, either re-apply the patch to the new version
// (`bun patch @tanstack/react-router`) or, if the release contains the
// upstream fix (TanStack/router#7637/#7744), delete the patch AND this test.
describe("patched @tanstack/react-router CatchBoundary", () => {
  it("coerces a falsy thrown value into a real Error instead of skipping the boundary", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithQuery(
      <CatchBoundary
        errorComponent={({ error }) => (
          <div>{error instanceof Error ? error.message : "boundary skipped"}</div>
        )}
        getResetKey={() => "static"}
      >
        <Thrower value={undefined} />
      </CatchBoundary>,
    );

    expect(screen.getByText("Unhandled falsy error: undefined")).toBeInTheDocument();

    consoleError.mockRestore();
  });
});
