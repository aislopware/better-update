import { compact } from "@better-update/type-guards";
import { Link } from "@tanstack/react-router";
import { forwardRef } from "react";

import type { LinkComponentProps } from "@cloudflare/kumo/utils";

/**
 * Kumo renders anchors through whatever component `LinkProvider` supplies, so
 * every `<Link>`, `<LinkButton>`, breadcrumb and sidebar item inside Kumo
 * navigates through TanStack Router instead of doing a full page load.
 */

/** Anything the router cannot own: absolute URLs, mail/tel, in-page anchors. */
const isExternalHref = (href: string): boolean =>
  href.startsWith("#") || /^[a-z][\w+.-]*:/iu.test(href);

export const KumoRouterLink = forwardRef<HTMLAnchorElement, LinkComponentProps>(
  // eslint-disable-next-line typescript/no-deprecated -- `to` is Kumo's deprecated alias for `href`; it is destructured only to keep it off the DOM
  ({ to, href, ...rest }, ref) => {
    const target = href ?? to;

    if (target === undefined || isExternalHref(target)) {
      // eslint-disable-next-line react/jsx-props-no-spreading, jsx-a11y/anchor-has-content -- thin pass-through wrapper; children arrive through the spread
      return <a ref={ref} href={target} {...rest} />;
    }

    // Anchor props arrive typed as `X | undefined`, which `Link` rejects under
    // exactOptionalPropertyTypes; dropping the undefined keys makes them optional.
    // eslint-disable-next-line react/jsx-props-no-spreading -- thin pass-through wrapper
    return <Link ref={ref} to={target} {...compact(rest)} />;
  },
);

KumoRouterLink.displayName = "KumoRouterLink";
