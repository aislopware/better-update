import { Button } from "@better-update/ui/components/button";
import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { Loader } from "@better-update/ui/components/loader";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react";

import type { ReactNode } from "react";

/**
 * The ⋮ a row hands its verbs to.
 *
 * Every list in the dashboard opens its per-row menu the same way, so the
 * trigger is written once here rather than copied into each table: a quiet
 * square ghost button that only takes colour under the pointer, disclosed by
 * {@link ROW_ACTION_DISCLOSURE} on the row around it, and swapped for a spinner
 * while that row's mutation is in flight.
 *
 * The popup sizes to its labels (`w-auto`) instead of to the icon button it
 * hangs off — the copies this replaced disagreed about that, so the same menu
 * came out three different widths depending on which table you opened it from.
 */
export const RowActionsMenu = ({
  label,
  isPending = false,
  children,
}: {
  /** Names the row the menu belongs to, e.g. `Actions for API_URL`. */
  readonly label: string;
  readonly isPending?: boolean;
  readonly children: ReactNode;
}) => (
  <DropdownMenu>
    <DropdownMenu.Trigger
      render={
        <Button
          variant="ghost"
          shape="square"
          className="text-kumo-subtle/70 hover:text-kumo-default"
          disabled={isPending}
          aria-label={label}
        />
      }
    >
      {isPending ? <Loader size="sm" /> : <DotsThreeVerticalIcon weight="bold" />}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" className="w-auto">
      {children}
    </DropdownMenu.Content>
  </DropdownMenu>
);
