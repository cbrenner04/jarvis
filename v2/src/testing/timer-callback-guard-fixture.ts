export function shouldStopPolling(stopRequested: boolean, isDraining: boolean, hasPendingWork: boolean): boolean {
  return stopRequested || (isDraining && !hasPendingWork);
}
