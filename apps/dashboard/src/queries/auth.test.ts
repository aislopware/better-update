import { sessionQueryOptions, orgsQueryOptions } from "./auth";

describe("session query options", () => {
  test("has correct queryKey", () => {
    expect(sessionQueryOptions.queryKey).toEqual(["auth", "session"]);
  });

  test("has 5 minute staleTime", () => {
    expect(sessionQueryOptions.staleTime).toBe(5 * 60 * 1000);
  });

  test("has queryFn defined", () => {
    expect(sessionQueryOptions.queryFn).toBeDefined();
  });

  test("does not refetch on mount", () => {
    expect(sessionQueryOptions.refetchOnMount).toBe(false);
  });

  test("does not refetch on window focus", () => {
    expect(sessionQueryOptions.refetchOnWindowFocus).toBe(false);
  });
});

describe("orgs query options", () => {
  test("has correct queryKey", () => {
    expect(orgsQueryOptions.queryKey).toEqual(["auth", "orgs"]);
  });

  test("has 5 minute staleTime", () => {
    expect(orgsQueryOptions.staleTime).toBe(5 * 60 * 1000);
  });

  test("has queryFn defined", () => {
    expect(orgsQueryOptions.queryFn).toBeDefined();
  });
});
