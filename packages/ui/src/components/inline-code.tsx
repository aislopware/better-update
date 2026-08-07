import type { ComponentProps } from "react";

import { cn } from "#/lib/utils";

/**
 * A monospaced run inside a sentence: the variable key in "Delete `API_KEY`?",
 * the command in "Run `better-update env pull` from the CLI".
 *
 * Hand-written: Kumo ships no inline code. The one thing it must get right is
 * the size — `0.9em` rather than a fixed step, because Geist Mono runs wider
 * and taller than Geist at the same nominal size, so a token set to match its
 * sentence overpowers it. Being relative, it also tracks whatever it is nested
 * in: a dialog title, a card description, a paragraph.
 *
 * Bare by default. Pass a tint (`bg-kumo-tint/72 rounded px-1`) only where the
 * code is a literal being quoted for the reader to copy out, not where it is
 * simply the name of the thing the sentence is about.
 */
export const InlineCode = ({ className, ...props }: ComponentProps<"code">) => (
  <code
    data-slot="inline-code"
    // eslint-disable-next-line react/jsx-props-no-spreading -- chrome wrapper over a plain code
    {...props}
    className={cn("font-mono text-[0.9em]", className)}
  />
);
