import { projectsQueryOptions } from "@better-update/api-client/react";
import { screen, within } from "@testing-library/react";

import type { AndroidUploadKeystoreItem } from "@better-update/api-client/react";

import { renderWithQuery } from "../../../../tests/helpers/render-with-query";
import { DROPDOWN_FETCH_LIMIT } from "../../../queries/constants";
import { AndroidUploadKeystoresTable } from "./-credentials-tables-android";

const SHA1 = "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD";
const SHA256 = "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88";

const makeKeystore = (
  overrides?: Partial<AndroidUploadKeystoreItem>,
): AndroidUploadKeystoreItem => ({
  id: "keystore-1",
  organizationId: "org-1",
  name: "Release keystore",
  keyAlias: "upload",
  md5Fingerprint: null,
  sha1Fingerprint: SHA1,
  sha256Fingerprint: SHA256,
  keystoreType: "JKS",
  protected: false,
  boundProjectIds: [],
  boundToAllProjects: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

const seedProjects = (): [readonly unknown[], unknown][] => [
  [
    projectsQueryOptions("org-1", { limit: DROPDOWN_FETCH_LIMIT, status: "all" }).queryKey,
    { items: [{ id: "project-1", name: "My App" }] },
  ],
];

const renderTable = (
  items: readonly AndroidUploadKeystoreItem[],
  canManageProtection = false,
): void => {
  renderWithQuery(
    <AndroidUploadKeystoresTable
      items={items}
      orgId="org-1"
      canManageProtection={canManageProtection}
    />,
    { seedCache: seedProjects() },
  );
};

describe(AndroidUploadKeystoresTable, () => {
  it("titles a named keystore by its name and keeps the alias underneath", () => {
    renderTable([makeKeystore()]);

    expect(screen.getByText("Release keystore")).toBeInTheDocument();
    expect(screen.getByText("upload · JKS")).toBeInTheDocument();
  });

  it("falls back to the alias when the keystore was uploaded without a name", () => {
    renderTable([makeKeystore({ name: null, keystoreType: "PKCS12" })]);

    expect(screen.getByText("upload")).toBeInTheDocument();
    expect(screen.getByText("PKCS12")).toBeInTheDocument();
  });

  it("abbreviates each fingerprint but copies the whole one", () => {
    renderTable([makeKeystore()]);

    expect(screen.getByTitle(SHA1)).toBeInTheDocument();
    expect(screen.getByTitle(SHA256)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy SHA-256" })).toBeInTheDocument();
  });

  // Rendered as an admin so the Protected column holds a switch: the read-only
  // badge draws a dash of its own and would be counted here.
  it("dashes a fingerprint the keystore never carried", () => {
    renderTable([makeKeystore({ sha1Fingerprint: null, sha256Fingerprint: null })], true);

    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Copy SHA-1" })).not.toBeInTheDocument();
  });

  it("surfaces an unbound keystore rather than hiding it, as the project pages do", async () => {
    renderTable([makeKeystore()]);

    await expect(screen.findByText("Not bound to any project")).resolves.toBeInTheDocument();
  });

  it("shows non-admins the protected state read-only, with no bindings menu", () => {
    renderTable([makeKeystore({ protected: true })]);

    // "Protected" is also the column header, so read the row, not the table.
    const row = screen.getByRole("row", { name: /Release keystore/u });
    expect(within(row).getByText("Protected")).toBeInTheDocument();
    expect(screen.queryByLabelText("Protect upload")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Actions for / })).not.toBeInTheDocument();
  });

  it("gives org admins the protection toggle and the bindings menu", () => {
    renderTable([makeKeystore({ protected: true })], true);

    expect(screen.getByLabelText("Protect upload")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Actions for / })).toBeInTheDocument();
  });
});
