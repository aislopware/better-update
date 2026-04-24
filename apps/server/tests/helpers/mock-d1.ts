export const mockD1 = {
  forRun: (fn: () => Promise<unknown>) => ({
    prepare: () => ({ bind: () => ({ run: fn }) }),
  }),

  forQuery: (opts: { first?: () => Promise<unknown>; all?: () => Promise<unknown> }) => ({
    prepare: () => ({
      bind: () => ({
        first: opts.first ?? (async () => null),
        all: opts.all ?? (async () => ({ results: [] })),
      }),
    }),
  }),
};

export const mockBatchD1 = (batchFn: () => Promise<unknown>) => ({
  prepare: () => ({ bind: (..._args: unknown[]) => ({}) }),
  batch: batchFn,
});
