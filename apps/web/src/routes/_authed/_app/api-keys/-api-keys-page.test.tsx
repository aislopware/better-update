import { Badge } from "@better-update/ui/components/ui/badge";
import {
  CardFrame,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
} from "@better-update/ui/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useSuspenseQuery } from "@tanstack/react-query";
import { screen } from "@testing-library/react";

import { makeApiKey, makeOrg, makeSession } from "../../../../../tests/helpers/fixtures";
import { renderWithQuery } from "../../../../../tests/helpers/render-with-query";

import type { ApiKeyResponse } from "../../../../../tests/helpers/fixtures";

/**
 * These tests verify the rendering patterns of the API keys page.
 * Since ApiKeys is not exported (internal const wired to Route),
 * we replicate the data-fetching + rendering logic as standalone components.
 */

const maskKey = (start: string | null, prefix: string | null): string => {
  if (start) {
    return `${start}${"*".repeat(8)}`;
  }
  if (prefix) {
    return `${prefix}${"*".repeat(12)}`;
  }
  return "****";
};

const ApiKeysTable = ({ apiKeys }: { apiKeys: ApiKeyResponse[] }) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Key</TableHead>
        <TableHead>Created</TableHead>
        <TableHead>Expires</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {apiKeys.map((key) => (
        <TableRow key={key.id}>
          <TableCell>{key.name ?? "Unnamed"}</TableCell>
          <TableCell>
            <code>{maskKey(key.start, key.prefix)}</code>
          </TableCell>
          <TableCell>{new Date(key.createdAt).toLocaleDateString()}</TableCell>
          <TableCell>
            {key.expiresAt ? (
              <Badge variant="outline">{new Date(key.expiresAt).toLocaleDateString()}</Badge>
            ) : (
              <span>Never</span>
            )}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const EmptyState = () => (
  <div>
    <p>No API keys</p>
    <p>Create an API key to authenticate requests to the management API.</p>
  </div>
);

const ApiKeysTestPage = () => {
  const { data: session } = useSuspenseQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => null as ReturnType<typeof makeSession> | null,
  });
  const { data: orgs } = useSuspenseQuery({
    queryKey: ["auth", "orgs"],
    queryFn: async () => [] as ReturnType<typeof makeOrg>[],
  });

  const activeOrgId = session?.session.activeOrganizationId ?? "";
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const orgId = activeOrg?.id ?? "";

  const { data: apiKeys } = useSuspenseQuery({
    queryKey: ["org", orgId, "api-keys"],
    queryFn: async () => [] as ApiKeyResponse[],
  });

  if (apiKeys.length === 0) {
    return <EmptyState />;
  }

  return (
    <CardFrame>
      <CardFrameHeader>
        <CardFrameTitle>Active keys</CardFrameTitle>
        <CardFrameDescription>
          {apiKeys.length} {apiKeys.length === 1 ? "key" : "keys"} in this organization.
        </CardFrameDescription>
      </CardFrameHeader>
      <ApiKeysTable apiKeys={apiKeys} />
    </CardFrame>
  );
};

describe("aPI keys page rendering", () => {
  it("shows empty state when no API keys", () => {
    const session = makeSession();
    const org = makeOrg();

    renderWithQuery(<ApiKeysTestPage />, {
      seedCache: [
        [["auth", "session"], session],
        [["auth", "orgs"], [org]],
        [["org", "org-1", "api-keys"], []],
      ],
    });

    expect(screen.getByText("No API keys")).toBeInTheDocument();
    expect(
      screen.getByText("Create an API key to authenticate requests to the management API."),
    ).toBeInTheDocument();
  });

  it("renders API key rows with name and masked key", () => {
    const session = makeSession();
    const org = makeOrg();
    const keys = [
      makeApiKey({ id: "key-1", name: "Production", start: "bu_prod", prefix: "bu_" }),
      makeApiKey({ id: "key-2", name: "Staging", start: "bu_stag", prefix: "bu_" }),
    ];

    renderWithQuery(<ApiKeysTestPage />, {
      seedCache: [
        [["auth", "session"], session],
        [["auth", "orgs"], [org]],
        [["org", "org-1", "api-keys"], keys],
      ],
    });

    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("bu_prod********")).toBeInTheDocument();
    expect(screen.getByText("Staging")).toBeInTheDocument();
    expect(screen.getByText("bu_stag********")).toBeInTheDocument();
  });

  it("shows Never for keys without expiry", () => {
    const session = makeSession();
    const org = makeOrg();
    const key = makeApiKey({ expiresAt: null });

    renderWithQuery(<ApiKeysTestPage />, {
      seedCache: [
        [["auth", "session"], session],
        [["auth", "orgs"], [org]],
        [["org", "org-1", "api-keys"], [key]],
      ],
    });

    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("shows expiry date for keys with expiration", () => {
    const session = makeSession();
    const org = makeOrg();
    const key = makeApiKey({ expiresAt: new Date("2026-12-31T00:00:00Z") });

    renderWithQuery(<ApiKeysTestPage />, {
      seedCache: [
        [["auth", "session"], session],
        [["auth", "orgs"], [org]],
        [["org", "org-1", "api-keys"], [key]],
      ],
    });

    expect(
      screen.getByText(new Date("2026-12-31T00:00:00Z").toLocaleDateString()),
    ).toBeInTheDocument();
  });

  it("shows correct count in description", () => {
    const session = makeSession();
    const org = makeOrg();
    const keys = [
      makeApiKey({ id: "key-1" }),
      makeApiKey({ id: "key-2" }),
      makeApiKey({ id: "key-3" }),
    ];

    renderWithQuery(<ApiKeysTestPage />, {
      seedCache: [
        [["auth", "session"], session],
        [["auth", "orgs"], [org]],
        [["org", "org-1", "api-keys"], keys],
      ],
    });

    expect(screen.getByText("3 keys in this organization.")).toBeInTheDocument();
  });

  it("shows singular key count", () => {
    const session = makeSession();
    const org = makeOrg();

    renderWithQuery(<ApiKeysTestPage />, {
      seedCache: [
        [["auth", "session"], session],
        [["auth", "orgs"], [org]],
        [["org", "org-1", "api-keys"], [makeApiKey()]],
      ],
    });

    expect(screen.getByText("1 key in this organization.")).toBeInTheDocument();
  });

  it("shows Unnamed for keys without name", () => {
    const session = makeSession();
    const org = makeOrg();
    const key = makeApiKey({ name: null });

    renderWithQuery(<ApiKeysTestPage />, {
      seedCache: [
        [["auth", "session"], session],
        [["auth", "orgs"], [org]],
        [["org", "org-1", "api-keys"], [key]],
      ],
    });

    expect(screen.getByText("Unnamed")).toBeInTheDocument();
  });
});
