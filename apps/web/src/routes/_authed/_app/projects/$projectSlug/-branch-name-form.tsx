import { Button } from "@better-update/ui/components/button";
import { DialogClose, DialogFooter } from "@better-update/ui/components/dialog";
import { Input } from "@better-update/ui/components/input";
import { useForm } from "@tanstack/react-form";

import type { LucideIcon } from "lucide-react";

import { getFieldError, nameSchema } from "../../../../../lib/form-utils";

interface BranchNameFormProps {
  defaultName: string;
  onSubmit: (name: string) => Promise<void>;
  submitLabel: string;
  submitIcon?: LucideIcon;
}

export const BranchNameForm = ({
  defaultName,
  onSubmit,
  submitLabel,
  submitIcon: SubmitIcon,
}: BranchNameFormProps) => {
  const form = useForm({
    defaultValues: { name: defaultName },
    onSubmit: async ({ value }) => {
      await onSubmit(value.name);
    },
  });

  return (
    <form
      className="contents"
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
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
          const errorMessage = getFieldError(field);
          return (
            <Input
              label="Branch name"
              error={errorMessage}
              id="branch-name"
              placeholder="production"
              value={field.state.value}
              onChange={(event) => {
                field.handleChange(event.target.value);
              }}
              onBlur={field.handleBlur}
            />
          );
        }}
      </form.Field>

      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button
              variant="primary"
              type="submit"
              disabled={!canSubmit || Boolean(isSubmitting)}
              loading={Boolean(isSubmitting)}
            >
              {!isSubmitting && SubmitIcon ? (
                <SubmitIcon strokeWidth={2} data-icon="inline-start" />
              ) : null}
              {submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};
