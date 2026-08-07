import { InputGroup } from "@better-update/ui/components/input-group";

import type { ComponentProps, ReactNode } from "react";

interface SlugInputProps extends Omit<ComponentProps<typeof InputGroup.Input>, "className"> {
  readonly addonStart: ReactNode;
  readonly className?: string;
}

/**
 * A slug field prefixed by the fixed part of the URL it becomes. The prefix is
 * a plain start addon — subdued text sharing the field's frame, the way Kumo
 * renders `@` or `/api/` — so the eye reads one address rather than two boxes.
 */
export const SlugInput = ({ addonStart, className, ...props }: SlugInputProps) => (
  <InputGroup className={className} data-slot="slug-input">
    <InputGroup.Addon>{addonStart}</InputGroup.Addon>
    {/* eslint-disable-next-line react/jsx-props-no-spreading -- thin pass-through wrapper */}
    <InputGroup.Input {...props} />
  </InputGroup>
);
