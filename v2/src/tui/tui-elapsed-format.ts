const SECOND_MS = 1_000;
const MINUTE_S = 60;
const HOUR_S = 3_600;
const DAY_S = 86_400;
const ELAPSED_COLUMN_WIDTH = 8;

export function formatElapsedWallClock(
  startMs: number | null,
  endMs: number | null,
  nowMs: number,
): string {
  if (startMs === null) {
    return "";
  }

  const durationMs = endMs === null ? nowMs - startMs : endMs - startMs;
  const totalSeconds = Math.floor(durationMs / SECOND_MS);
  if (totalSeconds <= 0) {
    return "";
  }

  if (totalSeconds < MINUTE_S) {
    return `${totalSeconds}s`;
  }
  if (totalSeconds < HOUR_S) {
    const minutes = Math.floor(totalSeconds / MINUTE_S);
    const seconds = totalSeconds % MINUTE_S;
    return `${minutes}m ${seconds}s`;
  }
  if (totalSeconds < DAY_S) {
    const hours = Math.floor(totalSeconds / HOUR_S);
    const minutes = Math.floor((totalSeconds % HOUR_S) / MINUTE_S);
    return `${hours}h ${minutes}m`;
  }

  let days = Math.floor(totalSeconds / DAY_S);
  let hours = Math.floor((totalSeconds % DAY_S) / HOUR_S);
  while (`${days}d ${hours}h`.length > ELAPSED_COLUMN_WIDTH) {
    if (hours > 0) {
      hours -= 1;
    } else if (days > 0) {
      days -= 1;
      hours = 23;
    } else {
      return "";
    }
  }
  return `${days}d ${hours}h`;
}
