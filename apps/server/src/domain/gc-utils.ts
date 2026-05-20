export const GC_BATCH_SIZE = 100;

export const parseRetentionDays = (raw: string | undefined) => {
  const parsed = Number.parseInt(raw ?? "30", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
};

export const computeCutoff = (retentionDays: number) =>
  new Date(Date.now() - retentionDays * 86_400_000).toISOString();
