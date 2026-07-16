import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { renderWithQuery } from "../../tests/helpers/render-with-query";
import { ServerSearchCombobox, useServerSearchList } from "./server-search-combobox";

// The fake server: substring-filters like the real list endpoints do.
const NAMES = ["Alpha App", "Beta App", "Gamma App", "Needle App"];

const Harness = () => {
  const [value, setValue] = useState("");
  const list = useServerSearchList((query) => ({
    queryKey: ["test-projects", query ?? ""],
    queryFn: async () => ({
      items: NAMES.filter((name) => !query || name.toLowerCase().includes(query.toLowerCase())).map(
        (name) => ({ id: name.toLowerCase().replaceAll(" ", "-"), name }),
      ),
    }),
  }));

  return (
    <ServerSearchCombobox
      value={value}
      onValueChange={setValue}
      options={list.items.map((item) => ({ value: item.id, label: item.name }))}
      search={list.search}
      onSearchChange={list.handleSearchChange}
      isPending={list.isPending}
      placeholder="Select a project"
      ariaLabel="Project"
    />
  );
};

describe(ServerSearchCombobox, () => {
  it("opens with the default list and reflects a picked option on the trigger", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness />);

    const trigger = screen.getByRole("button", { name: "Project" });
    expect(trigger).toHaveTextContent("Select a project");
    await user.click(trigger);

    await expect(screen.findByText("Alpha App")).resolves.toBeInTheDocument();
    expect(screen.getByText("Needle App")).toBeInTheDocument();

    await user.click(screen.getByText("Beta App"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Project" })).toHaveTextContent("Beta App");
    });
  });

  it("narrows through the server-side search and keeps the picked label after reset", async () => {
    const user = userEvent.setup();
    renderWithQuery(<Harness />);

    await user.click(screen.getByRole("button", { name: "Project" }));
    await screen.findByText("Alpha App");

    await user.type(screen.getByPlaceholderText("Search…"), "needle");
    await waitFor(() => {
      expect(screen.queryByText("Alpha App")).not.toBeInTheDocument();
    });
    await user.click(screen.getByText("Needle App"));

    // The popover closed and cleared the search; the pick-time label cache
    // keeps the trigger meaningful even though the searched page is gone.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Project" })).toHaveTextContent("Needle App");
    });
  });
});
