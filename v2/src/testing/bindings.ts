import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";

/** A scripted outcome for one simulated invocation pass. */
type SimulatedOutcome = "quota" | "model_config" | "error" | "done" | "no-work" | "blocked" | "progress" | "stall";

/**
 * Build deterministic bindings that replay a scripted outcome sequence.
 *
 * Test-only: stands in for real agent processes when exercising the runner and
 * CLI control flow. `emitArtifact` makes a terminal success additionally write
 * the expected proof file so the runner's terminal contract passes.
 */
export function simulatedBindings(
  outcomes: readonly SimulatedOutcome[],
  opts: { artifactPath?: string; emitArtifact?: boolean; emitBlocker?: boolean; blockerSpecPath?: string } = {},
): readonly InvocationBinding[] {
  return outcomes.map((outcome, index) => ({
    id: `sim.${index + 1}`,
    metadata: {
      agent: `sim-agent-${index + 1}`,
      model: `sim-model-${index + 1}`,
    },
    invoke: async ({ cwd }) => {
      if (outcome === "quota") return { kind: "quota", stderr: "quota" };
      if (outcome === "model_config") {
        return { kind: "model_config", stderr: "model-config" };
      }
      if (outcome === "error") {
        return { kind: "error", exitCode: 1, stderr: "error" };
      }
      if (outcome === "stall") {
        return { kind: "stall", stderr: "no output" };
      }
      if (opts.emitArtifact && opts.artifactPath !== undefined && (outcome === "done" || outcome === "no-work")) {
        writeFileSync(join(cwd, opts.artifactPath), "ok\n", "utf8");
      }
      if (outcome === "blocked" && opts.emitBlocker) {
        const specPath = opts.blockerSpecPath ?? "spec.md";
        const target = join(cwd, specPath);
        if (existsSync(target)) {
          appendFileSync(target, "\n## Blocker\n\nblocked\n", "utf8");
        } else {
          writeFileSync(target, "- [ ] work\n\n## Blocker\n\nblocked\n", "utf8");
        }
      }
      return { kind: "ok", stdout: outcome, stderr: "" };
    },
  }));
}
