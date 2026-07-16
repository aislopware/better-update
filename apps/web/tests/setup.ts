import "@testing-library/jest-dom/vitest";

// jsdom ships neither ResizeObserver nor scrollIntoView; cmdk (Command) and
// the base-ui positioners need both to mount. No-op stubs are enough — no
// test asserts on layout. The stub must be a real constructible class:
// floating-ui does `new ResizeObserver(...)`.
class ResizeObserverStub {
  public readonly observe: () => void;
  public readonly unobserve: () => void;
  public readonly disconnect: () => void;
  public constructor() {
    this.observe = () => {};
    this.unobserve = () => {};
    this.disconnect = () => {};
  }
}
globalThis.ResizeObserver = ResizeObserverStub;
Element.prototype.scrollIntoView = () => {};
