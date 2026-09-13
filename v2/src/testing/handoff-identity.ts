import type { RpcHandler } from "../ipc/server.ts";

/**
 * Adapts a plain `createChangeoverHandler` stand-in to the handoff transaction wire: `changeover`
 * carries an identity and `handoff_commit` (served on the private endpoint) settles `committed`, so
 * `startDaemon` sees a real commit reply.
 */
export function withHandoffIdentity(changeover: RpcHandler): { changeover: RpcHandler; handoff_commit: RpcHandler } {
  const handoffId = "stand-in-handoff";
  return {
    changeover: async (frame, context) => {
      const result = await changeover(frame, context);
      if (result.kind !== "response") return result;
      return { kind: "response", result: { ...(result.result as object), handoffId } };
    },
    handoff_commit: () => ({ kind: "response", result: { ok: true, state: "committed" } }),
  };
}
