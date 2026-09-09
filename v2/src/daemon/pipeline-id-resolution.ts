import type { StateStore } from "../persistence/state-store.ts";

/** Shortest prefix a pipeline verb will resolve; also the shortest prefix `pipeline list` prints. */
export const PIPELINE_ID_PREFIX_MIN_LENGTH = 8;

export const PIPELINE_ID_AMBIGUOUS = "pipeline_id_ambiguous";

export type PipelineIdResolution =
  | { kind: "resolved"; pipelineId: string }
  | { kind: "ambiguous"; candidates: string[] }
  /** Nothing matched; the verb keeps its own not-found handling for the argument as given. */
  | { kind: "unmatched"; pipelineId: string };

/**
 * Resolve a pipeline verb's id argument: an exact id wins; otherwise an argument of at least
 * `PIPELINE_ID_PREFIX_MIN_LENGTH` characters that strictly prefixes exactly one pipeline id
 * (dismissed pipelines included) resolves to it. Shorter arguments never prefix-resolve.
 */
export function resolvePipelineIdArgument(
  store: Pick<StateStore, "loadPipeline" | "listPipelines">,
  argument: string,
): PipelineIdResolution {
  if (store.loadPipeline(argument) !== null) return { kind: "resolved", pipelineId: argument };
  if (argument.length < PIPELINE_ID_PREFIX_MIN_LENGTH) return { kind: "unmatched", pipelineId: argument };
  const candidates = store
    .listPipelines()
    .map((pipeline) => pipeline.id)
    .filter((pipelineId) => pipelineId.startsWith(argument))
    .sort();
  const [only] = candidates;
  if (candidates.length === 1 && only !== undefined) return { kind: "resolved", pipelineId: only };
  if (candidates.length > 1) return { kind: "ambiguous", candidates };
  return { kind: "unmatched", pipelineId: argument };
}

export function ambiguousPipelineIdMessage(argument: string, candidates: readonly string[]): string {
  return `pipeline id ${argument} matches ${candidates.length} pipelines: ${candidates.join(", ")}`;
}

/**
 * Per-id shortest prefix (never shorter than `PIPELINE_ID_PREFIX_MIN_LENGTH`) that no other id in
 * `ids` shares, so every printed prefix resolves through `resolvePipelineIdArgument`.
 */
export function uniquePipelineIdPrefixes(ids: readonly string[]): Map<string, string> {
  const prefixes = new Map<string, string>();
  for (const id of ids) {
    let length = Math.min(PIPELINE_ID_PREFIX_MIN_LENGTH, id.length);
    while (length < id.length && ids.some((other) => other !== id && other.startsWith(id.slice(0, length)))) {
      length += 1;
    }
    prefixes.set(id, id.slice(0, length));
  }
  return prefixes;
}
