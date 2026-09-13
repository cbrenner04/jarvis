export type ScheduleDigestSampling = (onTick: () => Promise<void>) => { stop(): void };

type StableDigestTrigger = { stop(): void };

type StableDigestTriggerState = {
  handoffInFlight: boolean;
};

export function shouldTriggerHandoff(
  candidate: string | undefined,
  loadedDigest: string,
  sampledDigest: string,
): boolean {
  return sampledDigest !== "unknown" && sampledDigest !== loadedDigest && sampledDigest === candidate;
}

const SELF_HANDOFF_BACKOFF_BASE_MS = 60_000;
const SELF_HANDOFF_BACKOFF_CAP_MS = 30 * 60_000;

/** Wait before retrying a digest after its `failures`-th consecutive failed self-handoff: 1m doubling, capped at 30m. */
export function selfHandoffBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(SELF_HANDOFF_BACKOFF_BASE_MS * 2 ** (failures - 1), SELF_HANDOFF_BACKOFF_CAP_MS);
}

type SelfHandoffFailure = { digest: string; failures: number; retryAt: number };

/** True while `digest` is still inside the backoff window its last failed self-handoff opened. */
export function isBackingOff(failure: SelfHandoffFailure | undefined, digest: string, now: number): boolean {
  return failure !== undefined && failure.digest === digest && now < failure.retryAt;
}

export function shouldSampleNow(state: Readonly<StableDigestTriggerState>): boolean {
  return !state.handoffInFlight;
}

export function startStableDigestTrigger(
  loadedDigest: string,
  deps: {
    sample: () => Promise<string>;
    startHandoff: (loaded: string, observed: string) => Promise<"committed" | "rolled_back">;
    scheduleSampling: ScheduleDigestSampling;
    /** Clock for failure backoff; defaults to `Date.now`. */
    now?: () => number;
  },
): StableDigestTrigger {
  const state: StableDigestTriggerState = { handoffInFlight: false };
  let candidate: string | undefined;
  let lastFailure: SelfHandoffFailure | undefined;
  const now = deps.now ?? Date.now;
  const recordFailure = (digest: string): void => {
    candidate = undefined;
    const failures = lastFailure?.digest === digest ? lastFailure.failures + 1 : 1;
    lastFailure = { digest, failures, retryAt: now() + selfHandoffBackoffMs(failures) };
  };

  const tick = async (): Promise<void> => {
    if (!shouldSampleNow(state)) return;

    let sampledDigest: string;
    try {
      sampledDigest = await deps.sample();
    } catch {
      candidate = undefined;
      return;
    }

    if (sampledDigest === "unknown") {
      candidate = undefined;
      return;
    }
    if (
      !shouldTriggerHandoff(candidate, loadedDigest, sampledDigest) ||
      isBackingOff(lastFailure, sampledDigest, now())
    ) {
      candidate = sampledDigest;
      return;
    }

    state.handoffInFlight = true;
    try {
      const outcome = await deps.startHandoff(loadedDigest, sampledDigest);
      if (outcome === "rolled_back") recordFailure(sampledDigest);
    } catch {
      recordFailure(sampledDigest);
    } finally {
      state.handoffInFlight = false;
    }
  };

  return deps.scheduleSampling(tick);
}
