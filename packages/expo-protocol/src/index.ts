export const buildRollbackDirectiveBody = (commitTime: string): string =>
  JSON.stringify({
    type: "rollBackToEmbedded",
    parameters: {
      commitTime,
    },
  });
