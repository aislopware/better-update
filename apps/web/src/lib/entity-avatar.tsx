import { Avatar, AvatarFallback, AvatarImage } from "@better-update/ui/components/ui/avatar";
import { cn } from "@better-update/ui/lib/utils";

import { getAvatarColor, getInitial } from "./avatar";

const SIZE_CLASS = {
  sm: "size-6 text-[10px]",
  default: "size-8",
  lg: "size-10 text-sm",
} as const;

interface EntityAvatarProps {
  readonly name: string;
  readonly seed?: string;
  readonly image?: string | null | undefined;
  readonly className?: string;
  readonly size?: "sm" | "default" | "lg";
  readonly shape?: "circle" | "square";
}

export const EntityAvatar = ({
  name,
  seed,
  image,
  className,
  size = "default",
  shape = "circle",
}: EntityAvatarProps) => {
  // eslint-disable-next-line eslint-js/no-restricted-syntax -- DOM prop coercion; AvatarImage src typed string | undefined
  const src = image ?? undefined;
  const hashSeed = seed ?? name;
  const backgroundColor = getAvatarColor(hashSeed);
  const initial = getInitial(hashSeed);
  const isSquare = shape === "square";
  const squareRoot = "rounded-md! after:rounded-md!";
  const squareChild = "rounded-md!";
  const sizeClass = SIZE_CLASS[size];
  return (
    <Avatar className={cn(sizeClass, isSquare && squareRoot, className)}>
      <AvatarImage src={src} alt={name} className={cn(isSquare && squareChild)} />
      <AvatarFallback
        className={cn("font-semibold text-white!", isSquare && squareChild)}
        style={{ backgroundColor }}
      >
        {initial}
      </AvatarFallback>
    </Avatar>
  );
};
