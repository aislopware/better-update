import { cn } from "@better-update/ui/lib/utils";

export interface WizardStep {
  label: string;
}

export const StepperHeader = ({
  steps,
  currentStep,
}: {
  steps: readonly WizardStep[];
  currentStep: number;
}) => (
  <ol className="flex items-center gap-2">
    {steps.map((step, index) => {
      const number = index + 1;
      const isActive = number === currentStep;
      const isDone = number < currentStep;
      return (
        <li key={step.label} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
              isActive && "border-primary bg-primary text-primary-foreground",
              isDone && "border-primary bg-primary/20 text-primary",
              !isActive && !isDone && "border-border text-muted-foreground",
            )}
          >
            {isDone ? "✓" : number}
          </span>
          <span className={cn("text-xs", isActive ? "text-foreground" : "text-muted-foreground")}>
            {step.label}
          </span>
          {index < steps.length - 1 ? <span className="bg-border h-px flex-1" aria-hidden /> : null}
        </li>
      );
    })}
  </ol>
);
