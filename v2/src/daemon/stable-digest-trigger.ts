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

export function shouldSampleNow(state: Readonly<StableDigestTriggerState>): boolean {
  return !state.handoffInFlight;
}

export function startStableDigestTrigger(
  loadedDigest: string,
  deps: {
    sample: () => Promise<string>;
    startHandoff: (loaded: string, observed: string) => Promise<"committed" | "rolled_back">;
    scheduleSampling: ScheduleDigestSampling;
  },
): StableDigestTrigger {
  const state: StableDigestTriggerState = { handoffInFlight: false };
  let candidate: string | undefined;

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
    if (!shouldTriggerHandoff(candidate, loadedDigest, sampledDigest)) {
      candidate = sampledDigest;
      return;
    }

    state.handoffInFlight = true;
    try {
      const outcome = await deps.startHandoff(loadedDigest, sampledDigest);
      if (outcome === "rolled_back") candidate = undefined;
    } catch {
      candidate = undefined;
    } finally {
      state.handoffInFlight = false;
    }
  };

  return deps.scheduleSampling(tick);
}
