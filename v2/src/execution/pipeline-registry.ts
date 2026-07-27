import type { PipelineDefinition } from "./pipeline-definition.ts";

export const PIPELINE_REGISTRY: Record<string, PipelineDefinition> = {
  "full-review": {
    name: "full-review",
    stages: [
      { stageId: "intent", kind: "workflow", workflow: "intent", review: "light" },
      { stageId: "approve-intent", kind: "approval" },
      { stageId: "plan", kind: "workflow", workflow: "plan", review: "debate" },
      { stageId: "approve-plan", kind: "approval" },
      { stageId: "implement", kind: "workflow", workflow: "implement", review: "debate" },
    ],
  },
  fast: {
    name: "fast",
    stages: [
      { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
      { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
    ],
  },
};

export function getPipelineDefinition(
  name: string,
):
  | { ok: true; definition: PipelineDefinition }
  | { ok: false; error: { code: "unknown-pipeline"; name: string } } {
  const definition = PIPELINE_REGISTRY[name];
  if (!definition) {
    return { ok: false, error: { code: "unknown-pipeline", name } };
  }
  return { ok: true, definition };
}
