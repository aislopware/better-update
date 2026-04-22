import {
  androidApplicationIdentifiersQueryOptions,
  androidBuildCredentialsQueryOptions,
  androidUploadKeystoresQueryOptions,
  createAndroidBuildCredentials,
  googleServiceAccountKeysQueryOptions,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { WandIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import {
  canAdvance,
  INITIAL,
  resolveAppIdentifierId,
  resolveKeystoreId,
  resolveSaId,
} from "./-android-wizard-state";
import { StepAppId, StepGoogleSa, StepKeystore, StepReview } from "./-android-wizard-steps";
import { StepperHeader } from "./-wizard-ui";

import type { WizardState } from "./-android-wizard-state";

const STEPS = [
  { label: "App ID" },
  { label: "Keystore" },
  { label: "Play SA" },
  { label: "FCM" },
  { label: "Review" },
] as const;

const invalidateKeys = async (
  queryClient: ReturnType<typeof useQueryClient>,
  orgId: string,
  projectId: string,
  state: WizardState,
) => {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: androidApplicationIdentifiersQueryOptions(orgId, projectId).queryKey,
    }),
    queryClient.invalidateQueries({
      queryKey: androidUploadKeystoresQueryOptions(orgId).queryKey,
    }),
    queryClient.invalidateQueries({
      queryKey: googleServiceAccountKeysQueryOptions(orgId).queryKey,
    }),
    state.existingAppIdentifierId.length > 0
      ? queryClient.invalidateQueries({
          queryKey: androidBuildCredentialsQueryOptions(orgId, state.existingAppIdentifierId)
            .queryKey,
        })
      : Promise.resolve(),
  ]);
};

export const AndroidBuildWizard = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(INITIAL);
  const queryClient = useQueryClient();

  const reset = () => {
    setStep(1);
    setState(INITIAL);
  };

  const saveMutation = useApiMutation({
    mutationFn: async () => {
      const appIdentifierId = await resolveAppIdentifierId(projectId, state);
      const keystoreId = await resolveKeystoreId(state);
      const submissionsSaId = await resolveSaId(state.submissionsSaMode, {
        existing: state.submissionsSaId,
        json: state.submissionsSaJson,
      });
      const fcmSaId = await resolveSaId(state.fcmSaMode, {
        existing: state.fcmSaId,
        json: state.fcmSaJson,
      });
      return createAndroidBuildCredentials(appIdentifierId, {
        name: state.name,
        isDefault: state.isDefault,
        androidUploadKeystoreId: keystoreId,
        ...(submissionsSaId === undefined
          ? {}
          : { googleServiceAccountKeyForSubmissionsId: submissionsSaId }),
        ...(fcmSaId === undefined ? {} : { googleServiceAccountKeyForFcmV1Id: fcmSaId }),
      });
    },
    onSuccess: async () => {
      toast.success("Android build credentials saved");
      await invalidateKeys(queryClient, orgId, projectId, state);
      setOpen(false);
      reset();
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          reset();
        }
      }}
    >
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        <WandIcon data-icon="inline-start" />
        Android Build Wizard
      </Button>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Android Build Credentials</DialogTitle>
          <DialogDescription>
            Upload keystore + Google Service Account keys for a project application identifier.
          </DialogDescription>
        </DialogHeader>
        <StepperHeader steps={STEPS} currentStep={step} />
        <div className="py-4">
          {step === 1 ? (
            <StepAppId orgId={orgId} projectId={projectId} state={state} onChange={setState} />
          ) : null}
          {step === 2 ? <StepKeystore orgId={orgId} state={state} onChange={setState} /> : null}
          {step === 3 ? (
            <StepGoogleSa
              orgId={orgId}
              label="Submissions"
              mode={state.submissionsSaMode}
              saId={state.submissionsSaId}
              onModeChange={(next) => {
                setState({ ...state, submissionsSaMode: next });
              }}
              onIdChange={(next) => {
                setState({ ...state, submissionsSaId: next });
              }}
              onJsonChange={(next) => {
                setState({ ...state, submissionsSaJson: next });
              }}
            />
          ) : null}
          {step === 4 ? (
            <StepGoogleSa
              orgId={orgId}
              label="FCM"
              mode={state.fcmSaMode}
              saId={state.fcmSaId}
              onModeChange={(next) => {
                setState({ ...state, fcmSaMode: next });
              }}
              onIdChange={(next) => {
                setState({ ...state, fcmSaId: next });
              }}
              onJsonChange={(next) => {
                setState({ ...state, fcmSaJson: next });
              }}
            />
          ) : null}
          {step === 5 ? <StepReview state={state} /> : null}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          {step > 1 ? (
            <Button
              variant="outline"
              onClick={() => {
                setStep((prev) => prev - 1);
              }}
            >
              Back
            </Button>
          ) : null}
          {step < STEPS.length ? (
            <Button
              disabled={!canAdvance(state, step)}
              onClick={() => {
                setStep((prev) => prev + 1);
              }}
            >
              Next
            </Button>
          ) : (
            <Button
              disabled={saveMutation.isPending}
              onClick={async () => {
                await safeSubmit(saveMutation.mutateAsync(undefined));
              }}
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
