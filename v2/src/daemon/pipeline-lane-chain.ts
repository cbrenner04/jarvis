import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Fan-out lane ordering, computed once at split admission and persisted on the split stage
 * artifact (`laneChain`). Dependent lanes run serially, each chained off its predecessor's final
 * workflow branch; independent lanes base off the default branch and dispatch concurrently.
 * Dependent lanes start after every independent lane settles.
 */
export type FanOutLaneChain = {
  /** Dependent lane branch keys in dispatch order. */
  dependent: readonly string[];
  independent: ReadonlySet<string>;
};

/** Durable `laneChain` field on the split stage artifact. */
type PersistedLaneChain = { dependent: string[]; independent: string[] };

/** Lane suffix progress: every stage satisfied, ended without completing, or still open. */
export type LaneProgress = "complete" | "dead" | "open";

export type LaneChainGate =
  | { kind: "open"; predecessor?: string }
  | { kind: "held" }
  | { kind: "severed"; predecessor: string };

type LaneDeclaration = { independent?: boolean; deliveredBy: string[] };

/** Same marker the intent split landing requires (`shared/intent-stage.ts`). */
const DELIVERED_BY_RE = /\(delivered by: ([a-z0-9-]+)\)\s*$/;

function frontmatterIndependent(lines: readonly string[]): boolean | undefined {
  if (lines[0]?.trim() !== "---") return undefined;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") return undefined;
    const match = /^independent:\s*(\S+)\s*$/.exec(line);
    if (match !== null) return match[1] === "true";
  }
  return undefined;
}

function prerequisiteProviders(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => /^## Prerequisites\s*$/.test(line));
  if (start < 0) return [];
  const providers: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const provider = DELIVERED_BY_RE.exec(line)?.[1];
    if (provider !== undefined) providers.push(provider);
  }
  return providers;
}

/** Explicit `independent:` frontmatter plus `(delivered by: <sibling>)` prerequisite providers. */
export function parseLaneDeclaration(content: string): LaneDeclaration {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const independent = frontmatterIndependent(lines);
  return { ...(independent !== undefined ? { independent } : {}), deliveredBy: prerequisiteProviders(lines) };
}

/**
 * A lane is independent when no sibling delivers one of its prerequisites and it delivers none of a
 * sibling's; explicit `independent: true|false` frontmatter overrides. Dependent lanes are ordered
 * providers-first (stable in authored order). An unreadable ready-intent declares nothing.
 */
export function buildFanOutLaneChain(
  branchKeys: readonly string[],
  contents: ReadonlyArray<string | undefined>,
): FanOutLaneChain {
  const siblings = new Set(branchKeys);
  const providersOf = new Map<string, string[]>();
  const declarations = branchKeys.map((branchKey, index) => {
    const content = contents[index];
    const declaration: LaneDeclaration = content === undefined ? { deliveredBy: [] } : parseLaneDeclaration(content);
    const providers = declaration.deliveredBy.filter((name) => name !== branchKey && siblings.has(name));
    providersOf.set(branchKey, providers);
    return { branchKey, declaration, providers };
  });
  const isProvider = new Set(declarations.flatMap((entry) => entry.providers));
  const independent = new Set<string>();
  const dependentLanes: string[] = [];
  for (const { branchKey, declaration, providers } of declarations) {
    const inferred = providers.length === 0 && !isProvider.has(branchKey);
    if (declaration.independent ?? inferred) independent.add(branchKey);
    else dependentLanes.push(branchKey);
  }
  return { dependent: orderProvidersFirst(dependentLanes, providersOf), independent };
}

function orderProvidersFirst(lanes: readonly string[], providersOf: ReadonlyMap<string, string[]>): string[] {
  const pending = [...lanes];
  const ordered: string[] = [];
  while (pending.length > 0) {
    const ready = pending.findIndex((lane) =>
      (providersOf.get(lane) ?? []).every((provider) => !pending.includes(provider) || provider === lane),
    );
    // A provider cycle falls back to authored order.
    const [next] = pending.splice(ready < 0 ? 0 : ready, 1);
    if (next !== undefined) ordered.push(next);
  }
  return ordered;
}

export function persistLaneChain(chain: FanOutLaneChain): PersistedLaneChain {
  return { dependent: [...chain.dependent], independent: [...chain.independent] };
}

/** The persisted chain, or `undefined` for a split admitted without one (concurrent lanes). */
export function laneChainFromArtifact(artifact: unknown): FanOutLaneChain | undefined {
  if (artifact === null || typeof artifact !== "object") return undefined;
  const raw = (artifact as { laneChain?: unknown }).laneChain;
  if (raw === null || typeof raw !== "object") return undefined;
  const { dependent, independent } = raw as { dependent?: unknown; independent?: unknown };
  const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((entry) => typeof entry === "string");
  if (!strings(dependent) || !strings(independent)) return undefined;
  return { dependent, independent: new Set(independent) };
}

/**
 * Gate for one lane. Independent lanes are always open. The first dependent lane opens once every
 * independent lane is complete or dead (never severed by them). Each later dependent lane opens when
 * its predecessor completes (chaining off it) and is severed when the predecessor is dead.
 */
export function laneChainGate(
  chain: FanOutLaneChain,
  branchKey: string,
  progress: (branchKey: string) => LaneProgress,
): LaneChainGate {
  const index = chain.dependent.indexOf(branchKey);
  if (index < 0) return { kind: "open" };
  if (index === 0) {
    for (const lane of chain.independent) {
      if (progress(lane) === "open") return { kind: "held" };
    }
    return { kind: "open" };
  }
  const predecessor = chain.dependent[index - 1];
  if (predecessor === undefined) return { kind: "open" };
  const predecessorProgress = progress(predecessor);
  if (predecessorProgress === "complete") return { kind: "open", predecessor };
  if (predecessorProgress === "dead") return { kind: "severed", predecessor };
  return { kind: "held" };
}

/** Lanes a settled lane may release: its chain successor, or the first dependent lane after an independent one. */
export function laneChainSuccessors(chain: FanOutLaneChain, branchKey: string): string[] {
  if (chain.independent.has(branchKey)) {
    const first = chain.dependent[0];
    return first === undefined ? [] : [first];
  }
  const index = chain.dependent.indexOf(branchKey);
  const next = index < 0 ? undefined : chain.dependent[index + 1];
  return next === undefined ? [] : [next];
}

/** Read one downstream ready-intent from the intent entry run's worktree; unreadable is `undefined`. */
export function readLaneReadyIntent(worktreePath: string, path: string): string | undefined {
  if (worktreePath.length === 0) return undefined;
  try {
    return readFileSync(join(worktreePath, path), "utf8");
  } catch {
    return undefined;
  }
}
