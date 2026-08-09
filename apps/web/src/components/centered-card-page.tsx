import { Card, CardContent } from "@better-update/ui/components/card";

import type { ReactNode } from "react";

import { BrandWordmark } from "./brand-mark";

/**
 * A page that is one card and nothing else: accepting an invitation, waiting on
 * approval, a CLI sign-in that failed, naming your first organization. There is
 * no shell around them — no nav, no org — so the wordmark stands in for it and
 * says whose page this is.
 *
 * Written four times before this, and drifting: two horizontal paddings, two
 * vertical ones, and `relative overflow-hidden` with a `z-10` layer inside it in
 * all four — the remains of a background flourish that was taken out from under
 * them and left nothing to stack against.
 */
export const CenteredCardPage = ({
  children,
  /** Anything that belongs under the card rather than in it — who you are signed in as, a way back. */
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) => (
  <div className="bg-kumo-canvas flex min-h-dvh flex-col items-center justify-center px-4 py-12">
    <div className="flex w-full max-w-md flex-col items-center gap-6">
      <BrandWordmark />
      <Card className="w-full">{children}</Card>
      {footer}
    </div>
  </div>
);

/**
 * Body of a card that reports an outcome rather than asking for anything: a
 * medallion, what happened, and the one way onward — stacked on the centre line,
 * because there is no second column of content for a left edge to line up with.
 */
export const CenteredCardBody = ({ children }: { children: ReactNode }) => (
  <CardContent className="flex flex-col items-center gap-4 p-8 text-center">{children}</CardContent>
);
