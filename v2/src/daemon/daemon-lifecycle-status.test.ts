import { describe, expect, test } from "bun:test";
import { getDaemonStatus } from "./daemon-lifecycle.ts";

// Socket-free: probers and the liveness classifier are injected, so these run in the sandbox.
describe("getDaemonStatus health retry and liveness classification", () => {
  test("inconclusive follows one short and one strictly longer health attempt, live after each miss", async () => {
    const budgets: number[] = [];
    const classified: string[] = [];
    const status = await getDaemonStatus("/fake/socket", {
      healthTimeoutMs: 10,
      retryHealthTimeoutMs: 40,
      socketProber: {
        probe: async (_path, timeoutMs) => {
          budgets.push(timeoutMs);
          classified.push("probe");
          return false;
        },
      },
      classifySocketLiveness: async () => {
        classified.push("classify");
        return "live";
      },
    });
    expect(status).toEqual({ state: "inconclusive", healthTimeoutMs: 10, retryHealthTimeoutMs: 40 });
    expect(budgets).toEqual([10, 40]);
    expect(classified).toEqual(["probe", "classify", "probe", "classify"]);
  });

  test("the retry budget is strictly longer than the short budget", async () => {
    const budgets: number[] = [];
    await getDaemonStatus("/fake/socket", {
      healthTimeoutMs: 5_000,
      retryHealthTimeoutMs: 100,
      socketProber: {
        probe: async (_path, timeoutMs) => {
          budgets.push(timeoutMs);
          return false;
        },
      },
      classifySocketLiveness: async () => "live",
    });
    expect(budgets).toEqual([5_000, 5_001]);
  });

  for (const verdict of ["stale", "absent"] as const) {
    test(`a ${verdict} socket after the first miss is stopped without a retry`, async () => {
      let probes = 0;
      const status = await getDaemonStatus("/fake/socket", {
        socketProber: {
          probe: async () => {
            probes++;
            return false;
          },
        },
        classifySocketLiveness: async () => verdict,
      });
      expect(status).toEqual({ state: "stopped" });
      expect(probes).toBe(1);
    });

    test(`a socket turning ${verdict} between attempts is stopped without a third attempt`, async () => {
      let probes = 0;
      let classifications = 0;
      const status = await getDaemonStatus("/fake/socket", {
        socketProber: {
          probe: async () => {
            probes++;
            return false;
          },
        },
        classifySocketLiveness: async () => (++classifications === 1 ? "live" : verdict),
      });
      expect(status).toEqual({ state: "stopped" });
      expect(probes).toBe(2);
    });
  }
});
