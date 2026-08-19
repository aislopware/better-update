/**
 * A `Request` shaped the way a Worker's `fetch` expects it.
 *
 * `new Request()` types its `cf` slot as the generic `CfProperties`, while
 * `ExportedHandler.fetch` takes the narrower `IncomingRequestCfProperties` the
 * edge attaches to a real inbound request — a shape nothing off the edge can
 * construct. These suites dispatch straight into `worker.fetch`, bypassing the
 * edge, so the narrowing is asserted once here instead of at every call site.
 */
export const incomingRequest = (
  url: string,
  init?: RequestInit,
): Request<unknown, IncomingRequestCfProperties> =>
  new Request(url, init) as Request<unknown, IncomingRequestCfProperties>;
