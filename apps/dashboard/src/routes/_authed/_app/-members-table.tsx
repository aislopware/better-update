import { Avatar, AvatarFallback, AvatarImage } from "@better-update/ui/components/ui/avatar";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import {
  MoreVerticalIcon,
  UserRemove01Icon,
  Shield01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

const roleBadgeVariant = (role: string): "default" | "secondary" | "outline" => {
  if (role === "owner") {
    return "default";
  }
  if (role === "admin") {
    return "secondary";
  }
  return "outline";
};

const canManageRole = (currentRole: string, targetRole: string): boolean =>
  currentRole === "owner" && targetRole !== "owner";

const MemberActions = ({
  memberId,
  memberRole,
  currentRole,
  isSelf,
  onRoleChange,
  onRemove,
}: {
  memberId: string;
  memberRole: string;
  currentRole: string;
  isSelf: boolean;
  onRoleChange: (memberId: string, role: string) => Promise<void>;
  onRemove: (memberId: string) => void;
}) => {
  if (isSelf || !canManageRole(currentRole, memberRole)) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button variant="ghost" size="icon-sm">
          <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {memberRole === "admin" ? null : (
          <DropdownMenuItem onClick={async () => onRoleChange(memberId, "admin")}>
            <HugeiconsIcon icon={Shield01Icon} strokeWidth={2} className="size-4" />
            <span>Set as Admin</span>
          </DropdownMenuItem>
        )}
        {memberRole === "member" ? null : (
          <DropdownMenuItem onClick={async () => onRoleChange(memberId, "member")}>
            <HugeiconsIcon icon={Shield01Icon} strokeWidth={2} className="size-4" />
            <span>Set as Member</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive"
          onClick={() => {
            onRemove(memberId);
          }}
        >
          <HugeiconsIcon icon={UserRemove01Icon} strokeWidth={2} className="size-4" />
          <span>Remove member</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const MemberInfo = ({
  name,
  email,
  image,
}: {
  name: string;
  email: string;
  image?: string | null | undefined;
}) => (
  <div className="flex items-center gap-3">
    <Avatar className="size-8">
      <AvatarImage src={image ?? undefined} alt={name} />
      <AvatarFallback>{getInitials(name || "U")}</AvatarFallback>
    </Avatar>
    <div>
      <p className="leading-none font-medium">{name}</p>
      <p className="text-muted-foreground text-xs">{email}</p>
    </div>
  </div>
);

export const MembersTableView = ({
  members,
  currentUserId,
  currentRole,
  onRoleChange,
  onRemove,
}: {
  members: {
    id: string;
    userId: string;
    role: string;
    createdAt: Date;
    user: { id: string; name: string; email: string; image?: string | null | undefined };
  }[];
  currentUserId: string;
  currentRole: string;
  onRoleChange: (memberId: string, role: string) => Promise<void>;
  onRemove: (memberId: string) => void;
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Member</TableHead>
        <TableHead>Role</TableHead>
        <TableHead>Joined</TableHead>
        <TableHead className="w-12" />
      </TableRow>
    </TableHeader>
    <TableBody>
      {members.map((member) => (
        <TableRow key={member.id}>
          <TableCell>
            <MemberInfo
              name={member.user.name}
              email={member.user.email}
              image={member.user.image}
            />
          </TableCell>
          <TableCell>
            <Badge variant={roleBadgeVariant(member.role)}>{member.role}</Badge>
          </TableCell>
          <TableCell className="text-muted-foreground">
            {new Date(member.createdAt).toLocaleDateString()}
          </TableCell>
          <TableCell>
            <MemberActions
              memberId={member.id}
              memberRole={member.role}
              currentRole={currentRole}
              isSelf={member.userId === currentUserId}
              onRoleChange={onRoleChange}
              onRemove={onRemove}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const InvitationsTableView = ({
  invitations,
  onCancel,
}: {
  invitations: {
    id: string;
    email: string;
    role: string;
    status: string;
    expiresAt: Date;
  }[];
  onCancel: (invitationId: string) => Promise<void>;
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Email</TableHead>
        <TableHead>Role</TableHead>
        <TableHead>Expires</TableHead>
        <TableHead className="w-12" />
      </TableRow>
    </TableHeader>
    <TableBody>
      {invitations.map((invitation) => (
        <TableRow key={invitation.id}>
          <TableCell className="font-medium">{invitation.email}</TableCell>
          <TableCell>
            <Badge variant={roleBadgeVariant(invitation.role)}>{invitation.role}</Badge>
          </TableCell>
          <TableCell className="text-muted-foreground">
            {new Date(invitation.expiresAt).toLocaleDateString()}
          </TableCell>
          <TableCell>
            <Button variant="ghost" size="icon-sm" onClick={async () => onCancel(invitation.id)}>
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
            </Button>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
