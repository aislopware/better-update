import type { SubmissionStatusValue } from "@better-update/api-client/react";

// Single source for submission status presentation, shared by the submissions
// list and the submission detail page so both surfaces stay in sync.
export const SUBMISSION_STATUS_VARIANT: Record<
  SubmissionStatusValue,
  "secondary" | "destructive" | "outline"
> = {
  AWAITING_BUILD: "outline",
  IN_QUEUE: "outline",
  IN_PROGRESS: "secondary",
  FINISHED: "secondary",
  ERRORED: "destructive",
  CANCELED: "outline",
};

export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatusValue, string> = {
  AWAITING_BUILD: "Awaiting build",
  IN_QUEUE: "In queue",
  IN_PROGRESS: "In progress",
  FINISHED: "Finished",
  ERRORED: "Errored",
  CANCELED: "Canceled",
};
