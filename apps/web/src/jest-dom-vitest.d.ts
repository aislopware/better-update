// jest-dom's own `@testing-library/jest-dom/vitest` types still augment
// vitest's pre-5 `Assertion<T>`. Vitest 5 made it `Assertion<R, T>`, so that
// augmentation now binds the matchers' return type to the received value and
// `await expect(…).resolves.toBeInTheDocument()` awaits a non-promise. Augment
// `Matchers<R, T>` (which `Assertion` extends) instead: names and arity must
// match vitest's declaration for the merge to take. The runtime half —
// `expect.extend` — stays in `tests/setup.ts`.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  // eslint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- module augmentation: the matchers merge into vitest's interface only through an interface declaration, which has no members of its own
  interface Matchers<R, T> extends TestingLibraryMatchers<unknown, R> {}
}
