import { Effect } from "effect";

interface NamedResource {
  readonly id: string;
  readonly name: string;
}

export const resolveNamedResourceId = <Err>(
  params: {
    readonly items: readonly NamedResource[];
    readonly kind: string;
    readonly name: string;
  },
  makeError: (message: string) => Err,
): Effect.Effect<string, Err> =>
  Effect.gen(function* () {
    const match = params.items.find((item) => item.name === params.name);
    if (match === undefined) {
      return yield* Effect.fail(
        makeError(`${params.kind} "${params.name}" not found in the linked project.`),
      );
    }
    return match.id;
  });
