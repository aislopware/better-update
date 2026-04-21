export const capitalize = (value: string): string => {
  const [first] = value;
  return first === undefined ? value : `${first.toUpperCase()}${value.slice(1)}`;
};
