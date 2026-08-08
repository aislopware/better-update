import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ColumnDef } from "@tanstack/react-table";

import { DataTableView } from "./data-table-view";

import type { FilteredEmptyProps } from "./list-empty-state";

interface TestRow {
  readonly id: string;
  readonly name: string;
  readonly count: number | null;
  readonly note: string | null;
}

const columns: ColumnDef<TestRow>[] = [
  { id: "name", accessorKey: "name", header: "Name", enableSorting: false },
  {
    id: "identifier",
    accessorKey: "id",
    header: "ID",
    enableSorting: false,
    meta: { cellType: "id" },
  },
  {
    id: "count",
    accessorKey: "count",
    header: "Count",
    enableSorting: false,
    meta: { cellType: "numeric" },
  },
  // No cellType: absent values keep the renderer's own (blank) output.
  { id: "note", accessorKey: "note", header: "Note", enableSorting: false },
];

const sampleRows: TestRow[] = [
  { id: "upd_123", name: "First", count: 42, note: null },
  { id: "upd_456", name: "Second", count: null, note: "hello" },
];

// A plain anchor stands in for the route-typed `Link` a real page passes:
// TanStack's Link needs a router, and what this view owns is where the link
// goes in the row, not what the caller renders.
const TestTable = ({
  data = sampleRows,
  linked = false,
  emptyMessage,
  filteredEmpty,
}: {
  data?: TestRow[];
  linked?: boolean;
  emptyMessage?: string;
  filteredEmpty?: FilteredEmptyProps;
}) => {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <DataTableView
      table={table}
      columnsCount={columns.length}
      renderRowLink={
        linked
          ? (row, { className, children }) => (
              <a href={`/rows/${row.id}`} className={className}>
                {children}
              </a>
            )
          : undefined
      }
      emptyMessage={emptyMessage}
      filteredEmpty={filteredEmpty}
    />
  );
};

describe(DataTableView, () => {
  it("applies typed-cell presentation to id and numeric cells", () => {
    render(<TestTable />);

    const idCell = screen.getByText("upd_123").closest("td");
    expect(idCell).toHaveClass("font-mono", "text-xs", "text-kumo-subtle");

    const numericCell = screen.getByText("42").closest("td");
    expect(numericCell).toHaveClass("text-right", "tabular-nums");

    // Numeric headers right-align with their cells.
    expect(screen.getByText("Count").closest("th")).toHaveClass("text-right");
    expect(screen.getByText("Name").closest("th")).not.toHaveClass("text-right");
  });

  it("renders an em dash for absent values in typed cells only", () => {
    render(<TestTable />);

    // Second row: count (numeric) is null → em dash; note has no cellType and
    // stays blank, so exactly one em dash renders.
    expect(screen.getAllByText("—")).toHaveLength(1);
  });

  it("makes the row's name the link and adds a chevron-affordance column", () => {
    render(<TestTable linked />);

    const headerRow = screen.getByText("Name").closest("tr")!;
    expect(headerRow.cells).toHaveLength(columns.length + 1);
    const bodyRow = screen.getByText("First").closest("tr")!;
    expect(bodyRow.cells).toHaveLength(columns.length + 1);

    // No column is marked primary here, so the link lands in the first cell.
    const link = screen.getByRole("link", { name: "First" });
    expect(link).toHaveAttribute("href", "/rows/upd_123");
    expect(bodyRow.cells[0]).toContainElement(link);
  });

  it("follows the row's link when the row itself is clicked", async () => {
    const user = userEvent.setup();
    render(<TestTable linked />);
    const link = screen.getByRole("link", { name: "First" });
    const followed = vi.fn<(event: Event) => void>();
    link.addEventListener("click", (event) => {
      // jsdom cannot navigate; stop before it tries.
      event.preventDefault();
      followed(event);
    });

    // A cell that is not the name: the whole row still opens the row.
    await user.click(screen.getByText("42"));

    expect(followed).toHaveBeenCalledTimes(1);
  });

  it("leaves modified clicks to the browser", async () => {
    const user = userEvent.setup();
    render(<TestTable linked />);
    const link = screen.getByRole("link", { name: "First" });
    const followed = vi.fn<(event: Event) => void>();
    link.addEventListener("click", (event) => {
      event.preventDefault();
      followed(event);
    });

    // Cmd-click opens a new tab. Forwarding it would navigate this one as well.
    await user.keyboard("{Meta>}");
    await user.click(screen.getByText("42"));
    await user.keyboard("{/Meta}");

    expect(followed).not.toHaveBeenCalled();
  });

  it("keeps the plain column count for rows that go nowhere", () => {
    render(<TestTable />);

    const headerRow = screen.getByText("Name").closest("tr")!;
    expect(headerRow.cells).toHaveLength(columns.length);
    const bodyRow = screen.getByText("First").closest("tr")!;
    expect(bodyRow.cells).toHaveLength(columns.length);
  });

  it("shows the compact filtered-empty state with a working Clear filters action", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn<() => void>();
    render(
      <TestTable
        data={[]}
        emptyMessage="No builds yet."
        filteredEmpty={{ entity: "builds", isFiltered: true, onClear }}
      />,
    );

    expect(screen.getByText("No builds match your filters.")).toBeInTheDocument();
    expect(screen.queryByText("No builds yet.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("falls back to emptyMessage when no filters are active", () => {
    render(
      <TestTable
        data={[]}
        emptyMessage="No builds yet."
        filteredEmpty={{ entity: "builds", isFiltered: false, onClear: vi.fn<() => void>() }}
      />,
    );

    expect(screen.getByText("No builds yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("keeps the plain emptyMessage row when filteredEmpty is absent", () => {
    render(<TestTable data={[]} emptyMessage="No rows found." />);

    expect(screen.getByText("No rows found.")).toBeInTheDocument();
  });
});
