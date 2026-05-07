const stripPrerelease = (version: string): readonly number[] => {
  const main = version.replace(/-.*$/u, "");
  return main.split(".").map((part) => Number.parseInt(part, 10) || 0);
};

export const isNewerVersion = (latest: string, current: string): boolean => {
  const [la = 0, lb = 0, lc = 0] = stripPrerelease(latest);
  const [ca = 0, cb = 0, cc = 0] = stripPrerelease(current);
  if (la !== ca) {
    return la > ca;
  }
  if (lb !== cb) {
    return lb > cb;
  }
  return lc > cc;
};
