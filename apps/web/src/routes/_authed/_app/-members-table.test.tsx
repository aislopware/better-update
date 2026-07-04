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

// Post-collapse, every non-owner member is role "member". `user-capable` is a
// role-"member" principal who holds member-management capability (capability
// flows in via the per-action `canRemoveMembers` flag, NOT a role).
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

const adminMember = makeMember({
  id: "member-admin",
  userId: "user-admin",
  role: "admin",
  user: { id: "user-admin", name: "Dave Admin", email: "dave@example.com", image: null },
});

describe(MembersTableView, () => {
  const onRemove = vi.fn<(memberId: string) => void>();
  const onCancelInvitation = vi.fn<(invitationId: string) => Promise<void>>(async () => {});
  const onRoleChange = vi.fn<(memberId: string, role: "admin" | "member") => void>();

  it("renders member rows with name, email, role badge, and status", () => {
    renderWithQuery(
      <MembersTableView
        members={allMembers}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        onRoleChange={onRoleChange}
        currentUserId="user-owner"
        canRemoveMembers
      />,
    );

    expect(screen.getByText("Alice Owner")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    // The role column collapses to an Owner / Member badge.
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
        members={allMembers}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        onRoleChange={onRoleChange}
        currentUserId="user-owner"
        canRemoveMembers
      />,
    );

    const actionButtons = screen.getAllByRole("button", { name: "Member actions" });
    expect(actionButtons).toHaveLength(2);
  });

  it("never renders actions for the owner row", () => {
    renderWithQuery(
      <MembersTableView
        members={[ownerMember]}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        onRoleChange={onRoleChange}
        currentUserId="user-owner"
        canRemoveMembers
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("an actor with no member-management capability sees NO action dropdowns", () => {
    renderWithQuery(
      <MembersTableView
        members={allMembers}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        onRoleChange={onRoleChange}
        currentUserId="user-regular"
        canRemoveMembers={false}
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("a capable non-owner never sees actions on their own row (no self-remove)", () => {
    renderWithQuery(
      <MembersTableView
        members={allMembers}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        onRoleChange={onRoleChange}
        currentUserId="user-capable"
        canRemoveMembers
      />,
    );

    // The capable actor can act on the OTHER non-owner member only: never the
    // owner row (owner is undeniable root) and never their own row (no
    // self-remove) — so exactly one action menu renders.
    const actionButtons = screen.getAllByRole("button", { name: "Member actions" });
    expect(actionButtons).toHaveLength(1);
  });

  it("a capable non-owner can Remove a different non-owner member", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <MembersTableView
        members={allMembers}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        onRoleChange={onRoleChange}
        currentUserId="user-capable"
        canRemoveMembers
      />,
    );

    // The only menu is the OTHER non-owner member (Carol) — Remove is available there.
    const actionButtons = screen.getAllByRole("button", { name: "Member actions" });
    await user.click(actionButtons[0]!);
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
        members={[]}
        invitations={[invitation]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        onRoleChange={onRoleChange}
        currentUserId="user-owner"
        canRemoveMembers
      />,
    );

    expect(screen.getByText("new-hire@example.com")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText(/^Expires/)).toBeInTheDocument();
  });

  it("without canEditOrgRoles every row shows a static role badge, no selects", () => {
    renderWithQuery(
      <MembersTableView
        members={[ownerMember, adminMember, regularMember]}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        onRoleChange={onRoleChange}
        currentUserId="user-regular"
        canRemoveMembers={false}
        canEditOrgRoles={false}
      />,
    );

    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.queryByLabelText(/change role for/i)).not.toBeInTheDocument();
  });

  it("with canEditOrgRoles non-owner rows render a role select; the owner row stays a badge", () => {
    renderWithQuery(
      <MembersTableView
        members={[ownerMember, adminMember, regularMember]}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        onRoleChange={onRoleChange}
        currentUserId="user-owner"
        canRemoveMembers
        canEditOrgRoles
      />,
    );

    expect(screen.getByLabelText("Change role for Dave Admin")).toBeInTheDocument();
    expect(screen.getByLabelText("Change role for Carol Member")).toBeInTheDocument();
    // Owner rows are never editable here (owner transfer is a separate flow).
    expect(screen.queryByLabelText("Change role for Alice Owner")).not.toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
  });

  it("selecting a new role calls onRoleChange with the member id", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <MembersTableView
        members={[ownerMember, regularMember]}
        invitations={[]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        onRoleChange={onRoleChange}
        currentUserId="user-owner"
        canRemoveMembers
        canEditOrgRoles
      />,
    );

    await user.click(screen.getByLabelText("Change role for Carol Member"));
    await user.click(await screen.findByRole("option", { name: "Admin" }));

    expect(onRoleChange).toHaveBeenCalledWith("member-regular", "admin");
  });

  it("cancel invitation menu item calls onCancelInvitation with invitation id", async () => {
    const user = userEvent.setup();
    const invitation = makeInvitation({ id: "inv-42" });

    renderWithQuery(
      <MembersTableView
        members={[]}
        invitations={[invitation]}
        sorting={noopSorting}
        onSortingChange={noopOnSortingChange}
        onRemove={onRemove}
        onCancelInvitation={onCancelInvitation}
        onRoleChange={onRoleChange}
        currentUserId="user-owner"
        canRemoveMembers
      />,
    );

    await user.click(screen.getByRole("button", { name: /invitation actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /cancel invitation/i }));

    expect(onCancelInvitation).toHaveBeenCalledWith("inv-42");
  });
});
