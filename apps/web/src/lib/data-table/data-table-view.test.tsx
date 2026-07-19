import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ColumnDef } from "@tanstack/react-table";

import { DataTableView } from "./data-table-view";

import type { DataTableFilteredEmptyProps } from "./data-table-view";

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

const TestTable = ({
  data = sampleRows,
  onRowClick,
  emptyMessage,
  filteredEmpty,
}: {
  data?: TestRow[];
  onRowClick?: (row: TestRow) => void;
  emptyMessage?: string;
  filteredEmpty?: DataTableFilteredEmptyProps;
}) => {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <DataTableView
      table={table}
      columnsCount={columns.length}
      onRowClick={onRowClick}
      emptyMessage={emptyMessage}
      filteredEmpty={filteredEmpty}
    />
  );
};

describe(DataTableView, () => {
  it("applies typed-cell presentation to id and numeric cells", () => {
    render(<TestTable />);

    const idCell = screen.getByText("upd_123").closest("td");
    expect(idCell).toHaveClass("font-mono", "text-xs", "text-muted-foreground");

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

  it("adds a chevron-affordance column only for clickable rows", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn<(row: TestRow) => void>();
    render(<TestTable onRowClick={onRowClick} />);

    const headerRow = screen.getByText("Name").closest("tr")!;
    expect(headerRow.cells).toHaveLength(columns.length + 1);
    const bodyRow = screen.getByText("First").closest("tr")!;
    expect(bodyRow.cells).toHaveLength(columns.length + 1);

    await user.click(screen.getByText("First"));
    expect(onRowClick).toHaveBeenCalledWith(sampleRows[0]);
  });

  it("keeps the plain column count without onRowClick", () => {
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
