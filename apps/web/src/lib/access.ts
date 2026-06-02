// Client-side mirror of the server's superadmin/approval gate. The Better Auth
// `admin` plugin stores the global role as a (possibly comma-separated) string;
// `role = "admin"` marks a superadmin. Unapproved non-superadmins are held at
// `/pending-approval` until a superadmin approves them.

interface AccessUser {
  readonly role?: string | null | undefined;
  readonly approved?: boolean | null | undefined;
}

export const isSuperadminUser = (user: AccessUser): boolean =>
  typeof user.role === "string" &&
  user.role
    .split(",")
    .map((part) => part.trim())
    .includes("admin");

export const isApprovedUser = (user: AccessUser): boolean =>
  user.approved === true || isSuperadminUser(user);
