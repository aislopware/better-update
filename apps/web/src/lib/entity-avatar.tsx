import { Avatar, AvatarFallback, AvatarImage } from "@better-update/ui/components/ui/avatar";

import { getAvatarColor, getInitial } from "./avatar";

interface EntityAvatarProps {
  readonly name: string;
  readonly seed?: string;
  readonly image?: string | null | undefined;
  readonly className?: string;
  readonly size?: "sm" | "default" | "lg";
  readonly shape?: "circle" | "square";
}

const joinClasses = (...parts: readonly (string | false | undefined)[]): string =>
  parts.filter(Boolean).join(" ");

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
  return (
    <Avatar size={size} className={joinClasses(isSquare && squareRoot, className)}>
      <AvatarImage src={src} alt={name} className={joinClasses(isSquare && squareChild)} />
      <AvatarFallback
        className={joinClasses("font-semibold text-white", isSquare && squareChild)}
        style={{ backgroundColor }}
      >
        {initial}
      </AvatarFallback>
    </Avatar>
  );
};
