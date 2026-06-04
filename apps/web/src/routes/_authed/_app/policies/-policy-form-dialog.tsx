import {
  createPolicy,
  policiesQueryKey,
  policyQueryKey,
  updatePolicy,
} from "@better-update/api-client/react";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { PolicyItem } from "@better-update/api-client/react";

import { toInputValue } from "../../../../lib/form-utils";
import { useApiMutation } from "../../../../lib/use-api-mutation";
import {
  PolicyBuilder,
  documentToDrafts,
  draftsToDocument,
  isStatementValid,
  newStatementDraft,
} from "./-policy-builder";

import type { StatementDraft } from "./-policy-builder";

const initialStatements = (policy: PolicyItem | undefined): StatementDraft[] => {
  if (policy && policy.document.statements.length > 0) {
    return documentToDrafts(policy.document);
  }
  return [newStatementDraft()];
};

const PolicyForm = ({
  orgId,
  policy,
  onSuccess,
}: {
  orgId: string;
  policy: PolicyItem | undefined;
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState(toInputValue(policy?.name));
  const [description, setDescription] = useState(toInputValue(policy?.description));
  const [statements, setStatements] = useState<readonly StatementDraft[]>(() =>
    initialStatements(policy),
  );
  const [submitted, setSubmitted] = useState(false);

  const trimmedName = name.trim();
  const nameError = trimmedName.length === 0 ? "Name is required." : null;
  const statementsValid = statements.length > 0 && statements.every(isStatementValid);
  const canSubmit = nameError === null && statementsValid;

  const invalidateLists = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: policiesQueryKey(orgId) });
    if (policy) {
      await queryClient.invalidateQueries({ queryKey: policyQueryKey(orgId, policy.id) });
    }
  };

  const saveMutation = useApiMutation({
    mutationFn: async () => {
      const document = draftsToDocument(statements);
      const trimmedDescription = description.trim();
      if (policy) {
        return updatePolicy(policy.id, {
          name: trimmedName,
          description: trimmedDescription.length > 0 ? trimmedDescription : null,
          document,
        });
      }
      return createPolicy({
        name: trimmedName,
        ...(trimmedDescription.length > 0 ? { description: trimmedDescription } : {}),
        document,
      });
    },
    onSuccess: async () => {
      toastManager.add({ title: policy ? "Policy updated" : "Policy created", type: "success" });
      await invalidateLists();
      onSuccess();
    },
  });

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setSubmitted(true);
        if (!canSubmit) {
          return;
        }
        saveMutation.mutate();
      }}
    >
      <DialogPanel>
        <FieldGroup>
          <Field invalid={submitted && nameError !== null}>
            <FieldLabel htmlFor="policy-name">Name</FieldLabel>
            <Input
              id="policy-name"
              placeholder="Channel deployers"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <FieldError match={submitted && nameError !== null}>{nameError}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="policy-description">Description (optional)</FieldLabel>
            <Textarea
              id="policy-description"
              placeholder="What this policy grants and to whom."
              rows={2}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          </Field>

          <Field invalid={submitted && !statementsValid}>
            <FieldLabel>Statements</FieldLabel>
            <PolicyBuilder statements={statements} onChange={setStatements} />
            <FieldError match={submitted && !statementsValid}>
              Each statement needs at least one action and one valid resource selector.
            </FieldError>
          </Field>
        </FieldGroup>
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" loading={saveMutation.isPending}>
          {policy ? "Save changes" : "Create policy"}
        </Button>
      </DialogFooter>
    </form>
  );
};

export const PolicyFormDialog = ({
  orgId,
  policy,
  open,
  onOpenChange,
}: {
  orgId: string;
  policy?: PolicyItem;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) => {
  const [resetKey, setResetKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setResetKey((prev) => prev + 1);
        }
      }}
    >
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{policy ? "Edit policy" : "Create policy"}</DialogTitle>
          <DialogDescription>
            Build a permission document from statements. Each statement allows or denies a set of
            actions on path-glob resource selectors.
          </DialogDescription>
        </DialogHeader>
        <PolicyForm
          key={resetKey}
          orgId={orgId}
          policy={policy}
          onSuccess={() => {
            onOpenChange(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
};
