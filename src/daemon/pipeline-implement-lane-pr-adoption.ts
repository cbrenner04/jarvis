import type { PipelineDefinition, WorkflowPipelineStage } from "../execution/pipeline-definition.ts";
import { GitHubOperationError, listPrs, type PrListEntry } from "../execution/github-operations.ts";
import { IMPLEMENT_SPEC_ALREADY_COMPLETE_ERROR } from "../execution/implement-workflow-steps.ts";
import type { PipelineContext, StateStore } from "../persistence/state-store.ts";
import { branchExistsLocalAsync, countCommitsBetween, resolveRef } from "../shared/git.ts";
import { errorMessage } from "../shared/error-message.ts";
import type { AsyncSubprocessRunner } from "../shared/subprocess.ts";
import { findPrecedingWorkflowArtifact, resolveHandPublishedImplementLaneTarget } from "./pipeline-stage-resolve.ts";
import { stageArtifactFromEntryRun, type PipelineStageArtifact } from "./pipeline-stage-dispatch.ts";

type HandPublishedImplementLaneAdoptionOutcome =
  | { kind: "unchanged" }
  | { kind: "succeeded"; artifact: PipelineStageArtifact }
  | { kind: "failed"; message: string; retryable: boolean };

type AdoptablePr = { number: number; url: string };

function soleAdoptablePr(candidates: readonly PrListEntry[]): AdoptablePr | null {
  if (candidates.length !== 1) return null;
  const pr = candidates[0];
  if (pr === undefined || pr.url === undefined) return null;
  return { number: pr.number, url: pr.url };
}

function selectAdoptableLanePr(
  prs: readonly PrListEntry[],
): AdoptablePr | { kind: "ambiguous"; numbers: number[] } | null {
  const open = prs.filter((pr) => pr.state === "OPEN");
  if (open.length > 1) return { kind: "ambiguous", numbers: open.map((pr) => pr.number) };
  const fromOpen = soleAdoptablePr(open);
  if (fromOpen !== null) return fromOpen;
  const merged = prs.filter((pr) => pr.state === "MERGED");
  if (merged.length > 1) return { kind: "ambiguous", numbers: merged.map((pr) => pr.number) };
  return soleAdoptablePr(merged);
}

function ambiguousLanePrMessage(numbers: readonly number[]): string {
  const listed = numbers.map((n) => `#${n}`).join(", ");
  return `pipeline implement stage: multiple adoptable pull requests on the lane branch (${listed}); close or merge extras, then jarvis pipeline resume`;
}

function unpublishedLaneBranchMessage(
  branchName: string,
  commitCount: number,
  pipelineId: string,
  laneBranchKey: string,
): string {
  return `pipeline implement stage: lane branch ${branchName} has ${commitCount} commit(s) not on base with no adoptable pull request; push the branch, open a PR, then jarvis pipeline resume ${pipelineId} ${laneBranchKey}`;
}

export async function tryAdoptHandPublishedImplementLane(args: {
  store: StateStore;
  pipelineId: string;
  definition: PipelineDefinition;
  stage: WorkflowPipelineStage;
  stageIndex: number;
  branchKey: string;
  splitPosition?: number;
  context: PipelineContext;
  stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>;
  resolutionError: string;
  runner: AsyncSubprocessRunner;
  loadRun: (runId: string) => { worktreePath: string; branch: string } | null;
}): Promise<HandPublishedImplementLaneAdoptionOutcome> {
  if (args.resolutionError !== IMPLEMENT_SPEC_ALREADY_COMPLETE_ERROR) return { kind: "unchanged" };
  const priorArtifact = findPrecedingWorkflowArtifact(
    args.definition.stages,
    args.stageIndex,
    args.stageArtifacts,
    args.branchKey,
    args.splitPosition,
  );
  if (priorArtifact === undefined) return { kind: "unchanged" };

  const target = await resolveHandPublishedImplementLaneTarget(args.stage, args.context, priorArtifact, args.loadRun);
  if ("error" in target) return { kind: "unchanged" };

  let prs: PrListEntry[];
  try {
    prs = await listPrs(args.runner, target.projectRoot, { branch: target.branchName, state: "all" });
  } catch (error) {
    const detail = error instanceof GitHubOperationError ? error.message : errorMessage(error);
    return {
      kind: "failed",
      message: `pipeline implement stage: pull request lookup failed: ${detail}`,
      retryable: true,
    };
  }

  const selected = selectAdoptableLanePr(prs);
  if (selected !== null && "kind" in selected) {
    return { kind: "failed", message: ambiguousLanePrMessage(selected.numbers), retryable: true };
  }
  if (selected === null) {
    const branchExists = await branchExistsLocalAsync(target.projectRoot, target.branchName, args.runner);
    if (branchExists) {
      try {
        const commitCount = await countCommitsBetween(
          target.projectRoot,
          target.baseRef,
          target.branchName,
          args.runner,
        );
        if (commitCount > 0) {
          return {
            kind: "failed",
            message: unpublishedLaneBranchMessage(target.branchName, commitCount, args.pipelineId, args.branchKey),
            retryable: true,
          };
        }
      } catch (error) {
        return {
          kind: "failed",
          message: `pipeline implement stage: lane branch commit count failed: ${errorMessage(error)}`,
          retryable: true,
        };
      }
    }
    return { kind: "unchanged" };
  }

  const entryRunId = args.store.createRun({
    project: target.project,
    specRef: target.baseRef,
    worktreePath: target.worktreePath,
    branch: target.branchName,
    specPath: target.specPath,
  });
  const attemptId = args.store.recordAttemptStart(entryRunId);
  args.store.commitCompletionBoundary({
    attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    terminalCause: "complete",
    completionAgent: "hand-published-lane-adoption",
    prNumber: selected.number,
    prUrl: selected.url,
  });
  const entryRun = args.store.loadRun(entryRunId);
  if (entryRun === null) {
    return {
      kind: "failed",
      message: `pipeline implement stage: adoption run ${entryRunId} missing after creation`,
      retryable: true,
    };
  }
  let artifact = stageArtifactFromEntryRun(entryRunId, entryRun, undefined, undefined, {
    prNumber: selected.number,
    prUrl: selected.url,
  });
  try {
    const resolved = await resolveRef(target.projectRoot, `${target.branchName}^{commit}`, args.runner);
    if (resolved.status === "resolved") {
      artifact = { ...artifact, forkTipSha: resolved.oid };
    }
  } catch {
    // Dependent lanes resolve the tip at fork admission when the branch still exists.
  }
  args.store.updateStage({
    pipelineId: args.pipelineId,
    stageId: args.stage.stageId,
    branchKey: args.branchKey,
    patch: {
      status: "succeeded",
      endedAt: Date.now(),
      failureDetail: null,
      workflowInvocationId: entryRunId,
      artifact,
    },
  });
  return { kind: "succeeded", artifact };
}
