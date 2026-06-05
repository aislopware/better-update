import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { LockIcon } from "lucide-react";
import { useMemo } from "react";

import type { PolicyItem } from "@better-update/api-client/react";

import { isManagedPolicy } from "../../../../lib/policy";

interface StatementView {
  readonly id: string;
  readonly effect: "allow" | "deny";
  readonly actions: readonly { readonly id: string; readonly value: string }[];
  readonly resources: readonly { readonly id: string; readonly value: string }[];
}

// Policy documents carry no stable per-statement/token ids, so attach client ids
// once for stable React keys (statements and selectors can legitimately repeat).
const toStatementViews = (policy: PolicyItem): readonly StatementView[] =>
  policy.document.statements.map((statement) => ({
    id: crypto.randomUUID(),
    effect: statement.effect,
    actions: statement.actions.map((value) => ({ id: crypto.randomUUID(), value })),
    resources: statement.resources.map((value) => ({ id: crypto.randomUUID(), value })),
  }));

const StatementCard = ({ statement, index }: { statement: StatementView; index: number }) => (
  <div className="border-border bg-muted/30 flex flex-col gap-4 rounded-lg border p-4">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">Statement {index + 1}</span>
      <Badge variant={statement.effect === "allow" ? "success" : "error"} className="capitalize">
        {statement.effect}
      </Badge>
    </div>

    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs font-medium">Actions</span>
      <div className="flex flex-wrap gap-1.5">
        {statement.actions.map((action) => (
          <Badge key={action.id} variant="secondary" className="font-mono text-xs">
            {action.value}
          </Badge>
        ))}
      </div>
    </div>

    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs font-medium">Resources</span>
      <ul className="flex flex-col gap-1">
        {statement.resources.map((resource) => (
          <li
            key={resource.id}
            className="border-border bg-background rounded-md border px-2.5 py-1.5 font-mono text-xs break-all"
          >
            {resource.value}
          </li>
        ))}
      </ul>
    </div>
  </div>
);

export const PolicyViewDialog = ({
  policy,
  open,
  onOpenChange,
}: {
  policy: PolicyItem;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) => {
  const managed = isManagedPolicy(policy.id);
  const statements = useMemo(() => toStatementViews(policy), [policy]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {policy.name}
            {managed ? (
              <Badge variant="secondary" className="gap-1">
                <LockIcon className="size-3" strokeWidth={2} />
                Managed
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {policy.description ??
              "Permission document. Each statement allows or denies a set of actions on path-glob resource selectors."}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div className="flex flex-col gap-4">
            {statements.map((statement, index) => (
              <StatementCard key={statement.id} statement={statement} index={index} />
            ))}
          </div>
        </DialogPanel>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
