export function formatAbsoluteTimestamp(epochMs: number | null | undefined): string {
  // biome-ignore format: mutation checkpoint requires this exact single-line guard
  if (epochMs == null) { return ""; }
  if (!Number.isFinite(epochMs)) {
    return "invalid";
  }
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) {
    return "invalid";
  }
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
