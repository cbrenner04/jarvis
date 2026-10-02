import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";

/**
 * Fan-out lane ordering. Lanes run serially by default in `downstreamInputs` order, each chained
 * off its predecessor's final workflow branch; a ready-intent declaring `independent: true` opts its
 * lane out (bases off the default branch, dispatches concurrently). Dependent lanes start after every
 * independent lane settles.
 */
export type FanOutLaneChain = {
  /** Dependent lane branch keys in authored order. */
  dependent: readonly string[];
  independent: ReadonlySet<string>;
};

/** Lane suffix progress: every stage satisfied, ended without completing, or still open. */
export type LaneProgress = "complete" | "dead" | "open";

export type LaneChainGate =
  | { kind: "open"; predecessor?: string }
  | { kind: "held" }
  | { kind: "severed"; predecessor: string };

/** True when ready-intent frontmatter carries `independent: true`. */
export function readyIntentDeclaresIndependent(content: string): boolean {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return false;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") return false;
    const match = /^independent:\s*(\S+)\s*$/.exec(line);
    if (match !== null) return match[1] === "true";
  }
  return false;
}

/** An unreadable ready-intent counts as dependent: serial is the default. */
export function buildFanOutLaneChain(
  branchKeys: readonly string[],
  contents: ReadonlyArray<string | undefined>,
): FanOutLaneChain {
  const dependent: string[] = [];
  const independent = new Set<string>();
  branchKeys.forEach((branchKey, index) => {
    const content = contents[index];
    if (content !== undefined && readyIntentDeclaresIndependent(content)) independent.add(branchKey);
    else dependent.push(branchKey);
  });
  return { dependent, independent };
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

export type LaneReadyIntentSource = { worktreePath: string; branch: string; projectRoot: string };

/** Read one downstream ready-intent from the intent worktree, else from the intent branch. */
export async function readLaneReadyIntent(
  path: string,
  source: LaneReadyIntentSource,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string | undefined> {
  if (source.worktreePath.length > 0) {
    try {
      return await readFile(join(source.worktreePath, path), "utf8");
    } catch {
      // Fall through to the branch.
    }
  }
  if (source.branch.length === 0) return undefined;
  try {
    return await runner.runAsync("git", ["show", `${source.branch}:${path}`], source.projectRoot);
  } catch {
    return undefined;
  }
}
