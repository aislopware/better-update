import type { ReactNode } from "react";

import { ListPanel, ListPanelFooter, ListPanelHeader } from "../../../../../lib/data-table";

/**
 * One bound credential on a project's credential detail page.
 *
 * These were drawn as tables — a header row of column names above exactly one
 * data row, four such tables stacked on an iOS page. A binding resolves to one
 * record or to none, and a record is a set of labelled facts rather than a list,
 * so the panel names the credential and lays its fields across the width the way
 * the Cloudflare dashboard shows a resource's attributes. Anything that is a
 * fact about the record as a whole — that it is protected — rides beside the
 * title; anything that acts on it goes in the header's action slot.
 */
export const CredentialSection = ({
  title,
  badges,
  actions,
  children,
}: {
  title: string;
  badges?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <ListPanel>
    <ListPanelHeader
      title={
        badges ? (
          <span className="flex items-center gap-2.5">
            {title}
            {badges}
          </span>
        ) : (
          title
        )
      }
      actions={actions}
    />
    {children}
  </ListPanel>
);

/** Nothing bound yet — the panel closes on the sentence saying so. */
export const EmptyBindingMessage = ({ message }: { message: string }) => (
  <ListPanelFooter>
    <span className="text-kumo-subtle text-sm">{message}</span>
  </ListPanelFooter>
);
