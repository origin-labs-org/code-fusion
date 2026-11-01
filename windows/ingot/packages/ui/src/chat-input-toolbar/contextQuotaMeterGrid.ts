export function getContextQuotaMeterGridClass(count: number): string {
  if (count <= 1) {
    return "grid-cols-1";
  }
  if (count === 2) {
    return "grid-cols-2";
  }
  if (count === 3) {
    return "grid-cols-3";
  }
  return "grid-cols-3";
}
