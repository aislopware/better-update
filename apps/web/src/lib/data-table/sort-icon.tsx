import { ArrowDownIcon, ArrowUpIcon } from "@phosphor-icons/react";

const ARIA_SORT_MAP = { asc: "ascending", desc: "descending" } as const;

export const toAriaSort = (
  direction: false | "asc" | "desc",
): "ascending" | "descending" | "none" => (direction === false ? "none" : ARIA_SORT_MAP[direction]);

export const SortIcon = ({ direction }: { direction: false | "asc" | "desc" }) => {
  if (direction === "asc") {
    return <ArrowUpIcon weight="bold" className="size-3.5" />;
  }
  if (direction === "desc") {
    return <ArrowDownIcon weight="bold" className="size-3.5" />;
  }
  return null;
};
