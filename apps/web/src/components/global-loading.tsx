export const GlobalLoading = () => (
  <output
    data-global-loading
    style={{ opacity: 0 }}
    aria-label="Loading"
    className="pointer-events-none fixed inset-x-0 top-0 z-50 block h-[2px] overflow-hidden"
  >
    <div className="bg-foreground animate-progress-indeterminate absolute inset-y-0 -left-1/3 w-1/3" />
  </output>
);
