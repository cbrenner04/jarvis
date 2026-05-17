export function formatPlanSpecTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}

const TIMESTAMPED_SPEC_DIR_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)-(.+)$/;

export function stripPlanSpecTimestampPrefix(dirBasename: string): string {
  const match = TIMESTAMPED_SPEC_DIR_RE.exec(dirBasename);
  return match?.[2] ?? dirBasename;
}

