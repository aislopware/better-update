import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeInvitation, makeMember } from "../../../../tests/helpers/fixtures";
import { InvitationsTableView, MembersTableView } from "./-members-table";

const ownerMember = makeMember({
  id: "member-owner",
  userId: "user-owner",
  role: "owner",
  user: { id: "user-owner", name: "Alice Owner", email: "alice@example.com", image: null },
});

const adminMember = makeMember({
  id: "member-admin",
  userId: "user-admin",
  role: "admin",
  user: { id: "user-admin", name: "Bob Admin", email: "bob@example.com", image: null },
});

const regularMember = makeMember({
  id: "member-regular",
  userId: "user-regular",
  role: "member",
  user: { id: "user-regular", name: "Carol Member", email: "carol@example.com", image: null },
});

const allMembers = [ownerMember, adminMember, regularMember];

describe(MembersTableView, () => {
  const onRoleChange = vi.fn<(memberId: string, role: string) => Promise<void>>(async () => {});
  const onRemove = vi.fn<(memberId: string) => void>();

  it("renders member rows with name, email, and role badge", () => {
    render(
      <MembersTableView
        members={allMembers}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
        currentUserId="user-owner"
        currentRole="owner"
      />,
    );

    expect(screen.getByText("Alice Owner")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("owner")).toBeInTheDocument();

    expect(screen.getByText("Bob Admin")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();

    expect(screen.getByText("Carol Member")).toBeInTheDocument();
    expect(screen.getByText("carol@example.com")).toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
  });

  it("owner sees action buttons for non-owner members", () => {
    render(
      <MembersTableView
        members={allMembers}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
        currentUserId="user-owner"
        currentRole="owner"
      />,
    );

    // There should be one trigger button per manageable non-owner member.
    const actionButtons = screen.getAllByRole("button");
    expect(actionButtons.length).toBeGreaterThanOrEqual(2);
  });

  it("owner does NOT see actions for self", () => {
    render(
      <MembersTableView
        members={[ownerMember]}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
        currentUserId="user-owner"
        currentRole="owner"
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("member (non-owner) sees NO action dropdowns", () => {
    render(
      <MembersTableView
        members={allMembers}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
        currentUserId="user-regular"
        currentRole="member"
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("admin does NOT see actions (only owner can manage)", () => {
    render(
      <MembersTableView
        members={allMembers}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
        currentUserId="user-admin"
        currentRole="admin"
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe(InvitationsTableView, () => {
  it("renders invitation rows with email, role, and expiry", () => {
    const invitation = makeInvitation({
      email: "new-hire@example.com",
      role: "admin",
      expiresAt: new Date("2099-06-15"),
    });

    const onCancel = vi.fn<(invitationId: string) => Promise<void>>(async () => {});
    render(<InvitationsTableView invitations={[invitation]} onCancel={onCancel} />);

    expect(screen.getByText("new-hire@example.com")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    // Expiry rendered as relative future time (e.g., "Expires in 26781 days").
    expect(screen.getByText(/^Expires/)).toBeInTheDocument();
  });

  it("cancel invitation menu item calls onCancel with invitation id", async () => {
    const user = userEvent.setup();
    const invitation = makeInvitation({ id: "inv-42" });
    const onCancel = vi.fn<(invitationId: string) => Promise<void>>(async () => {});

    render(<InvitationsTableView invitations={[invitation]} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: /invitation actions/i }));
    await user.click(await screen.findByRole("menuitem", { name: /cancel invitation/i }));

    expect(onCancel).toHaveBeenCalledWith("inv-42");
  });
});
