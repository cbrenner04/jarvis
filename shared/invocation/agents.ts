import type { InvocationBinding } from "./execute.ts";

export type ResolvedAgentBinding = {
  agentId: string;
  adapterModel: string;
  priceKey: string;
};

function createUnwiredBinding(id: string, stderr: string): InvocationBinding {
  return {
    id,
    invoke: async () => ({
      kind: "error",
      exitCode: 127,
      stderr,
    }),
  };
}

/** Build one unresolved production binding from one resolved agent/model rung. */
export function createResolvedAgentBinding(args: ResolvedAgentBinding): InvocationBinding {
  const { agentId, adapterModel, priceKey } = args;
  return {
    ...createUnwiredBinding(
      `${agentId}/${adapterModel}/${priceKey}`,
      `agent '${agentId}' model '${adapterModel}' price '${priceKey}' invocation is not wired yet`,
    ),
    metadata: { agent: agentId, model: adapterModel },
  };
}

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
    ...createUnwiredBinding(id, `agent '${id}' invocation is not wired yet`),
    metadata: { agent: id, model: id },
  }));
}
