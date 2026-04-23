export const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  count === 1 ? singular : plural;
