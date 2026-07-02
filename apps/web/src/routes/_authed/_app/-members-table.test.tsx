import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { SortingState } from "@tanstack/react-table";

import { makeInvitation, makeMember } from "../../../../tests/helpers/fixtures";
import { renderWithQuery } from "../../../../tests/helpers/render-with-query";
import { MembersTableView } from "./-members-table";

const noopSorting: SortingState = [];
const noopOnSortingChange = () => {};

const ownerMember = makeMember({
  id: "member-owner",
  userId: "user-owner",
  role: "owner",
  user: { id: "user-owner", name: "Alice Owner", email: "alice@example.com", image: null },
});

// Post-collapse, every non-owner member is role "member"; admin/developer/viewer
// powers come from policy attachments, not the role string. `user-capable` is a
// role-"member" principal who holds member-management policies (capability flows
// in via the per-action `canRemoveMembers`/`canManagePolicies` flags, NOT a role).
const capableMember = makeMember({
  id: "member-capable",
  userId: "user-capable",
  role: "member",
  user: { id: "user-capable", name: "Bob Capable", email: "bob@example.com", image: null },
});

const regularMember = makeMember({
  id: "member-regular",
  userId: "user-regular",
  role: "member",
  user: { id: "user-regular", name: "Carol Member", email: "carol@example.com", image: null },
});

const allMembers = [ownerMember, capableMember, regularMember];

describe(MembersTableView, () => {
  const onRemove = vi.fn<(memberId: string) => void>();
  const onCancelInvitation = vi.fn<(invitationId: string) => Promise<void>>(async () => {});

  it("renders member rows with name, email, role badge, and status", () => {
    renderWithQuery(
      <MembersTableView
        orgId="org-1"
        members={allMembers}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        currentUserId="user-owner"
        canRemoveMembers
        canManagePolicies
      />,
    );

    expect(screen.getByText("Alice Owner")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    // The role column collapses to an Owner / Member badge — admin/developer/viewer
    // are no longer member roles (they are policy attachments).
    expect(screen.getByText("Owner")).toBeInTheDocument();

    expect(screen.getByText("Bob Capable")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();

    expect(screen.getByText("Carol Member")).toBeInTheDocument();
    expect(screen.getByText("carol@example.com")).toBeInTheDocument();
    // Two non-owner members → two "Member" role badges. The third "Member" match
    // is the name-column header (a <th>); keep only matches inside a body cell
    // (<td>) so we count the in-row role badges, not the header.
    const memberRoleCells = screen
      .getAllByText("Member")
      .filter((node) => node.closest("td") !== null);
    expect(memberRoleCells).toHaveLength(2);

    expect(screen.getAllByText("Active")).toHaveLength(allMembers.length);
  });

  it("capable actor sees action buttons for non-owner members", () => {
    renderWithQuery(
      <MembersTableView
        orgId="org-1"
        members={allMembers}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        currentUserId="user-owner"
        canRemoveMembers
        canManagePolicies
      />,
    );

    const actionButtons = screen.getAllByRole("button", { name: "Member actions" });
    expect(actionButtons).toHaveLength(2);
  });

  it("never renders actions for the owner row", () => {
    renderWithQuery(
      <MembersTableView
        orgId="org-1"
        members={[ownerMember]}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        currentUserId="user-owner"
        canRemoveMembers
        canManagePolicies
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("an actor with no member-management capability sees NO action dropdowns", () => {
    renderWithQuery(
      <MembersTableView
        orgId="org-1"
        members={allMembers}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        currentUserId="user-regular"
        canRemoveMembers={false}
        canManagePolicies={false}
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("a capable non-owner sees Manage policies, never role-change items, never self-remove", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <MembersTableView
        orgId="org-1"
        members={allMembers}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        currentUserId="user-capable"
        canRemoveMembers
        canManagePolicies
      />,
    );

    // The capable actor manages non-owner members (capable + regular) but never the
    // owner row (owner is undeniable root; policies are inert on it).
    const actionButtons = screen.getAllByRole("button", { name: "Member actions" });
    expect(actionButtons).toHaveLength(2);

    // First menu is the actor's own row (sorted owner→members; owner has no menu):
    // it exposes Manage policies but NOT Remove (cannot remove self), and never any
    // role-change item (those are gone post-collapse).
    await user.click(actionButtons[0]!);
    await expect(
      screen.findByRole("menuitem", { name: /manage access/i }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /remove member/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /set as admin/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /set as member/i })).not.toBeInTheDocument();
  });

  it("a capable non-owner can Remove a different non-owner member", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <MembersTableView
        orgId="org-1"
        members={allMembers}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        currentUserId="user-capable"
        canRemoveMembers
        canManagePolicies
      />,
    );

    // Second menu is the OTHER non-owner member (Carol) — Remove is available there.
    const actionButtons = screen.getAllByRole("button", { name: "Member actions" });
    await user.click(actionButtons[1]!);
    await user.click(await screen.findByRole("menuitem", { name: /remove member/i }));

    expect(onRemove).toHaveBeenCalledWith("member-regular");
  });

  it("renders invitation rows with email, status, and expiry", () => {
    const invitation = makeInvitation({
      email: "new-hire@example.com",
      role: "member",
      expiresAt: new Date("2099-06-15"),
    });

    renderWithQuery(
      <MembersTableView
        orgId="org-1"
        members={[]}
        invitations={[invitation]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        currentUserId="user-owner"
        canRemoveMembers
        canManagePolicies
      />,
    );

    expect(screen.getByText("new-hire@example.com")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText(/^Expires/)).toBeInTheDocument();
  });

  it("cancel invitation menu item calls onCancelInvitation with invitation id", async () => {
    const user = userEvent.setup();
    const invitation = makeInvitation({ id: "inv-42" });

    renderWithQuery(
      <MembersTableView
        orgId="org-1"
        members={[]}
        invitations={[invitation]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        currentUserId="user-owner"
        canRemoveMembers
        canManagePolicies
      />,
    );

    await user.click(screen.getByRole("button", { name: /invitation actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /cancel invitation/i }));

    expect(onCancelInvitation).toHaveBeenCalledWith("inv-42");
  });
});
