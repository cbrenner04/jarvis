export function shouldStopPolling(stopRequested: boolean, isDraining: boolean, hasPendingWork: boolean): boolean {
  return stopRequested || (isDraining && !hasPendingWork);
}

export function registerStopPoll(inputs: {
  getStopRequested: () => boolean;
  getIsDraining: () => boolean;
  getHasPendingWork: () => boolean;
  onStop: () => void;
}): ReturnType<typeof setInterval> {
  return setInterval(() => {
    if (shouldStopPolling(inputs.getStopRequested(), inputs.getIsDraining(), inputs.getHasPendingWork())) {
      inputs.onStop();
    }
  }, 100);
}
