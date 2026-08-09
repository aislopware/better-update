import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { SortingState, Updater } from "@tanstack/react-table";

import { DataTableView } from "./data-table-view";
import { useDataTable } from "./table-features";

import type { DataTableColumnDef } from "./table-features";

/**
 * v9 tables only have the APIs their `features` object registers, and a missing
 * registration is quiet: sorting stops ordering rows, pagination stops slicing
 * them, and nothing throws. These exercise the registry itself — that the three
 * features every list in this app leans on are all actually wired in.
 */

interface TestRow {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

const columns: DataTableColumnDef<TestRow>[] = [
  { id: "name", accessorKey: "name", header: "Name" },
  { id: "count", accessorKey: "count", header: "Count", enableHiding: true },
];

const rows: TestRow[] = [
  { id: "c", name: "Cherry", count: 3 },
  { id: "a", name: "Apple", count: 1 },
  { id: "b", name: "Banana", count: 2 },
];

const rowNames = (): string[] =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelectorAll("td")[0]?.textContent ?? "");

const SortableTable = () => {
  const table = useDataTable({ data: rows, columns, enableSortingRemoval: false });
  return <DataTableView table={table} columnsCount={columns.length} />;
};

// Mirrors the server-sorted lists (updates, builds, branches, channels): the
// sorting slice is owned by the URL, the table only reports the click, and the
// rows arrive in the order the server already put them in.
const ServerSortedTable = ({
  sorting,
  onSortingChange,
}: {
  sorting: SortingState;
  onSortingChange: (updater: Updater<SortingState>) => void;
}) => {
  const table = useDataTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
  });
  return <DataTableView table={table} columnsCount={columns.length} />;
};

const PagedTable = () => {
  const table = useDataTable({
    data: rows,
    columns,
    initialState: { pagination: { pageIndex: 0, pageSize: 2 } },
  });
  return <DataTableView table={table} columnsCount={columns.length} />;
};

// Mirrors the updates list, which ships its size column hidden and recovers it
// through the View menu.
const HidableTable = () => {
  const table = useDataTable({
    data: rows,
    columns,
    initialState: { columnVisibility: { count: false } },
  });
  return (
    <>
      <button
        type="button"
        onClick={() => {
          table.setColumnVisibility({ count: true });
        }}
      >
        Show count
      </button>
      <DataTableView table={table} columnsCount={columns.length} />
    </>
  );
};

describe("dataTableFeatures", () => {
  it("sorts client-side when a sortable header is clicked", async () => {
    const user = userEvent.setup();
    render(<SortableTable />);

    expect(rowNames()).toStrictEqual(["Cherry", "Apple", "Banana"]);

    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(rowNames()).toStrictEqual(["Apple", "Banana", "Cherry"]);

    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(rowNames()).toStrictEqual(["Cherry", "Banana", "Apple"]);
  });

  it("reports header clicks to a controlled sorting owner without reordering rows", async () => {
    const user = userEvent.setup();
    const onSortingChange = vi.fn<(updater: Updater<SortingState>) => void>();
    render(<ServerSortedTable sorting={[]} onSortingChange={onSortingChange} />);

    await user.click(screen.getByRole("button", { name: /Name/ }));

    expect(onSortingChange).toHaveBeenCalledTimes(1);
    const updater = onSortingChange.mock.calls[0]?.[0];
    expect(typeof updater === "function" ? updater([]) : updater).toStrictEqual([
      { id: "name", desc: false },
    ]);

    // manualSorting: the server already ordered these, so the table left them alone.
    expect(rowNames()).toStrictEqual(["Cherry", "Apple", "Banana"]);
  });

  it("paginates client-side down to the page size", () => {
    render(<PagedTable />);

    expect(rowNames()).toStrictEqual(["Cherry", "Apple"]);
  });

  it("honours initial column visibility and can restore the column", async () => {
    const user = userEvent.setup();
    render(<HidableTable />);

    expect(screen.queryByRole("columnheader", { name: /Count/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show count" }));

    expect(screen.getByRole("columnheader", { name: /Count/ })).toBeInTheDocument();
  });
});
