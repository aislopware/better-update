import { resolveVisibleAppsScope } from "./apple-users";

describe(resolveVisibleAppsScope, () => {
  it("leaves all apps visible for an empty list (the all-apps default)", () => {
    expect(resolveVisibleAppsScope([])).toStrictEqual({
      allAppsVisible: true,
      visibleApps: undefined,
    });
  });

  it("scopes to the given apps when the list is non-empty", () => {
    expect(resolveVisibleAppsScope(["app1", "app2"])).toStrictEqual({
      allAppsVisible: false,
      visibleApps: ["app1", "app2"],
    });
  });
});
