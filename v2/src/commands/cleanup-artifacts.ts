import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseSpec } from "../../../shared/spec-parser.ts";

export type ArtifactSpec = {
  /** Configured v2 spec home containing this immediate child. */
  home: string;
  /** A spec directory, or a single Markdown spec file. */
  source: string;
  /** Archive/ready-intent identity, normally the source basename without .md. */
  name: string;
  /** Branch identity used for matching open-PR inspection. */
  branch: string;
};

export type ArtifactEligibility = { status: "eligible" } | { status: "ineligible"; reason: string };

export type ArtifactInspection = {
  /** Returns the number of matching open PRs; errors must reject. */
  findOpenPrs: (branch: string) => Promise<number>;
  /** Returns whether another materialized workspace owns this spec; errors must reject. */
  hasMaterializedOwner: (spec: ArtifactSpec) => Promise<boolean>;
};

type ArtifactFs = {
  exists: (path: string) => boolean;
  mkdir: (path: string) => void;
  read: (path: string) => Buffer;
  rename: (from: string, to: string) => void;
  unlink: (path: string) => void;
};

const realFs: ArtifactFs = {
  exists: existsSync,
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  read: readFileSync,
  rename: renameSync,
  unlink: unlinkSync,
};

function completionFiles(spec: ArtifactSpec, fs: ArtifactFs): string[] | undefined {
  if (!fs.exists(spec.source)) return undefined;
  if (spec.source.endsWith(".md")) return [spec.source];

  const index = join(spec.source, "index.md");
  if (!fs.exists(index)) return undefined;
  try {
    const parsed = parseSpec(fs.read(index).toString("utf8"));
    return parsed.linkedSubspecs.length === 0
      ? [index]
      : parsed.linkedSubspecs.map((subspec) => resolve(dirname(index), subspec.path));
  } catch {
    return undefined;
  }
}

/** Completeness is solely every linked subspec's non-human-only acceptance criteria. */
export function completedSpecEligibility(spec: ArtifactSpec, fs: ArtifactFs = realFs): ArtifactEligibility {
  const files = completionFiles(spec, fs);
  if (files === undefined) return { status: "ineligible", reason: "could not inspect spec completeness" };

  let criterionCount = 0;
  for (const file of files) {
    if (!fs.exists(file)) return { status: "ineligible", reason: `linked subspec is missing: ${file}` };
    try {
      const criteria = parseSpec(fs.read(file).toString("utf8")).acceptanceCriteria.filter(
        (criterion) => !criterion.humanOnly,
      );
      criterionCount += criteria.length;
      const unchecked = criteria.find((criterion) => !criterion.checked);
      if (unchecked !== undefined)
        return {
          status: "ineligible",
          reason: `unchecked acceptance criterion in ${basename(file)}: ${unchecked.text}`,
        };
    } catch {
      return { status: "ineligible", reason: `could not inspect acceptance criteria: ${file}` };
    }
  }
  return criterionCount === 0
    ? { status: "ineligible", reason: "no non-human-only acceptance criteria" }
    : { status: "eligible" };
}

/** Fail-closed artifact archival inspection, deliberately independent of run status and index checkbox state. */
export async function checkArtifactEligibility(
  spec: ArtifactSpec,
  inspection: ArtifactInspection,
  fs: ArtifactFs = realFs,
): Promise<ArtifactEligibility> {
  const completion = completedSpecEligibility(spec, fs);
  if (completion.status === "ineligible") return completion;

  try {
    const openPrs = await inspection.findOpenPrs(spec.branch);
    if (openPrs > 0) return { status: "ineligible", reason: `matching open PR exists for ${spec.branch}` };
  } catch (error) {
    return { status: "ineligible", reason: `failed to inspect matching PRs: ${String(error)}` };
  }

  try {
    if (await inspection.hasMaterializedOwner(spec))
      return { status: "ineligible", reason: "another materialized worktree owns this spec" };
  } catch (error) {
    return { status: "ineligible", reason: `failed to inspect worktree ownership: ${String(error)}` };
  }
  return { status: "eligible" };
}

export type ArchiveResult =
  | { status: "archived"; destination: string; intentPruned: boolean }
  | { status: "skipped"; reason: string };

/**
 * Move one already-eligible artifact and optionally consume its proven input.
 * Every post-move failure attempts to restore both paths before returning.
 */
export function archiveCompletedSpec(spec: ArtifactSpec, fs: ArtifactFs = realFs): ArchiveResult {
  const destination = join(spec.home, "completed", basename(spec.source));
  const readyIntent = join(spec.home, "ready-intents", `${spec.name}.md`);
  const sourceIntent = join(spec.source, "intent.md");
  if (fs.exists(destination))
    return { status: "skipped", reason: `archive destination already exists: ${destination}` };

  let pruneIntent = false;
  try {
    pruneIntent =
      fs.exists(readyIntent) && fs.exists(sourceIntent) && fs.read(readyIntent).equals(fs.read(sourceIntent));
  } catch (error) {
    return { status: "skipped", reason: `failed to inspect ready-intent: ${String(error)}` };
  }

  try {
    fs.mkdir(dirname(destination));
    fs.rename(spec.source, destination);
  } catch (error) {
    return { status: "skipped", reason: `failed to archive spec: ${String(error)}` };
  }

  if (!pruneIntent) return { status: "archived", destination, intentPruned: false };
  try {
    fs.unlink(readyIntent);
    return { status: "archived", destination, intentPruned: true };
  } catch (error) {
    try {
      fs.rename(destination, spec.source);
    } catch (rollbackError) {
      return {
        status: "skipped",
        reason: `failed to prune ready-intent and restore archive: ${String(rollbackError)}`,
      };
    }
    return { status: "skipped", reason: `failed to prune ready-intent; archive restored: ${String(error)}` };
  }
}
