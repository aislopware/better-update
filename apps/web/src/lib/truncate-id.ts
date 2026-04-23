export const truncateId = (id: string | null | undefined, maxLength = 8): string => {
  if (!id) {
    return "-";
  }
  return id.length > maxLength ? `${id.slice(0, maxLength)}...` : id;
};
