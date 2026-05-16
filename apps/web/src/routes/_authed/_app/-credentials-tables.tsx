import { Button } from "@better-update/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  Menu,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import {
  BellRingIcon,
  CloudIcon,
  EllipsisVerticalIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UsersRoundIcon,
} from "lucide-react";

import type {
  AppleDistributionCertificateItem,
  ApplePushKeyItem,
  AppleTeamItem,
  AscApiKeyItem,
  GoogleServiceAccountKeyItem,
} from "@better-update/api-client/react";

import { formatAppleTeamLabel } from "./-credentials-utils";
import { ConfirmDeleteDialog } from "./projects/$projectSlug/-confirm-delete-dialog";

const formatDate = (value: string) => new Date(value).toLocaleDateString();

const deleteIconButton = (
  <Button variant="ghost" size="icon" aria-label="Delete">
    <Trash2Icon strokeWidth={2} />
  </Button>
);

interface DeleteActionProps {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly onConfirm: () => Promise<unknown>;
  readonly onSuccess: () => Promise<void>;
  readonly successMessage: string;
}

const DeleteAction = (props: DeleteActionProps) => (
  <ConfirmDeleteDialog
    name={props.name}
    title={props.title}
    description={props.description}
    onConfirm={props.onConfirm}
    successMessage={props.successMessage}
    onSuccess={props.onSuccess}
  >
    {deleteIconButton}
  </ConfirmDeleteDialog>
);

export const DistributionCertificatesEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <ShieldCheckIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No distribution certificates</EmptyTitle>
      <EmptyDescription>
        Upload a .p12 certificate to sign iOS builds for the App Store or ad-hoc distribution.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const DistributionCertificatesTable = ({
  items,
  onDelete,
  onInvalidate,
}: {
  items: readonly AppleDistributionCertificateItem[];
  onDelete: (id: string) => Promise<unknown>;
  onInvalidate: () => Promise<void>;
}) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Serial</TableHead>
        <TableHead>Valid until</TableHead>
        <TableHead className="w-12" aria-label="Actions" />
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((cert) => (
        <TableRow key={cert.id}>
          <TableCell className="font-mono text-xs">{cert.serialNumber}</TableCell>
          <TableCell>{formatDate(cert.validUntil)}</TableCell>
          <TableCell className="text-right">
            <DeleteAction
              name={cert.serialNumber.slice(0, 8)}
              title="Delete distribution certificate?"
              description="This permanently removes the cert and its encrypted archive."
              onConfirm={async () => onDelete(cert.id)}
              successMessage="Certificate deleted"
              onSuccess={onInvalidate}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const PushKeysEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <BellRingIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No push keys</EmptyTitle>
      <EmptyDescription>
        Upload an APNs .p8 key to send push notifications from the Apple Push Notification service.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const PushKeysTable = ({
  items,
  onDelete,
  onInvalidate,
}: {
  items: readonly ApplePushKeyItem[];
  onDelete: (id: string) => Promise<unknown>;
  onInvalidate: () => Promise<void>;
}) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Key ID</TableHead>
        <TableHead>Added</TableHead>
        <TableHead className="w-12" aria-label="Actions" />
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell className="font-mono">{key.keyId}</TableCell>
          <TableCell>{formatDate(key.createdAt)}</TableCell>
          <TableCell className="text-right">
            <DeleteAction
              name={key.keyId}
              title="Delete push key?"
              description="This permanently removes the .p8 key."
              onConfirm={async () => onDelete(key.id)}
              successMessage="Push key deleted"
              onSuccess={onInvalidate}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const AscApiKeysEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <KeyRoundIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No App Store Connect API keys</EmptyTitle>
      <EmptyDescription>
        Upload an ASC .p8 key to automate App Store Connect operations like device sync.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const AscApiKeyActions = ({
  keyId,
  onSync,
  syncPending,
  onDelete,
  onInvalidate,
}: {
  keyId: string;
  onSync: () => void;
  syncPending: boolean;
  onDelete: () => Promise<unknown>;
  onInvalidate: () => Promise<void>;
}) => (
  <Menu>
    <MenuTrigger render={<Button variant="ghost" size="icon" aria-label="ASC key actions" />}>
      <EllipsisVerticalIcon strokeWidth={2} />
    </MenuTrigger>
    <MenuPopup align="end">
      <MenuGroup>
        <MenuItem disabled={syncPending} onClick={onSync}>
          <RefreshCwIcon strokeWidth={2} />
          <span>Sync devices</span>
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup>
        <ConfirmDeleteDialog
          name={keyId}
          title="Delete ASC API key?"
          description="This permanently removes the .p8 key."
          onConfirm={onDelete}
          successMessage="ASC API key deleted"
          onSuccess={onInvalidate}
        >
          <MenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
            }}
          >
            <Trash2Icon strokeWidth={2} />
            <span>Delete</span>
          </MenuItem>
        </ConfirmDeleteDialog>
      </MenuGroup>
    </MenuPopup>
  </Menu>
);

export const AscApiKeysTable = ({
  items,
  onDelete,
  onInvalidate,
  onSync,
  syncPending,
}: {
  items: readonly AscApiKeyItem[];
  onDelete: (id: string) => Promise<unknown>;
  onInvalidate: () => Promise<void>;
  onSync: (id: string) => void;
  syncPending: boolean;
}) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Key ID</TableHead>
        <TableHead className="w-12" aria-label="Actions" />
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell className="font-medium">{key.name}</TableCell>
          <TableCell className="font-mono">{key.keyId}</TableCell>
          <TableCell className="text-right">
            <AscApiKeyActions
              keyId={key.keyId}
              onSync={() => {
                onSync(key.id);
              }}
              syncPending={syncPending}
              onDelete={async () => onDelete(key.id)}
              onInvalidate={onInvalidate}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const AppleTeamsEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <UsersRoundIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No Apple Teams yet</EmptyTitle>
      <EmptyDescription>
        Apple Teams are auto-derived from uploaded certificates, push keys, and ASC API keys.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const AppleTeamsTable = ({ items }: { items: readonly AppleTeamItem[] }) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Team</TableHead>
        <TableHead>Type</TableHead>
        <TableHead className="text-right">Certs</TableHead>
        <TableHead className="text-right">Push</TableHead>
        <TableHead className="text-right">ASC</TableHead>
        <TableHead className="text-right">Profiles</TableHead>
        <TableHead className="text-right">Devices</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((team) => (
        <TableRow key={team.id}>
          <TableCell className="font-medium">{formatAppleTeamLabel(team)}</TableCell>
          <TableCell className="text-muted-foreground">{team.appleTeamType}</TableCell>
          <TableCell className="text-right">{team.distributionCertificateCount}</TableCell>
          <TableCell className="text-right">{team.pushKeyCount}</TableCell>
          <TableCell className="text-right">{team.ascApiKeyCount}</TableCell>
          <TableCell className="text-right">{team.provisioningProfileCount}</TableCell>
          <TableCell className="text-right">{team.deviceCount}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const GoogleServiceAccountKeysEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <CloudIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No Google service account keys</EmptyTitle>
      <EmptyDescription>
        Upload a service account .json key for FCM v1 push and Play Store submissions.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const GoogleServiceAccountKeysTable = ({
  items,
  onDelete,
  onInvalidate,
}: {
  items: readonly GoogleServiceAccountKeyItem[];
  onDelete: (id: string) => Promise<unknown>;
  onInvalidate: () => Promise<void>;
}) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Client email</TableHead>
        <TableHead>Project</TableHead>
        <TableHead className="w-12" aria-label="Actions" />
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((key) => (
        <TableRow key={key.id}>
          <TableCell className="text-xs">{key.clientEmail}</TableCell>
          <TableCell className="font-mono text-xs">{key.googleProjectId}</TableCell>
          <TableCell className="text-right">
            <DeleteAction
              name={key.privateKeyId.slice(0, 8)}
              title="Delete service account key?"
              description="This permanently removes the key."
              onConfirm={async () => onDelete(key.id)}
              successMessage="Service account key deleted"
              onSuccess={onInvalidate}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);
