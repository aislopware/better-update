import type { ReactNode } from "react";

import { TablePanel } from "../../../../../components/table-panel";

/**
 * One bound credential on a project's credential detail page. Single-row lists,
 * so there is no count to close on — the panel is the title and the row it
 * names, nothing else.
 */
export const CredentialSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <TablePanel title={title}>{children}</TablePanel>
);

export const EmptyBindingMessage = ({ message }: { message: string }) => (
  <p className="text-kumo-subtle m-0 px-4 py-3 text-sm">{message}</p>
);
