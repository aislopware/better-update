// `member.role === "owner"` is the org root: unconditional allow, undeniable —
// the ONLY remaining use of the free-form member.role string (spec §1/§8). Exact
// equality (NOT comma-substring): a comma-joined role like "admin,owner" set via
// better-auth's updateMemberRole must NOT confer root, closing a privilege-
// escalation vector. owner is set once at org creation as exactly "owner".
//
// Kept in its own module (mirroring `superadmin.ts`) so the anti-escalation
// invariant is pinned by a colocated unit test — a future `.includes("owner")`
// regression would reopen the escalation vector while every other test stays green.
export const roleIsOwner = (roleSpec: string): boolean => roleSpec === "owner";
