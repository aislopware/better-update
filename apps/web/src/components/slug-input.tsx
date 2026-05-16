import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@better-update/ui/components/ui/input-group";

import type { InputProps } from "@better-update/ui/components/ui/input";
import type { ReactNode } from "react";

interface SlugInputProps extends Omit<InputProps, "className"> {
  readonly addonStart: ReactNode;
  readonly className?: string;
}

export const SlugInput = ({ addonStart, className, ...props }: SlugInputProps) => (
  <InputGroup className={className} data-slot="slug-input">
    <InputGroupAddon align="inline-start" className="border-input bg-muted/40 border-r ps-3 pe-2.5">
      <InputGroupText className="text-muted-foreground/72">{addonStart}</InputGroupText>
    </InputGroupAddon>
    {/* eslint-disable-next-line react/jsx-props-no-spreading -- thin pass-through wrapper */}
    <InputGroupInput {...props} />
  </InputGroup>
);
