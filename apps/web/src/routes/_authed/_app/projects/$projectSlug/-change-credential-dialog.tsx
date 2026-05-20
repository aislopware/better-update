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
import { Tabs, TabsList, TabsTab } from "@better-update/ui/components/ui/tabs";
import { useState } from "react";

import type { ReactNode } from "react";

import { safeSubmit } from "../../../../../lib/use-api-mutation";

export type ChangeCredentialTab = "saved" | "upload";

interface SavedSlotProps {
  readonly selectedId: string;
  readonly setSelectedId: (id: string) => void;
}

interface SubmitContext {
  readonly tab: ChangeCredentialTab;
  readonly selectedId: string;
}

interface ChangeCredentialDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly title: string;
  readonly description: string;
  /** Pre-selected saved id (current credential); also the value restored on close. */
  readonly initialSelectedId: string;
  /** Whether the upload form currently holds a valid payload. */
  readonly isUploadValid: boolean;
  readonly submitting: boolean;
  /** Triggers the per-credential save mutation. Shell wraps the call in `safeSubmit`. */
  readonly onSubmit: (context: SubmitContext) => Promise<void>;
  /** Resets the per-credential upload state. Called on close, in `onOpenChangeComplete`. */
  readonly onResetUpload: () => void;
  readonly renderSaved: (props: SavedSlotProps) => ReactNode;
  readonly renderUpload: () => ReactNode;
}

/**
 * Shared scaffold for the "change credential" dialogs (keystore, GSA, cert,
 * profile, ASC key, push key). Owns the `Dialog` + reset-on-close wiring, the
 * `tab`/`selectedId` state, the `Tabs` header, the `canSubmit` rule, and the
 * footer (ghost Cancel + loading Save). Each credential supplies its saved/upload
 * slots, the upload validity flag, and the submit mutation.
 */
export const ChangeCredentialDialog = ({
  open,
  onOpenChange,
  title,
  description,
  initialSelectedId,
  isUploadValid,
  submitting,
  onSubmit,
  onResetUpload,
  renderSaved,
  renderUpload,
}: ChangeCredentialDialogProps) => {
  const [tab, setTab] = useState<ChangeCredentialTab>("saved");
  const [selectedId, setSelectedId] = useState<string>(initialSelectedId);

  const canSubmit = tab === "upload" ? isUploadValid : selectedId.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setTab("saved");
          setSelectedId(initialSelectedId);
          onResetUpload();
        }
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value === "upload" ? "upload" : "saved");
            }}
            className="mb-4"
          >
            <TabsList>
              <TabsTab value="saved">Choose saved</TabsTab>
              <TabsTab value="upload">Upload new</TabsTab>
            </TabsList>
          </Tabs>
          {tab === "saved" ? renderSaved({ selectedId, setSelectedId }) : renderUpload()}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={!canSubmit}
            loading={submitting}
            onClick={async () => {
              await safeSubmit(onSubmit({ tab, selectedId }));
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
