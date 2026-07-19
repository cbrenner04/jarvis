import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { openStateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { executeWriteLoop } from "./write-loop.ts";

const { roots } = trackedTempRoots();

describe("write loop timeout enforcement (real-clock timing)", () => {
  test("timeout fences a delayed worktree callback before it can run", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);

    try {
      const result = await executeWriteLoop({
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "fenced-timeout",
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"]),
        stateStore: store,
        sessionsDir: join(jarvisRoot, "sessions"),
        iterationTimeoutMs: 5,
        withExternalWorktree: async (_worktree, run) => {
          // Fixed delay: 20ms callback sleep vs 5ms timeout. Tests timeout enforcement
          // that a timeout actually cancels in-flight work. Requires real-clock timing.
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            worktree: { path: "/fake", reused: true },
            lock: { kind: "acquired" },
            value: await run({ path: "/fake", reused: true }),
          };
        },
      });

      // Timeout enforcement: the 5ms timeout should fire before the 20ms callback completes.
      // This test verifies that timeout actually terminates the loop with iteration_timeout result.
      expect(result.kind).toBe("iteration_timeout");
    } finally {
      store.close();
    }
  });
});
