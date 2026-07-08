import { Button } from "@better-update/ui/components/ui/button";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithQuery } from "../../../../../../tests/helpers/render-with-query";
import { ConfirmActionDialog } from "./-confirm-action-dialog";

const renderDialog = (
  onConfirm: () => Promise<unknown>,
  onSuccess: () => Promise<void> = async () => undefined,
) =>
  renderWithQuery(
    <ConfirmActionDialog
      title="Archive my-app?"
      description="The project will become read-only until you unarchive it."
      confirmLabel="Archive project"
      onConfirm={onConfirm}
      successMessage="Project archived"
      onSuccess={onSuccess}
    >
      <Button>Archive project</Button>
    </ConfirmActionDialog>,
  );

describe(ConfirmActionDialog, () => {
  it("does not run the action until the user confirms", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
    renderDialog(onConfirm);

    // Opening the dialog must not fire the action.
    await user.click(screen.getByRole("button", { name: "Archive project" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("runs the action and onSuccess when confirmed, then closes", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
    const onSuccess = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderDialog(onConfirm, onSuccess);

    await user.click(screen.getByRole("button", { name: "Archive project" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Archive project" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("keeps the dialog open and does not call onSuccess when the action fails", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error("nope"));
    const onSuccess = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderDialog(onConfirm, onSuccess);

    await user.click(screen.getByRole("button", { name: "Archive project" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Archive project" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
