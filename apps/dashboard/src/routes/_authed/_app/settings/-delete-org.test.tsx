import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

/**
 * Tests the delete-org confirmation gate pattern: the delete button is only
 * enabled when the user types the exact org slug into a confirmation input.
 */

const DeleteConfirmTestForm = ({ slug }: { slug: string }) => {
  const [confirmText, setConfirmText] = useState("");

  return (
    <div>
      <label htmlFor="confirm-delete">
        Type <span>{slug}</span> to confirm
      </label>
      <input
        id="confirm-delete"
        value={confirmText}
        onChange={(event) => setConfirmText(event.target.value)}
      />
      <button type="button" disabled={confirmText !== slug}>
        Delete permanently
      </button>
    </div>
  );
};

describe("delete org confirmation gate", () => {
  test("delete button is disabled when confirmation is empty", () => {
    render(<DeleteConfirmTestForm slug="my-org" />);

    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeDisabled();
  });

  test("delete button is disabled when confirmation does not match", async () => {
    const user = userEvent.setup();
    render(<DeleteConfirmTestForm slug="my-org" />);

    await user.type(screen.getByLabelText(/Type .* to confirm/), "my-or");

    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeDisabled();
  });

  test("delete button enables when confirmation matches slug exactly", async () => {
    const user = userEvent.setup();
    render(<DeleteConfirmTestForm slug="my-org" />);

    await user.type(screen.getByLabelText(/Type .* to confirm/), "my-org");

    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeEnabled();
  });

  test("delete button disables again when confirmation is modified", async () => {
    const user = userEvent.setup();
    render(<DeleteConfirmTestForm slug="my-org" />);

    const input = screen.getByLabelText(/Type .* to confirm/);
    await user.type(input, "my-org");
    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeEnabled();

    await user.type(input, "x");
    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeDisabled();
  });
});
