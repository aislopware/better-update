/** Title-case an environment name for display (works for built-in + custom names). */
export const formatEnvironmentLabel = (name: string): string => {
  if (name.length === 0) {
    return name;
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
};
