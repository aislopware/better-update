import { Effect } from "effect";

export const asStringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export const asBooleanValue = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

export const asNumberValue = (raw: unknown): number | undefined =>
  typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;

export const shallowMerge = <T extends object>(
  base: T | undefined,
  overlay: T | undefined,
): T | undefined => {
  if (!base) {
    return overlay;
  }
  if (!overlay) {
    return base;
  }
  return { ...base, ...overlay };
};

export const stripExtends = <Profile extends { readonly extends?: string }>(
  profile: Profile,
): Omit<Profile, "extends"> => {
  if (profile.extends === undefined) {
    return profile;
  }
  const { extends: _omit, ...rest } = profile;
  return rest;
};

export const resolveExtendsChain = <
  Profile extends { readonly extends?: string },
  MakeErr,
>(params: {
  readonly profiles: Record<string, Profile>;
  readonly profileName: string;
  readonly label: "build" | "submit";
  readonly maxDepth: number;
  readonly makeError: (message: string) => MakeErr;
}): Effect.Effect<readonly Profile[], MakeErr> =>
  Effect.gen(function* () {
    const { profiles, profileName, label, maxDepth, makeError } = params;
    const noun = label === "build" ? "Build" : "Submit";
    const chain: Profile[] = [];
    const visited = new Set<string>();
    let current: string | undefined = profileName;
    let depth = 0;
    while (current !== undefined) {
      if (visited.has(current)) {
        return yield* Effect.fail(
          makeError(
            `Cycle detected in eas.json ${label}.${profileName} extends chain at "${current}".`,
          ),
        );
      }
      visited.add(current);
      const profile: Profile | undefined = profiles[current];
      if (!profile) {
        return yield* Effect.fail(
          makeError(
            current === profileName
              ? `${noun} profile "${profileName}" not found in eas.json.`
              : `${noun} profile "${profileName}" extends missing profile "${current}".`,
          ),
        );
      }
      chain.unshift(profile);
      current = profile.extends;
      depth += 1;
      if (depth > maxDepth) {
        return yield* Effect.fail(
          makeError(
            `Too many "extends" levels (max ${String(maxDepth)}) in eas.json ${label}.${profileName}.`,
          ),
        );
      }
    }
    return chain;
  });
