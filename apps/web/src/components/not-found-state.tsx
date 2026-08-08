import { Empty } from "@better-update/ui/components/empty";
import { CompassIcon } from "@phosphor-icons/react";

import { RouterLinkButton } from "../lib/router-link-button";

/**
 * The router's fallback for an address that resolves to nothing. It used to be
 * the words "Not found" in the top-left corner of an otherwise blank document,
 * which reads as a crash rather than as a page; a wrong URL is a routine thing
 * to type, so it gets the same empty-state surface as an empty list, and a way
 * back rather than only the news that there is nothing here.
 */
export const NotFoundState = () => (
  <div className="mx-auto flex w-full max-w-3xl flex-col p-8">
    <Empty
      icon={<CompassIcon className="text-kumo-inactive size-10" />}
      title="Page not found"
      description="This address does not match anything in the dashboard. It may have been renamed, or the resource it pointed at may have been deleted."
      contents={<RouterLinkButton to="/">Back to overview</RouterLinkButton>}
    />
  </div>
);
