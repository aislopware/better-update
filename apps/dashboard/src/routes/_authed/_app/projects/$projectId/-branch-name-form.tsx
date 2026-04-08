import { Button } from "@better-update/ui/components/ui/button";
import { DialogClose, DialogFooter } from "@better-update/ui/components/ui/dialog";
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";

import type { ComponentProps } from "react";

import { nameSchema } from "../../../../../lib/form-utils";

interface BranchNameFormProps {
  defaultName: string;
  onSubmit: (name: string) => Promise<void>;
  submitLabel: string;
  submittingLabel: string;
  submitIcon?: ComponentProps<typeof HugeiconsIcon>["icon"];
}

export const BranchNameForm = ({
  defaultName,
  onSubmit,
  submitLabel,
  submittingLabel,
  submitIcon,
}: BranchNameFormProps) => {
  const form = useForm({
    defaultValues: { name: defaultName },
    onSubmit: async ({ value }) => {
      await onSubmit(value.name);
    },
  });

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <div className="flex flex-col gap-4 py-4">
        <form.Field
          name="name"
          validators={{
            onBlur: ({ value }) => {
              const result = nameSchema.safeParse(value);
              return result.success ? undefined : result.error.issues[0]?.message;
            },
          }}
        >
          {(field) => {
            const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
            return (
              <div className="flex flex-col gap-2">
                <Label htmlFor="branch-name">Branch name</Label>
                <Input
                  id="branch-name"
                  placeholder="production"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
              </div>
            );
          }}
        </form.Field>
      </div>

      <DialogFooter>
        <DialogClose>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {submitIcon ? (
                <HugeiconsIcon icon={submitIcon} strokeWidth={2} className="size-4" />
              ) : null}
              {isSubmitting ? submittingLabel : submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};
