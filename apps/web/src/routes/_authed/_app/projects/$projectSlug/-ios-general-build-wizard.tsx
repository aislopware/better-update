import {
  appleProvisioningProfilesQueryOptions,
  createIosBundleConfiguration,
  generateAppleProvisioningProfile,
  iosBundleConfigurationsQueryOptions,
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
import { canAdvance, INITIAL } from "./-ios-wizard-state";
import {
  StepAsc,
  StepBundle,
  StepCert,
  StepProfile,
  StepPush,
  StepReview,
  StepTeam,
} from "./-ios-wizard-steps";
import { StepperHeader } from "./-wizard-ui";

import type { WizardState } from "./-ios-wizard-state";

const STEPS = [
  { label: "Bundle" },
  { label: "Team" },
  { label: "Cert" },
  { label: "Push" },
  { label: "ASC" },
  { label: "Profile" },
  { label: "Review" },
  { label: "Save" },
] as const;

const renderStep = (
  step: number,
  props: {
    orgId: string;
    state: WizardState;
    setState: (next: WizardState) => void;
    isGenerating: boolean;
    onGenerate: () => Promise<void>;
  },
) => {
  const { orgId, state, setState, isGenerating, onGenerate } = props;
  if (step === 1) {
    return <StepBundle state={state} onChange={setState} />;
  }
  if (step === 2) {
    return <StepTeam orgId={orgId} state={state} onChange={setState} />;
  }
  if (step === 3) {
    return <StepCert orgId={orgId} state={state} onChange={setState} />;
  }
  if (step === 4) {
    return <StepPush orgId={orgId} state={state} onChange={setState} />;
  }
  if (step === 5) {
    return <StepAsc orgId={orgId} state={state} onChange={setState} />;
  }
  if (step === 6) {
    return (
      <StepProfile
        orgId={orgId}
        state={state}
        onChange={setState}
        isGenerating={isGenerating}
        onGenerate={onGenerate}
      />
    );
  }
  return <StepReview state={state} />;
};

export const IosGeneralBuildWizard = ({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId: string;
}) => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(INITIAL);
  const queryClient = useQueryClient();

  const reset = () => {
    setStep(1);
    setState(INITIAL);
  };

  const generateMutation = useApiMutation({
    mutationFn: generateAppleProvisioningProfile,
    onSuccess: async (profile) => {
      setState((prev) => ({ ...prev, profileId: profile.id }));
      await queryClient.invalidateQueries({
        queryKey: appleProvisioningProfilesQueryOptions(orgId).queryKey,
      });
      toast.success("Provisioning profile generated");
    },
  });

  const saveMutation = useApiMutation({
    mutationFn: async () =>
      createIosBundleConfiguration(projectId, {
        bundleIdentifier: state.bundleIdentifier,
        distributionType: state.distributionType,
        appleTeamId: state.appleTeamId,
        appleDistributionCertificateId: state.certId,
        appleProvisioningProfileId: state.profileId,
        ascApiKeyId: state.ascKeyId,
        ...(state.pushKeyId.length > 0 ? { applePushKeyId: state.pushKeyId } : {}),
      }),
    onSuccess: async () => {
      toast.success("iOS bundle configuration saved");
      await queryClient.invalidateQueries({
        queryKey: iosBundleConfigurationsQueryOptions(orgId, projectId).queryKey,
      });
      setOpen(false);
      reset();
    },
  });

  const onGenerate = async () => {
    await safeSubmit(
      generateMutation.mutateAsync({
        ascApiKeyId: state.ascKeyId,
        appleDistributionCertificateId: state.certId,
        bundleIdentifier: state.bundleIdentifier,
        distributionType: state.distributionType,
        ...(state.distributionType === "DEVELOPMENT" && state.deviceIds.length > 0
          ? { deviceIds: state.deviceIds }
          : {}),
      }),
    );
  };

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
        iOS General Wizard
      </Button>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>iOS Bundle Configuration</DialogTitle>
          <DialogDescription>
            Build credentials for App Store, Development, or Enterprise distribution.
          </DialogDescription>
        </DialogHeader>
        <StepperHeader steps={STEPS} currentStep={step} />
        <div className="py-4">
          {renderStep(step, {
            orgId,
            state,
            setState,
            isGenerating: generateMutation.isPending,
            onGenerate,
          })}
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
