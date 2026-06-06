import type { InvocationBinding } from "./execute.ts";

/**
 * Build the ordered agent bindings the runner falls back through.
 *
 * This is the seam where real `claude`/`codex`/`cursor` process spawning and
 * quota classification land. Until then each binding reports a terminal `error`
 * so the control flow is exercisable without a faked success path leaking into
 * production code — tests inject their own bindings instead.
 */
export function createAgentBindings(agentIds: readonly string[]): readonly InvocationBinding[] {
  return agentIds.map((id) => ({
    id,
    invoke: async () => ({
      kind: "error",
      exitCode: 127,
      stderr: `agent '${id}' invocation is not wired yet`,
    }),
  }));
}
