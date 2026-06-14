import { createAgentBindings } from "../../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { getExternalWorktreePath } from "../external-worktree.ts";
import type { LogRepository } from "../log-repository.ts";
import type { Run, RunStatus, StateStore } from "../state-store.ts";
import { executeWriteLoop, type WriteLoopInput } from "../write-loop.ts";

const DEFAULT_STEP_RULES = "Return exactly one terminal token: done|no-work|blocked|progress.";
const DEFAULT_AGENTS = ["claude"] as const;

/** IPC params for `run.start`. */
export type RunStartParams = {
  projectRoot: string;
  project: string;
  branch: string;
  base: string;
  spec: string;
  artifact: string;
  agents?: string[];
  maxIterations?: number;
};

/** Result of an accepted detached run start. */
export type RunStartResult = { runId: string };

/** One run row for `run.list` / `jarvis status`. */
export type RunListEntry = {
  id: string;
  project: string;
  branch: string;
  status: RunStatus;
  createdAt: number;
  attemptCount: number;
  specPath: string;
  worktreePath: string;
  active: boolean;
};

/** Snapshot returned by `run.list`. */
export type RunListResult = {
  runs: RunListEntry[];
  activeRunIds: readonly string[];
};

export type RunManagerDeps = {
  stateStore: StateStore;
  logRepository: LogRepository;
  jarvisRoot: string;
  executeWriteLoop?: (input: WriteLoopInput) => Promise<Awaited<ReturnType<typeof executeWriteLoop>>>;
  createBindings?: (agentIds: readonly string[]) => readonly InvocationBinding[];
  registerActiveInvocation: (runId: string) => void;
  unregisterActiveInvocation: (runId: string) => void;
};

/** Thrown when `(project, branch)` is already reserved by a daemon-owned run. */
export class OwnershipConflictError extends Error {
  readonly project: string;
  readonly branch: string;
  readonly existingRunId: string;

  constructor(project: string, branch: string, existingRunId: string) {
    super(`run already owns ${project}/${branch}`);
    this.project = project;
    this.branch = branch;
    this.existingRunId = existingRunId;
  }
}

const OWNERSHIP_RESERVING_STATUSES: ReadonlySet<RunStatus> = new Set([
  "in-progress",
  "blocked",
  "budget-soft-stopped",
  "paused",
  "killed",
]);

/** Whether durable status keeps daemon `(project, branch)` ownership reserved. */
export function reservesOwnership(status: RunStatus): boolean {
  return OWNERSHIP_RESERVING_STATUSES.has(status);
}

/** Whether terminal status releases daemon ownership. */
export function releasesOwnership(status: RunStatus): boolean {
  return status === "completed" || status === "failed";
}

/**
 * Orchestrate detached write-loop runs: ownership guards, durable pre-create,
 * async scheduling, and structured run lifecycle logs.
 */
export class RunManager {
  private readonly ownership = new Map<string, string>();
  private readonly activeRunIds = new Set<string>();
  private readonly deps: Required<Pick<RunManagerDeps, "executeWriteLoop" | "createBindings">> & RunManagerDeps;

  constructor(deps: RunManagerDeps) {
    this.deps = {
      ...deps,
      executeWriteLoop: deps.executeWriteLoop ?? executeWriteLoop,
      createBindings: deps.createBindings ?? createAgentBindings,
    };
    this.rebuildOwnershipFromDurableState();
  }

  /** Rebuild in-memory ownership from durable nonterminal runs. */
  rebuildOwnershipFromDurableState(): void {
    this.ownership.clear();
    for (const run of this.deps.stateStore.listRuns()) {
      if (reservesOwnership(run.status)) {
        this.ownership.set(ownershipKey(run.project, run.branch), run.id);
      }
    }
  }

  /**
   * Accept a detached run: durable create/resume key, reserve ownership, schedule
   * the write loop, return immediately with the run ID.
   */
  start(params: RunStartParams): RunStartResult {
    const input = buildWriteLoopInput(params, this.deps.jarvisRoot, this.deps.createBindings);
    const key = ownershipKey(params.project, params.branch);
    const existingOwner = this.ownership.get(key);
    if (existingOwner !== undefined) {
      throw new OwnershipConflictError(params.project, params.branch, existingOwner);
    }

    const runId = prepareDetachedRunId(this.deps.stateStore, input);
    this.ownership.set(key, runId);

    this.deps.logRepository.append({
      runId,
      level: "info",
      event: "run.accepted",
      data: {
        project: params.project,
        branch: params.branch,
        spec: params.spec,
        artifact: params.artifact,
      },
    });

    this.scheduleRun(input, runId, params.project, params.branch);
    return { runId };
  }

  /** List durable run snapshots plus daemon in-memory activity. */
  list(): RunListResult {
    const runs = this.deps.stateStore.listRuns().map((run) => toListEntry(run, this.activeRunIds.has(run.id)));
    return { runs, activeRunIds: [...this.activeRunIds] };
  }

  private scheduleRun(input: WriteLoopInput, runId: string, project: string, branch: string): void {
    void this.runDetached(input, runId, project, branch);
  }

  private async runDetached(input: WriteLoopInput, runId: string, project: string, branch: string): Promise<void> {
    this.activeRunIds.add(runId);
    this.deps.registerActiveInvocation(runId);
    this.deps.logRepository.append({ runId, level: "info", event: "run.started" });

    try {
      const result = await this.deps.executeWriteLoop({ ...input, stateStore: this.deps.stateStore });
      this.deps.logRepository.append({
        runId,
        level: "info",
        event: "run.iteration",
        data: {
          kind: result.kind,
          iterationsConsumed: result.iterationsConsumed,
          resumable: result.resumable,
        },
      });

      const event = result.kind === "invocation_failure" ? "run.failed" : "run.finished";
      this.deps.logRepository.append({
        runId,
        level: result.kind === "invocation_failure" ? "error" : "info",
        event,
        data: {
          kind: result.kind,
          iterationsConsumed: result.iterationsConsumed,
          resumable: result.resumable,
        },
      });
    } catch (error: unknown) {
      this.deps.logRepository.append({
        runId,
        level: "error",
        event: "run.failed",
        data: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      this.activeRunIds.delete(runId);
      this.deps.unregisterActiveInvocation(runId);
      const run = this.deps.stateStore.loadRun(runId);
      if (run !== null && releasesOwnership(run.status)) {
        this.ownership.delete(ownershipKey(project, branch));
      }
    }
  }
}

/**
 * Parse and validate `run.start` params.
 * @returns Parsed params or a structured IPC error.
 */
export function parseRunStartParams(
  params: unknown,
): { ok: true; value: RunStartParams } | { ok: false; error: { code: string; message: string } } {
  if (typeof params !== "object" || params === null) {
    return { ok: false, error: { code: "invalid_params", message: "run.start requires params object" } };
  }

  const record = params as Record<string, unknown>;
  const projectRoot = stringField(record, "projectRoot");
  const project = stringField(record, "project");
  const branch = stringField(record, "branch");
  const base = stringField(record, "base");
  const spec = stringField(record, "spec");
  const artifact = stringField(record, "artifact");
  if (
    projectRoot === undefined ||
    project === undefined ||
    branch === undefined ||
    base === undefined ||
    spec === undefined ||
    artifact === undefined
  ) {
    return {
      ok: false,
      error: {
        code: "invalid_params",
        message: "run.start requires projectRoot, project, branch, base, spec, and artifact strings",
      },
    };
  }

  const parsed: RunStartParams = { projectRoot, project, branch, base, spec, artifact };
  const agents = parseAgentsField(record.agents);
  if (agents === null) {
    return { ok: false, error: { code: "invalid_params", message: "agents must be a non-empty string array" } };
  }
  if (agents !== undefined) {
    parsed.agents = agents;
  }

  const maxIterations = parseMaxIterationsField(record.maxIterations);
  if (maxIterations === null) {
    return { ok: false, error: { code: "invalid_params", message: "maxIterations must be a positive integer" } };
  }
  if (maxIterations !== undefined) {
    parsed.maxIterations = maxIterations;
  }

  return { ok: true, value: parsed };
}

function prepareDetachedRunId(store: StateStore, input: WriteLoopInput): string {
  const existing = store.findRunByProjectBranch({
    project: input.worktree.projectName,
    branch: input.worktree.branchName,
  });
  if (existing !== null) {
    return existing.id;
  }

  return store.createRun({
    project: input.worktree.projectName,
    specRef: input.worktree.baseRef,
    worktreePath: getExternalWorktreePath(input.worktree),
    branch: input.worktree.branchName,
    specPath: input.specPath,
  });
}

function buildWriteLoopInput(
  params: RunStartParams,
  jarvisRoot: string,
  createBindings: (agentIds: readonly string[]) => readonly InvocationBinding[],
): WriteLoopInput {
  const agents = params.agents ?? DEFAULT_AGENTS;
  const input: WriteLoopInput = {
    worktree: {
      projectRoot: params.projectRoot,
      projectName: params.project,
      branchName: params.branch,
      baseRef: params.base,
      jarvisRoot,
    },
    specPath: params.spec,
    stepRules: DEFAULT_STEP_RULES,
    expectedArtifactPath: params.artifact,
    bindings: createBindings(agents),
  };
  if (params.maxIterations !== undefined) {
    input.maxIterations = params.maxIterations;
  }
  return input;
}

function ownershipKey(project: string, branch: string): string {
  return `${project}\0${branch}`;
}

function toListEntry(run: Run, active: boolean): RunListEntry {
  return {
    id: run.id,
    project: run.project,
    branch: run.branch,
    status: run.status,
    createdAt: run.createdAt,
    attemptCount: run.attemptCount,
    specPath: run.specPath,
    worktreePath: run.worktreePath,
    active,
  };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function parseAgentsField(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    return null;
  }
  return value;
}

function parseMaxIterationsField(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}
