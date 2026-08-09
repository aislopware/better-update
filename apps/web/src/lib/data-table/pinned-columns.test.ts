import { withoutPinnedColumns } from "./pinned-columns";

import type { DataTableColumnDef } from "./table-features";

interface Row {
  readonly name: string;
}

const columns: DataTableColumnDef<Row>[] = [
  { id: "name", header: "Name" },
  { id: "branch", header: "Branch" },
  { id: "platform", header: "Platform" },
];

describe(withoutPinnedColumns, () => {
  it("drops the columns a filter has pinned to one value", () => {
    const kept = withoutPinnedColumns(columns, { branch: true, platform: false });

    expect(kept.map((column) => column.id)).toStrictEqual(["name", "platform"]);
  });

  it("keeps every column when nothing is pinned", () => {
    expect(withoutPinnedColumns(columns, {})).toHaveLength(columns.length);
  });
});
