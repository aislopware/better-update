// Superadmin bootstrap + global-role helpers. Pure so they can be unit-tested
// without a Worker runtime. The Better Auth `admin` plugin stores the global
// role as a (potentially comma-separated) string; `role = "admin"` marks a
// superadmin who may approve other users.

export const parseSuperadminEmails = (raw: string | undefined): ReadonlySet<string> => {
  if (raw === undefined || raw.length === 0) {
    return new Set();
  }
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
};

export const isSuperadminEmail = (
  email: string | null | undefined,
  superadmins: ReadonlySet<string>,
): boolean => {
  if (!email) {
    return false;
  }
  return superadmins.has(email.trim().toLowerCase());
};

export const roleIsSuperadmin = (role: string | null | undefined): boolean => {
  if (!role) {
    return false;
  }
  return role
    .split(",")
    .map((part) => part.trim())
    .includes("admin");
};
