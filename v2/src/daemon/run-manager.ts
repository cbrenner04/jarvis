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

/** IPC params for steering methods (`run.pause`, `run.resume`, `run.kill`). */
export type RunSteeringParams = { runId: string };

/** Result of an accepted detached run start. */
export type RunStartResult = { runId: string };

/** Result of an accepted steering request. */
export type RunSteeringResult = { accepted: true };

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

/** Thrown when a steering request cannot be applied to the target run. */
export class SteeringError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const OWNERSHIP_RESERVING_STATUSES: ReadonlySet<RunStatus> = new Set([
  "in-progress",
  "blocked",
  "budget-soft-stopped",
  "paused",
  "killed",
]);

const RESUMABLE_STATUSES: ReadonlySet<RunStatus> = new Set(["paused", "killed", "budget-soft-stopped", "blocked"]);

type RunSession = {
  params: RunStartParams;
  input: WriteLoopInput;
  project: string;
  branch: string;
  abortController: AbortController;
  pauseRequested: boolean;
  killRequested: boolean;
};

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
 * async scheduling, steering, and structured run lifecycle logs.
 */
export class RunManager {
  private readonly ownership = new Map<string, string>();
  private readonly activeRunIds = new Set<string>();
  private readonly sessions = new Map<string, RunSession>();
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
    this.upsertSession(runId, params, input, params.project, params.branch);

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

    this.scheduleRun(runId);
    return { runId };
  }

  /** Request graceful pause at the next write-loop boundary. */
  pause(runId: string): RunSteeringResult {
    requireRun(this.deps.stateStore, runId);
    if (!this.activeRunIds.has(runId)) {
      throw new SteeringError("invalid_state", "run is not active");
    }
    const session = this.sessions.get(runId);
    if (session === undefined) {
      throw new SteeringError("missing_start_context", "run start context is unavailable");
    }
    session.pauseRequested = true;
    this.deps.logRepository.append({ runId, level: "info", event: "run.pause-requested" });
    return { accepted: true };
  }

  /** Resume a steered or budget-stopped run with the next write-loop invocation. */
  resume(runId: string): RunSteeringResult {
    const run = requireRun(this.deps.stateStore, runId);
    if (this.activeRunIds.has(runId)) {
      throw new SteeringError("invalid_state", "run is already active");
    }
    if (!RESUMABLE_STATUSES.has(run.status)) {
      throw new SteeringError("invalid_state", `run status ${run.status} is not resumable`);
    }
    const session = this.sessions.get(runId);
    if (session === undefined) {
      throw new SteeringError("missing_start_context", "run start context is unavailable");
    }
    const priorStopCause = run.stopCause;
    this.deps.logRepository.append({
      runId,
      level: "info",
      event: "run.resume-requested",
      data: {
        priorStopCause,
        resumeBranch: priorStopCause === "paused-at-boundary" ? "next-iteration" : "interrupted-attempt",
      },
    });
    session.abortController = new AbortController();
    session.pauseRequested = false;
    session.killRequested = false;
    this.deps.stateStore.setRunStatus(runId, "in-progress", null);
    this.scheduleRun(runId);
    return { accepted: true };
  }

  /** Abort the active invocation immediately and mark the run killed. */
  kill(runId: string): RunSteeringResult {
    requireRun(this.deps.stateStore, runId);
    if (!this.activeRunIds.has(runId)) {
      throw new SteeringError("invalid_state", "run is not active");
    }
    const session = this.sessions.get(runId);
    if (session === undefined) {
      throw new SteeringError("missing_start_context", "run start context is unavailable");
    }
    session.killRequested = true;
    this.deps.logRepository.append({ runId, level: "info", event: "run.kill-requested" });
    session.abortController.abort("steering-kill");
    return { accepted: true };
  }

  /** List durable run snapshots plus daemon in-memory activity. */
  list(): RunListResult {
    const runs = this.deps.stateStore.listRuns().map((run) => toListEntry(run, this.activeRunIds.has(run.id)));
    return { runs, activeRunIds: [...this.activeRunIds] };
  }

  private upsertSession(
    runId: string,
    params: RunStartParams,
    input: WriteLoopInput,
    project: string,
    branch: string,
  ): void {
    const existing = this.sessions.get(runId);
    if (existing !== undefined) {
      existing.params = params;
      existing.input = input;
      existing.project = project;
      existing.branch = branch;
      existing.abortController = new AbortController();
      existing.pauseRequested = false;
      existing.killRequested = false;
      return;
    }
    this.sessions.set(runId, {
      params,
      input,
      project,
      branch,
      abortController: new AbortController(),
      pauseRequested: false,
      killRequested: false,
    });
  }

  private scheduleRun(runId: string): void {
    void this.runDetached(runId);
  }

  private async runDetached(runId: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (session === undefined) {
      throw new Error(`missing session for run ${runId}`);
    }

    this.activeRunIds.add(runId);
    this.deps.registerActiveInvocation(runId);
    this.deps.logRepository.append({ runId, level: "info", event: "run.started" });

    const loopInput: WriteLoopInput = {
      ...session.input,
      stateStore: this.deps.stateStore,
      signal: session.abortController.signal,
      shouldPauseAtBoundary: () => session.pauseRequested,
    };

    try {
      const result = await this.deps.executeWriteLoop(loopInput);

      if (session.killRequested) {
        this.deps.stateStore.setRunStatus(runId, "killed", "interrupted");
      }

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

      if (session.killRequested) {
        this.deps.logRepository.append({
          runId,
          level: "info",
          event: "run.killed",
          data: { stopCause: "interrupted" },
        });
        return;
      }

      if (result.kind === "paused-at-boundary") {
        this.deps.logRepository.append({
          runId,
          level: "info",
          event: "run.paused",
          data: { stopCause: "paused-at-boundary" },
        });
        return;
      }

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
      if (session.killRequested) {
        this.deps.stateStore.setRunStatus(runId, "killed", "interrupted");
        this.deps.logRepository.append({
          runId,
          level: "info",
          event: "run.killed",
          data: { stopCause: "interrupted" },
        });
        return;
      }
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
        this.ownership.delete(ownershipKey(session.project, session.branch));
        this.sessions.delete(runId);
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

/**
 * Parse and validate steering params (`run.pause`, `run.resume`, `run.kill`).
 * @returns Parsed params or a structured IPC error.
 */
export function parseRunSteeringParams(
  params: unknown,
  method: string,
): { ok: true; value: RunSteeringParams } | { ok: false; error: { code: string; message: string } } {
  if (typeof params !== "object" || params === null) {
    return { ok: false, error: { code: "invalid_params", message: `${method} requires params object` } };
  }
  const runId = stringField(params as Record<string, unknown>, "runId");
  if (runId === undefined) {
    return { ok: false, error: { code: "invalid_params", message: `${method} requires string runId` } };
  }
  return { ok: true, value: { runId } };
}

function requireRun(store: StateStore, runId: string): Run {
  const run = store.loadRun(runId);
  if (run === null) {
    throw new SteeringError("run_not_found", `run not found: ${runId}`);
  }
  return run;
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
