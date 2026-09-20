import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { resolveCiTestScope } from "../../../scripts/ci-test-scope.ts";
import {
  DEADLINE_KILL_MARKER,
  DEFAULT_TIMEOUT_MS as READY_RUN_CEILING_MS,
  READY_STEP_COMPLETION_MARKER,
  READY_STEP_START_MARKER,
  type ReadyStepCompletion,
  type ReadyStepStart,
  TIMEOUT_EXIT_CODE,
} from "../../../scripts/ready.ts";
import {
  aggregateExitCode,
  FAILING_TEST_FILE_MARKER,
  runV2TestFiles,
  type SpawnOutcome,
} from "../../../scripts/run-v2-tests.ts";
import { errorMessage } from "../../../shared/error-message.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  isSubprocessTimeout,
  networkSubprocessOptions,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import type { LoopFinishedEvent, PersistedRecord } from "../persistence/log-stream.ts";
import { MATERIALIZED_NODE_MODULES_PATH } from "./external-worktree.ts";
import { listMarkdownFilesRecursive } from "./fs-walk.ts";
import {
  defaultPublicationDelay,
  defaultPublicationRetryNotice,
  runPublicationWithRetry,
} from "./publication-retry.ts";
import { normalizePublicationSpecPath } from "./publication-spec-path.ts";
import type { SmokePass, VerificationResult } from "./runtime-smoke-verifier.ts";
import { trackProcessGroup, type VerifierProcessGroupRecorder } from "./verifier-process-groups.ts";

export type ReadyFinalizeInput = {
  worktreePath: string;
  branch: string;
  baseRef: string;
  /** PR number this publication call resolved as the current open draft; the default flip targets it. */
  prNumber?: number;
  requiredIntegrationScope?: string;
  signal?: AbortSignal;
  /** Records each finalization spawn's process group on the owning run row. */
  verifierProcessGroups?: VerifierProcessGroupRecorder;
  /** Per-project ready command override (`bun run ready` when unset). */
  readyCommand?: string;
  /** Skip only the project ready gate; the remaining finalization checks still run. */
  skipReadyGate?: boolean;
};

const DEFAULT_READY_COMMAND = "bun run ready";

/** Spawn tokens plus the display string used for `ReadyGateError.command`, gate-failure
 *  classification, and the repair prompt's `GATE_COMMAND`. */
export function resolveReadyGateCommand(readyCommand?: string): { head: string; args: string[]; display: string } {
  const tokens = (readyCommand ?? DEFAULT_READY_COMMAND).trim().split(/\s+/);
  const head = tokens[0] ?? "bun";
  const args = tokens.slice(1);
  return { head, args, display: [head, ...args].join(" ") };
}

export type ReadyGate = (
  worktreePath: string,
  baseRef: string,
  options?: {
    signal?: AbortSignal | undefined;
    processGroups?: VerifierProcessGroupRecorder | undefined;
    readyCommand?: string | undefined;
  },
) => Promise<void>;
export type GhReadyFlip = (branch: string, worktreePath: string) => Promise<void>;
/** Flips a draft ready by PR number rather than branch, so GitHub can't pick a different PR for the branch. */
export type GhReadyFlipByNumber = (
  prNumber: number | undefined,
  worktreePath: string,
  signal?: AbortSignal,
) => Promise<void>;
type Delay = (ms: number) => Promise<void>;
type RetryNotice = (message: string) => void;

type MutationVerificationRunner = (
  worktreePath: string,
  baseRef: string,
  processGroups?: VerifierProcessGroupRecorder,
) => Promise<void>;
type RuntimeSmokeVerificationRunner = (
  worktreePath: string,
  baseRef: string,
  processGroups?: VerifierProcessGroupRecorder,
) => Promise<VerificationResult>;

export type ReadyFinalizerSeams = {
  runReadyGate?: ReadyGate;
  ghReadyFlip?: GhReadyFlipByNumber;
  delay?: Delay;
  retryNotice?: RetryNotice;
  asyncSubprocessRunner?: AsyncSubprocessRunner;
  runRequiredIntegration?: RequiredIntegrationRunner;
  runMutationVerification?: MutationVerificationRunner;
  runRuntimeSmokeVerification?: RuntimeSmokeVerificationRunner;
  /** Whether the worktree's package.json defines `script`; required integration is skipped when it does not. */
  hasPackageScript?: (worktreePath: string, script: string) => boolean;
  /** Base-scoped test scope the default ready gate runs (`JARVIS_READY_TEST_SCOPE`). */
  resolveReadyTestScope?: (worktreePath: string, baseRef: string) => Promise<"full" | string[]>;
};

export type ReadyFinalizationResult = {
  runtimeSmokeOutcome?: SmokePass;
};

export type ReadyFinalizer = (
  input: ReadyFinalizeInput,
) => Promise<ReadyFinalizationResult | undefined> | Promise<void>;

export class ReadyFlipError extends Error {
  constructor(
    readonly readyFlipError: Error,
    readonly runtimeSmokeOutcome: SmokePass,
  ) {
    super(readyFlipError.message, { cause: readyFlipError });
    this.name = "ReadyFlipError";
  }
}

export type ReadyGateFailureKind = "ready_gate_failed" | "ready_gate_out_of_scope" | "ready_gate_command_missing";

const READY_GATE_COMMAND_MISSING_EVIDENCE_MAX = 512;

const ANCHORED_MISSING_COMMAND_LINE = /^(?:error:\s*)?script not found|^command not found:/i;

function capReadyGateCommandMissingEvidence(text: string): string {
  const trimmed = text.trim();
  const codeUnits = [...trimmed];
  if (codeUnits.length <= READY_GATE_COMMAND_MISSING_EVIDENCE_MAX) {
    return trimmed;
  }
  return codeUnits.slice(0, READY_GATE_COMMAND_MISSING_EVIDENCE_MAX).join("");
}

/** Spawn `ENOENT` or an anchored package-manager/shell missing-command line; undefined otherwise. */
export function findMissingReadyGateCommandEvidence(output: string, spawnCode?: string): string | undefined {
  if (spawnCode === "ENOENT") {
    return capReadyGateCommandMissingEvidence(spawnCode);
  }
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (ANCHORED_MISSING_COMMAND_LINE.test(trimmed)) {
      return capReadyGateCommandMissingEvidence(trimmed);
    }
  }
  return undefined;
}

/** True when spawn signal or anchored output names a missing gate command. */
export function isMissingReadyGateCommandOutput(output: string, spawnCode?: string): boolean {
  return findMissingReadyGateCommandEvidence(output, spawnCode) !== undefined;
}

/** A confirmed out-of-scope path's base-ref probe observation: the per-test reporter counts and
 *  the verified merge-base commit the probe reproduced against. */
export type BaseRefProbeObservation = { pass: number; fail: number; baseCommit: string };

export type ReadyGateClassification = {
  kind: ReadyGateFailureKind;
  outsidePaths?: readonly string[];
  outsidePathObservations?: Record<string, BaseRefProbeObservation>;
  gateRepairAllowsetPaths?: readonly string[];
  baseRefProbeError?: string;
  commandMissingEvidence?: string;
  readyCommandSource?: "configured" | "default";
};

export type ReadyGateScopeInput = {
  worktreePath: string;
  baseRef: string;
  specPath: string;
  /** Per-project ready command override, for matching `ReadyGateError.command` at classification. */
  readyCommand?: string;
  /** Records the base-ref reproduction probe's process group on the owning run row. */
  verifierProcessGroups?: VerifierProcessGroupRecorder;
};

export type BaseRefProbeResult =
  | "pass"
  | ({ kind: "fail" } & BaseRefProbeObservation)
  | { kind: "error"; message: string };

export type ReproduceReadyGateAtBaseRef = (
  scope: ReadyGateScopeInput,
  terminalCommand: string,
  path: string,
) => Promise<BaseRefProbeResult>;

export type ReadyGateScopeSeams = {
  gitDiffNameStatus?: (worktreePath: string, baseRef: string) => Promise<string | null>;
  gitUntracked?: (worktreePath: string) => Promise<string | null>;
  listSpecTreePaths?: (worktreePath: string, specPath: string) => Promise<string[] | null>;
  reproduceReadyGateAtBaseRef?: ReproduceReadyGateAtBaseRef;
};

export class ReadyGateError extends Error {
  readonly gateFailureKind: ReadyGateFailureKind;
  readonly outsidePaths?: readonly string[];
  readonly outsidePathObservations?: Record<string, BaseRefProbeObservation>;
  readonly gateRepairAllowsetPaths?: readonly string[];
  readonly baseRefProbeError?: string;
  readonly scopeBaseRef?: string;
  readonly commandMissingEvidence?: string;
  readonly readyCommandSource?: "configured" | "default";

  constructor(
    readonly command: string,
    readonly exitCode: number | undefined,
    readonly output: string,
    readonly timedOut: boolean = false,
    classification?: ReadyGateClassification,
    scopeBaseRef?: string,
    readonly spawnCode?: string,
  ) {
    super(`ready gate failed (exit ${exitCode ?? "unknown"}): ${output.trim()}`);
    this.name = "ReadyGateError";
    this.gateFailureKind = classification?.kind ?? "ready_gate_failed";
    if (classification?.outsidePaths !== undefined) {
      this.outsidePaths = classification.outsidePaths;
    }
    if (classification?.outsidePathObservations !== undefined) {
      this.outsidePathObservations = classification.outsidePathObservations;
    }
    if (classification?.gateRepairAllowsetPaths !== undefined) {
      this.gateRepairAllowsetPaths = classification.gateRepairAllowsetPaths;
    }
    if (classification?.baseRefProbeError !== undefined) {
      this.baseRefProbeError = classification.baseRefProbeError;
    }
    if (classification?.commandMissingEvidence !== undefined) {
      this.commandMissingEvidence = classification.commandMissingEvidence;
    }
    if (classification?.readyCommandSource !== undefined) {
      this.readyCommandSource = classification.readyCommandSource;
    }
    if (scopeBaseRef !== undefined) {
      this.scopeBaseRef = scopeBaseRef;
    }
  }
}

export function readyGateFailureLogFields(
  loopOutcomeKind: LoopFinishedEvent["loopOutcomeKind"],
  source: Error | undefined,
) {
  if (
    (loopOutcomeKind !== "ready_gate_failed" && loopOutcomeKind !== "ready_gate_command_missing") ||
    !(source instanceof ReadyGateError) ||
    source.gateFailureKind !== loopOutcomeKind
  ) {
    return {};
  }
  const output = source.output.trim().slice(-4096);
  return {
    readyGateCommand: source.command,
    ...(output.length > 0 ? { readyGateOutput: output } : {}),
    ...(loopOutcomeKind === "ready_gate_command_missing" && source.commandMissingEvidence !== undefined
      ? { readyGateCommandMissingEvidence: source.commandMissingEvidence }
      : {}),
    ...(loopOutcomeKind === "ready_gate_command_missing" && source.readyCommandSource !== undefined
      ? { readyGateCommandSource: source.readyCommandSource }
      : {}),
  };
}

/** Normalize and validate a repo-relative path; reject absolute, escaping, empty, or malformed values. */
export function validateRepoRelativePath(path: string): string | undefined {
  if (path.length === 0 || path.trim() !== path) {
    return undefined;
  }
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return undefined;
    }
    parts.push(segment);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join("/");
}

function parseMarkerRecords<T>(output: string, marker: string, validate: (value: unknown) => value is T): T[] {
  const records: T[] = [];
  for (const line of output.split("\n")) {
    if (!line.startsWith(marker)) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line.slice(marker.length));
      if (validate(parsed)) {
        records.push(parsed);
      }
    } catch {
      // malformed records are ignored at parse time
    }
  }
  return records;
}

function isReadyStepCompletion(value: unknown): value is ReadyStepCompletion {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as ReadyStepCompletion;
  return (
    typeof record.stepId === "string" &&
    typeof record.attemptId === "string" &&
    typeof record.command === "string" &&
    typeof record.status === "number"
  );
}

function isFailingTestFileRecord(value: unknown): value is { attemptId: string; path: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { attemptId: string; path: string };
  return typeof record.attemptId === "string" && typeof record.path === "string";
}

export function isReadyTestCommand(command: string): boolean {
  return /^bun run test(?::|$)/.test(command);
}

function isReadyAttributionCommand(command: string): boolean {
  return isReadyTestCommand(command) || command === "bun run lint:md";
}

function validateAndDeduplicatePaths(rawPaths: readonly string[]): string[] | undefined {
  const seen = new Map<string, string>();
  const result: string[] = [];
  for (const raw of rawPaths) {
    const normalized = validateRepoRelativePath(raw);
    if (normalized === undefined) {
      return undefined;
    }
    const prior = seen.get(normalized);
    if (prior !== undefined && prior !== raw) {
      return undefined;
    }
    if (prior === undefined) {
      seen.set(normalized, raw);
      result.push(normalized);
    }
  }
  return result;
}

/** Terminal failed ready step from gate output; undefined when attribution is incomplete. */
export function selectTerminalFailedReadyStep(output: string): ReadyStepCompletion | undefined {
  const terminalFailed = selectTerminalFailedReadyCompletion(output);
  if (terminalFailed === undefined || !isReadyAttributionCommand(terminalFailed.command)) {
    return undefined;
  }
  return terminalFailed;
}

/** Select validated failing paths from the terminal failed ready test step's final attempt. */
export function selectTerminalFailingPaths(output: string): string[] | undefined {
  const terminalFailed = selectTerminalFailedReadyTestStep(output);
  if (terminalFailed === undefined) {
    return undefined;
  }
  const fileRecords = parseMarkerRecords(output, FAILING_TEST_FILE_MARKER, isFailingTestFileRecord);
  const matching = fileRecords.filter((record) => record.attemptId === terminalFailed.attemptId);
  if (matching.length === 0) {
    return undefined;
  }
  return validateAndDeduplicatePaths(matching.map((record) => record.path));
}

/** Select validated failing paths from the terminal failed ready step's final attempt. */
export function selectTerminalAttributablePaths(output: string): string[] | undefined {
  const terminalFailed = selectTerminalFailedReadyStep(output);
  if (terminalFailed === undefined) {
    return undefined;
  }
  const fileRecords = parseMarkerRecords(output, FAILING_TEST_FILE_MARKER, isFailingTestFileRecord);
  const matching = fileRecords.filter((record) => record.attemptId === terminalFailed.attemptId);
  if (matching.length === 0) {
    return undefined;
  }
  return validateAndDeduplicatePaths(matching.map((record) => record.path));
}

/** Terminal failed ready test step from gate output; undefined when attribution is incomplete. */
export function selectTerminalFailedReadyTestStep(output: string): ReadyStepCompletion | undefined {
  const terminalFailed = selectTerminalFailedReadyCompletion(output);
  if (terminalFailed === undefined || !isReadyTestCommand(terminalFailed.command)) {
    return undefined;
  }
  return terminalFailed;
}

/** Terminal non-zero ready step completion of any command. */
function selectTerminalFailedReadyCompletion(output: string): ReadyStepCompletion | undefined {
  const completions = parseMarkerRecords(output, READY_STEP_COMPLETION_MARKER, isReadyStepCompletion);
  return [...completions].reverse().find((record) => record.status !== 0);
}

function isReadyStepStart(value: unknown): value is ReadyStepStart {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as ReadyStepStart;
  return (
    typeof record.stepId === "string" && typeof record.attemptId === "string" && typeof record.command === "string"
  );
}

/**
 * Repair-prompt view of a failed gate: the terminal failed step's command and its own output
 * (every attempt, both streams), or the gate command and whole log when the step is unattributable.
 */
export function selectFailedReadyStepOutput(gateCommand: string, log: string): { step: string; output: string } {
  const failed = selectTerminalFailedReadyCompletion(log);
  const starts: { stepId: string; recordStart: number; bodyStart: number }[] = [];
  for (const match of log.matchAll(new RegExp(`^${READY_STEP_START_MARKER}(.*)$`, "gm"))) {
    try {
      const parsed: unknown = JSON.parse(match[1] ?? "");
      if (isReadyStepStart(parsed)) {
        starts.push({ stepId: parsed.stepId, recordStart: match.index, bodyStart: match.index + match[0].length });
      }
    } catch {
      // malformed records are ignored at parse time
    }
  }
  const segments = starts.flatMap((start, index) =>
    start.stepId === failed?.stepId ? [log.slice(start.bodyStart, starts[index + 1]?.recordStart ?? log.length)] : [],
  );
  return failed === undefined || segments.length === 0
    ? { step: gateCommand, output: log }
    : { step: failed.command, output: segments.join("") };
}

const BASE_REF_PROBE_OUTPUT_TAIL_CHARS = 4096;

function capBaseRefProbeOutputTail(output: string): string {
  return output.slice(-BASE_REF_PROBE_OUTPUT_TAIL_CHARS).trim();
}

function formatBaseRefProbeError(error: unknown, exitCode?: number, output?: string): string {
  const parts: string[] = [];
  if (exitCode !== undefined) {
    parts.push(`exit ${exitCode}`);
  }
  if (output !== undefined && output.length > 0) {
    parts.push(capBaseRefProbeOutputTail(output));
  }
  if (parts.length === 0) {
    return errorMessage(error);
  }
  return parts.join(": ");
}

function buildBaseRefProbeCommandArgs(_terminalCommand: string, failingPath: string): string[] {
  return ["test", failingPath];
}

function v2ProbeModeFromTerminalCommand(terminalCommand: string): "agent" | "integration" | undefined {
  if (terminalCommand === "bun run test:v2") {
    return "agent";
  }
  if (terminalCommand === "bun run test:integration:v2") {
    return "integration";
  }
  return undefined;
}

function createWorktreeSpawn(
  runner: AsyncSubprocessRunner,
  worktreeDir: string,
  processGroups: VerifierProcessGroupRecorder | undefined,
  env: NodeJS.ProcessEnv | undefined,
  onFailure?: (outcome: { output: string; timedOut: boolean }) => void,
): (command: string, args: string[], options: { timeout: number }) => Promise<SpawnOutcome> {
  return async (command, args, options) => {
    const tracked = trackProcessGroup(processGroups);
    try {
      await runner.runAsync(command, args, worktreeDir, {
        maxBuffer: READY_GATE_MAX_BUFFER,
        timeoutMs: options.timeout,
        ...(env !== undefined ? { env } : {}),
        processGroup: tracked.processGroup,
      });
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    } catch (error) {
      if (error instanceof AsyncSubprocessError) {
        const timedOut = isSubprocessTimeout(error);
        onFailure?.({ output: `${error.stdout}${error.stderr}`, timedOut });
        return {
          status: error.status ?? 1,
          signal: null,
          stdout: error.stdout,
          stderr: error.stderr,
          timedOut,
        };
      }
      throw error;
    }
  };
}

/** True when `output` names an individual bun-test test case as failing (bun's `(fail) ` reporter
 *  line), not merely a non-zero exit — distinguishes a genuine test failure from a crash (e.g. a
 *  missing-dependency import error) that also exits non-zero but never runs a test. */
export function hasFailingTestEvidence(output: string): boolean {
  return /^\s*\(fail\)\s/m.test(output);
}

/** Prefixes `reason` onto the probe output's tail, matching {@link formatBaseRefProbeError}'s cap
 *  but keeping `reason` even when output is present (that function drops its `error` argument's
 *  message whenever output is non-empty). */
function formatBaseRefProbeInconclusiveReason(reason: string, output: string): string {
  const tail = capBaseRefProbeOutputTail(output);
  return tail.length === 0 ? reason : `${reason}: ${tail}`;
}

/** A base-ref probe's conclusive-fail outcome before `baseCommit` is attached: the caller that
 *  already verified the probe's merge-base attaches it once, rather than re-deriving it here. */
type BaseRefProbeFailureClassification =
  | { kind: "fail"; pass: number; fail: number }
  | { kind: "error"; message: string };

/** Count bun test outcomes for the given marker. Bun prints per-test `(pass)` lines only in some
 *  reporter modes but always ends each file with `N pass` / `N fail` summary lines, so summaries
 *  are preferred; per-test reporter lines are the fallback when no summary is present. */
function countBunTestReporterLines(output: string, marker: "pass" | "fail"): number {
  const summaries = [...output.matchAll(new RegExp(`^\\s*(\\d+) ${marker}\\s*$`, "gm"))];
  if (summaries.length > 0) return summaries.reduce((total, match) => total + Number(match[1]), 0);
  const matches = output.match(new RegExp(`^\\s*\\(${marker}\\)\\s`, "gm"));
  return matches?.length ?? 0;
}

/** Decide a base-ref probe's `bun test <path>` outcome from its captured output: a timeout is
 *  always inconclusive (its output cannot name a failing test); otherwise a conclusive `fail`
 *  requires named failing-test evidence, not merely the non-zero exit that got us here. */
function classifyBaseRefProbeFailure(output: string, timedOut: boolean): BaseRefProbeFailureClassification {
  if (timedOut) {
    return { kind: "error", message: formatBaseRefProbeInconclusiveReason("base-ref probe timed out", output) };
  }
  if (hasFailingTestEvidence(output)) {
    return {
      kind: "fail",
      pass: countBunTestReporterLines(output, "pass"),
      fail: countBunTestReporterLines(output, "fail"),
    };
  }
  return {
    kind: "error",
    message: formatBaseRefProbeInconclusiveReason("base-ref probe produced no failing-test evidence", output),
  };
}

/** Symlink the source worktree's `node_modules` into a fresh probe worktree, mirroring
 *  `ensureExternalWorktree`'s materialization: without it, `bun test` in a probe tree created
 *  outside the project directory (via `mkdtempSync`) cannot resolve dependencies and crashes
 *  before running any test, a non-zero exit indistinguishable from a real regression. */
function symlinkProbeNodeModules(sourceWorktreePath: string, probeWorktreeDir: string): void {
  const sourceNodeModules = join(sourceWorktreePath, MATERIALIZED_NODE_MODULES_PATH);
  if (statSync(sourceNodeModules, { throwIfNoEntry: false })?.isDirectory()) {
    symlinkSync(sourceNodeModules, join(probeWorktreeDir, MATERIALIZED_NODE_MODULES_PATH), "dir");
  }
}

async function removeDetachedWorktree(
  runner: AsyncSubprocessRunner,
  projectRoot: string,
  worktreeDir: string,
): Promise<void> {
  try {
    await runner.runAsync("git", ["worktree", "remove", "--force", worktreeDir], projectRoot);
  } catch {
    if (existsSync(worktreeDir)) {
      rmSync(worktreeDir, { recursive: true, force: true });
    }
  }
}

/** Runs the probed command in an already-verified base-ref worktree and classifies its outcome. */
async function runBaseRefProbeCommand(
  runner: AsyncSubprocessRunner,
  scope: ReadyGateScopeInput,
  worktreeDir: string,
  terminalCommand: string,
  path: string,
  probeEnv: NodeJS.ProcessEnv,
): Promise<"pass" | BaseRefProbeFailureClassification> {
  const v2Mode = v2ProbeModeFromTerminalCommand(terminalCommand);
  try {
    if (v2Mode !== undefined) {
      let failure: { output: string; timedOut: boolean } | undefined;
      const results = await runV2TestFiles(
        v2Mode,
        [path],
        createWorktreeSpawn(runner, worktreeDir, scope.verifierProcessGroups, probeEnv, (outcome) => {
          failure = outcome;
        }),
      );
      if (aggregateExitCode(results) === 0) {
        return "pass";
      }
      return failure === undefined
        ? { kind: "error", message: "base-ref probe produced no captured output" }
        : classifyBaseRefProbeFailure(failure.output, failure.timedOut);
    }
    const tracked = trackProcessGroup(scope.verifierProcessGroups);
    try {
      await runner.runAsync("bun", buildBaseRefProbeCommandArgs(terminalCommand, path), worktreeDir, {
        maxBuffer: READY_GATE_MAX_BUFFER,
        timeoutMs: readyGateSubprocessTimeoutMs(),
        env: probeEnv,
        processGroup: tracked.processGroup,
      });
    } finally {
      tracked.settle();
    }
    return "pass";
  } catch (error) {
    if (error instanceof AsyncSubprocessError) {
      if (error.status === 0) {
        return "pass";
      }
      return classifyBaseRefProbeFailure(`${error.stdout}${error.stderr}`, isSubprocessTimeout(error));
    }
    return { kind: "error", message: formatBaseRefProbeError(error) };
  }
}

function createDefaultReproduceReadyGateAtBaseRef(runner: AsyncSubprocessRunner): ReproduceReadyGateAtBaseRef {
  return async (scope, terminalCommand, path) => {
    let worktreeDir: string | undefined;
    try {
      const baseCommit = (
        await runner.runAsync("git", ["merge-base", scope.baseRef, "HEAD"], scope.worktreePath)
      ).trim();
      worktreeDir = mkdtempSync(join(tmpdir(), "jarvis-ready-base-ref-probe-"));
      await runner.runAsync("git", ["worktree", "add", "--detach", worktreeDir, baseCommit], scope.worktreePath);
      // Defense-in-depth: `git worktree add --detach` either lands on `baseCommit` or throws
      // (already reported as inconclusive below), so this should never actually mismatch.
      const probeHead = (await runner.runAsync("git", ["rev-parse", "HEAD"], worktreeDir)).trim();
      if (probeHead !== baseCommit) {
        return {
          kind: "error",
          message: `base-ref probe tree ${worktreeDir} is at ${probeHead}, expected verified merge-base ${baseCommit}`,
        };
      }
      symlinkProbeNodeModules(scope.worktreePath, worktreeDir);
      const probeEnv = await deriveReadyGateChildEnv(runner, scope.worktreePath, scope.baseRef);
      const outcome = await runBaseRefProbeCommand(runner, scope, worktreeDir, terminalCommand, path, probeEnv);
      return outcome === "pass" || outcome.kind === "error" ? outcome : { ...outcome, baseCommit };
    } catch (error) {
      if (error instanceof AsyncSubprocessError) {
        const output = `${error.stdout}${error.stderr}`;
        return {
          kind: "error",
          message: formatBaseRefProbeError(error, error.status ?? undefined, output),
        };
      }
      return { kind: "error", message: formatBaseRefProbeError(error) };
    } finally {
      if (worktreeDir !== undefined) {
        await removeDetachedWorktree(runner, scope.worktreePath, worktreeDir);
      }
    }
  };
}

async function probeOutsidePathsAtBaseRef(
  outsidePaths: readonly string[],
  terminalCommand: string,
  scope: ReadyGateScopeInput,
  seams: ReadyGateScopeSeams | undefined,
  runner: AsyncSubprocessRunner,
): Promise<{
  inScopePaths: string[];
  confirmedOutsidePaths: string[];
  outsidePathObservations: Record<string, BaseRefProbeObservation>;
  baseRefProbeError?: string;
}> {
  const reproduce = seams?.reproduceReadyGateAtBaseRef ?? createDefaultReproduceReadyGateAtBaseRef(runner);
  const inScopePaths: string[] = [];
  const confirmedOutsidePaths: string[] = [];
  const outsidePathObservations: Record<string, BaseRefProbeObservation> = {};
  let baseRefProbeError: string | undefined;
  for (const path of outsidePaths) {
    const outcome = await reproduce(scope, terminalCommand, path);
    if (outcome === "pass") {
      inScopePaths.push(path);
      continue;
    }
    if (outcome.kind === "fail") {
      confirmedOutsidePaths.push(path);
      outsidePathObservations[path] = { pass: outcome.pass, fail: outcome.fail, baseCommit: outcome.baseCommit };
      continue;
    }
    inScopePaths.push(path);
    if (baseRefProbeError === undefined) {
      baseRefProbeError = outcome.message;
    }
  }
  return baseRefProbeError === undefined
    ? { inScopePaths, confirmedOutsidePaths, outsidePathObservations }
    : { inScopePaths, confirmedOutsidePaths, outsidePathObservations, baseRefProbeError };
}

/** Classify a ready gate failure from terminal test evidence, allowed paths, and base-ref reproduction. */
export async function classifyReadyGateFailure(
  error: Pick<ReadyGateError, "command" | "output" | "timedOut" | "spawnCode">,
  failingPaths: string[] | undefined,
  allowedPaths: Set<string> | undefined,
  scope?: ReadyGateScopeInput,
  seams?: ReadyGateScopeSeams,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<ReadyGateClassification> {
  if (error.timedOut) {
    return { kind: "ready_gate_failed" };
  }
  const commandMissingEvidence = findMissingReadyGateCommandEvidence(error.output, error.spawnCode);
  if (commandMissingEvidence !== undefined) {
    return {
      kind: "ready_gate_command_missing",
      commandMissingEvidence,
      readyCommandSource: scope?.readyCommand !== undefined ? "configured" : "default",
    };
  }
  if (error.command !== resolveReadyGateCommand(scope?.readyCommand).display) {
    return { kind: "ready_gate_failed" };
  }
  if (failingPaths === undefined || allowedPaths === undefined || failingPaths.length === 0) {
    return { kind: "ready_gate_failed" };
  }
  const outsidePaths = failingPaths.filter((path) => !allowedPaths.has(path));
  if (outsidePaths.length === 0) {
    return { kind: "ready_gate_failed" };
  }
  const mixedAttribution = outsidePaths.length < failingPaths.length;
  const terminalStep = selectTerminalFailedReadyTestStep(error.output);
  if (terminalStep === undefined || scope === undefined) {
    // No base-ref probe is possible without a terminal test step or scope to probe with, so
    // there is no conclusive base-tree failure to exonerate on: settle the ordinary repairable
    // red gate rather than the non-resumable out-of-scope verdict.
    return { kind: "ready_gate_failed" };
  }

  const { inScopePaths, confirmedOutsidePaths, outsidePathObservations, baseRefProbeError } =
    await probeOutsidePathsAtBaseRef(outsidePaths, terminalStep.command, scope, seams, runner);
  const probeFields =
    inScopePaths.length > 0 || baseRefProbeError !== undefined
      ? {
          ...(inScopePaths.length > 0 ? { gateRepairAllowsetPaths: inScopePaths } : {}),
          ...(baseRefProbeError !== undefined ? { baseRefProbeError } : {}),
        }
      : {};

  if (mixedAttribution || inScopePaths.length > 0 || baseRefProbeError !== undefined) {
    return { kind: "ready_gate_failed", ...probeFields };
  }
  return {
    kind: "ready_gate_out_of_scope",
    outsidePaths: confirmedOutsidePaths,
    ...(Object.keys(outsidePathObservations).length > 0 ? { outsidePathObservations } : {}),
  };
}

function parseNulDelimitedPaths(output: string): string[] | undefined {
  if (output.length === 0) {
    return [];
  }
  if (!output.endsWith("\0")) {
    return undefined;
  }
  return output.slice(0, -1).split("\0").filter(Boolean);
}

/** Parse NUL-delimited `git diff --name-status -z` output into changed paths. */
export function parseGitNameStatusZ(output: string): string[] | undefined {
  if (output.length === 0) {
    return [];
  }
  if (!output.endsWith("\0")) {
    return undefined;
  }
  const parts = output.slice(0, -1).split("\0");
  const paths: string[] = [];
  let index = 0;
  while (index < parts.length) {
    const status = parts[index];
    if (status === undefined || status.length === 0) {
      index += 1;
      continue;
    }
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      const oldPath = parts[index + 1];
      const newPath = parts[index + 2];
      if (oldPath === undefined || newPath === undefined) {
        return undefined;
      }
      paths.push(oldPath, newPath);
      index += 3;
      continue;
    }
    const path = parts[index + 1];
    if (path === undefined) {
      return undefined;
    }
    paths.push(path);
    index += 2;
  }
  return paths;
}

/** Resolve the spec scope root and whether it lies inside the worktree (lexical, no `realpath`). */
export function resolveSpecScopeRoot(
  worktreePath: string,
  specPath: string,
): { root: string; insideWorktree: boolean } | null {
  const resolvedSpecPath = isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
  let root: string | null = null;
  try {
    if (statSync(resolvedSpecPath).isDirectory()) {
      root = resolvedSpecPath;
    }
  } catch {
    // fall through to file-based resolution
  }
  if (root === null && basename(resolvedSpecPath).endsWith(".md")) {
    root = dirname(resolvedSpecPath);
  }
  if (root === null) {
    return null;
  }
  const rel = relative(worktreePath, root);
  const insideWorktree = rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  return { root, insideWorktree };
}

function enumerateSpecTreePaths(worktreePath: string, specPath: string): string[] | null {
  const scope = resolveSpecScopeRoot(worktreePath, specPath);
  if (scope === null) {
    const normalized = normalizePublicationSpecPath(worktreePath, specPath);
    const validated = validateRepoRelativePath(normalized);
    return validated === undefined ? null : [validated];
  }
  if (!existsSync(scope.root)) {
    return null;
  }
  if (!scope.insideWorktree) {
    return [];
  }
  const files = listMarkdownFilesRecursive(scope.root);
  const paths: string[] = [];
  for (const file of files) {
    const rel = relative(worktreePath, file).replace(/\\/g, "/");
    const validated = validateRepoRelativePath(rel);
    if (validated === undefined) {
      return null;
    }
    paths.push(validated);
  }
  return paths;
}

/** Derive the fail-closed allowed path set from base diff, untracked inventory, and spec tree. */
export async function deriveGateAllowedPaths(
  scope: ReadyGateScopeInput,
  seams?: ReadyGateScopeSeams,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<Set<string> | undefined> {
  let diffOutput: string | null;
  try {
    diffOutput =
      seams?.gitDiffNameStatus !== undefined
        ? await seams.gitDiffNameStatus(scope.worktreePath, scope.baseRef)
        : await runner.runAsync(
            "git",
            ["diff", "--name-status", "-z", "--diff-filter=ACDMRTUXB", `${scope.baseRef}...HEAD`],
            scope.worktreePath,
            { maxBuffer: READY_GATE_MAX_BUFFER },
          );
  } catch {
    return undefined;
  }
  if (diffOutput === null) {
    return undefined;
  }

  let untrackedOutput: string | null;
  try {
    untrackedOutput =
      seams?.gitUntracked !== undefined
        ? await seams.gitUntracked(scope.worktreePath)
        : await runner.runAsync("git", ["ls-files", "--others", "--exclude-standard", "-z"], scope.worktreePath);
  } catch {
    return undefined;
  }
  if (untrackedOutput === null) {
    return undefined;
  }

  const specPaths =
    seams?.listSpecTreePaths !== undefined
      ? await seams.listSpecTreePaths(scope.worktreePath, scope.specPath)
      : enumerateSpecTreePaths(scope.worktreePath, scope.specPath);
  if (specPaths === null) {
    return undefined;
  }

  const diffPaths = parseGitNameStatusZ(diffOutput);
  if (diffPaths === undefined) {
    return undefined;
  }
  const untrackedPaths = parseNulDelimitedPaths(untrackedOutput);
  if (untrackedPaths === undefined) {
    return undefined;
  }

  const allowed = new Set<string>();
  for (const rawPath of [...diffPaths, ...untrackedPaths, ...specPaths]) {
    const normalized = validateRepoRelativePath(rawPath);
    if (normalized === undefined) {
      return undefined;
    }
    allowed.add(normalized);
  }
  return allowed;
}

/** Classify a ready gate failure from terminal test evidence and the run's allowed path set. */
export async function classifyReadyGateError(
  error: ReadyGateError,
  scope: ReadyGateScopeInput,
  seams?: ReadyGateScopeSeams,
  runner?: AsyncSubprocessRunner,
): Promise<ReadyGateError> {
  const failingPaths = selectTerminalFailingPaths(error.output);
  const allowedPaths = await deriveGateAllowedPaths(scope, seams, runner);
  const classification = await classifyReadyGateFailure(error, failingPaths, allowedPaths, scope, seams, runner);
  if (
    classification.kind === error.gateFailureKind &&
    classification.outsidePaths === error.outsidePaths &&
    classification.outsidePathObservations === error.outsidePathObservations &&
    classification.gateRepairAllowsetPaths === error.gateRepairAllowsetPaths &&
    classification.baseRefProbeError === error.baseRefProbeError &&
    classification.commandMissingEvidence === error.commandMissingEvidence &&
    classification.readyCommandSource === error.readyCommandSource
  ) {
    return error;
  }
  return new ReadyGateError(
    error.command,
    error.exitCode,
    error.output,
    error.timedOut,
    classification,
    scope.baseRef,
    error.spawnCode,
  );
}

export function resolveGateRepairAllowset(frozen: Set<string>, error: ReadyGateError): Set<string> {
  const extension = error.gateRepairAllowsetPaths;
  if (extension === undefined || extension.length === 0) {
    return frozen;
  }
  const extended = new Set(frozen);
  for (const path of extension) {
    extended.add(path);
  }
  return extended;
}

/** Per-gate repair allowset for agent iterations: attributable failing paths for non-test gates, else frozen diff/spec plus extensions. */
export function resolveAttributableRepairAllowset(frozen: Set<string>, error: ReadyGateError): Set<string> {
  const terminalFailed = selectTerminalFailedReadyStep(error.output);
  if (terminalFailed === undefined || isReadyTestCommand(terminalFailed.command)) {
    return resolveGateRepairAllowset(frozen, error);
  }
  const attributablePaths = selectTerminalAttributablePaths(error.output);
  if (attributablePaths === undefined || attributablePaths.length === 0) {
    return resolveGateRepairAllowset(frozen, error);
  }
  const allowset = new Set<string>(attributablePaths);
  const extension = error.gateRepairAllowsetPaths;
  if (extension !== undefined) {
    for (const path of extension) {
      allowset.add(path);
    }
  }
  return allowset;
}

export class SurvivingMutationError extends Error {
  constructor(
    readonly mutation: string,
    readonly sourceSiteFile: string,
    readonly sourceSiteLine: number,
    readonly dualConstraint?: true,
  ) {
    let message = `Surviving mutation in ${sourceSiteFile}:${sourceSiteLine}: ${mutation}`;
    if (dualConstraint) {
      message +=
        "; the changed line sits inside a setTimeout/setInterval callback in a determinism-guarded suite (v2/src/daemon or v2/src/execution .test.ts), which forbids real-timer waits. Both constraints block the natural kill test: test the determinism guard's own condition as a pure exported predicate, then verify both truth directions directly without a real-timer wait.";
    }
    super(message);
    this.name = "SurvivingMutationError";
  }
}

export class NonTerminatingMutationError extends Error {
  constructor(
    readonly mutation: string,
    readonly sourceSiteFile: string,
    readonly sourceSiteLine: number,
  ) {
    super(`Non-terminating mutation in ${sourceSiteFile}:${sourceSiteLine}: ${mutation}`);
    this.name = "NonTerminatingMutationError";
  }
}

export type ReadyGateOutOfScopeLogFields = {
  readyGateOutsidePaths?: string[];
  readyGateOutOfScopeDetail?: string;
  readyGateOutOfScopeObservations?: Record<string, BaseRefProbeObservation>;
};

/** Formats each path bare, or with a trailing `(base <sha>: <pass> pass / <fail> fail)` parenthetical
 *  when the base-ref probe recorded an observation for it. */
export function formatReadyGateOutOfScopeDetail(
  paths: readonly string[],
  baseRef = "baseRef",
  observations?: Record<string, BaseRefProbeObservation>,
): string {
  const formattedPaths = paths.map((path) => {
    const observation = observations?.[path];
    return observation === undefined
      ? path
      : `${path} (base ${observation.baseCommit}: ${observation.pass} pass / ${observation.fail} fail)`;
  });
  return `ready gate failing paths also reproduce on ${baseRef}: ${formattedPaths.join(", ")}`;
}

/** Resumable when outside paths differ from the row's first `ready_gate_out_of_scope` settlement. */
export function outOfScopeSettlementResumable(
  currentPaths: readonly string[] | undefined,
  priorRecords: readonly PersistedRecord[],
): boolean {
  if (currentPaths === undefined || currentPaths.length === 0) return false;
  for (const record of priorRecords) {
    const event = record.event;
    if (
      event.kind === "loop_finished" &&
      event.loopOutcomeKind === "ready_gate_out_of_scope" &&
      event.readyGateOutsidePaths !== undefined
    ) {
      const firstPaths = event.readyGateOutsidePaths;
      if (firstPaths.length !== currentPaths.length) return true;
      const firstSet = new Set(firstPaths);
      return !currentPaths.every((path) => firstSet.has(path));
    }
  }
  return false;
}

export function isResumableOutOfScopeTerminalEvidence(
  event: Pick<LoopFinishedEvent, "loopOutcomeKind" | "resumable" | "readyGateOutsidePaths"> | undefined,
): boolean {
  return event?.loopOutcomeKind === "ready_gate_out_of_scope" && event.resumable === true;
}

export function readyGateOutOfScopeLogFields(
  source: Error | ReadyGateOutOfScopeLogFields | undefined,
): ReadyGateOutOfScopeLogFields {
  if (source === undefined) return {};
  if (
    source instanceof ReadyGateError &&
    source.gateFailureKind === "ready_gate_out_of_scope" &&
    source.outsidePaths !== undefined
  ) {
    return {
      readyGateOutsidePaths: [...source.outsidePaths],
      readyGateOutOfScopeDetail: formatReadyGateOutOfScopeDetail(
        source.outsidePaths,
        source.scopeBaseRef,
        source.outsidePathObservations,
      ),
      ...(source.outsidePathObservations !== undefined
        ? { readyGateOutOfScopeObservations: source.outsidePathObservations }
        : {}),
    };
  }
  if (source instanceof Error) return {};
  const fields: ReadyGateOutOfScopeLogFields = {};
  if (source.readyGateOutsidePaths !== undefined) {
    fields.readyGateOutsidePaths = [...source.readyGateOutsidePaths];
  }
  if (source.readyGateOutOfScopeDetail !== undefined) {
    fields.readyGateOutOfScopeDetail = source.readyGateOutOfScopeDetail;
  }
  if (source.readyGateOutOfScopeObservations !== undefined) {
    fields.readyGateOutOfScopeObservations = source.readyGateOutOfScopeObservations;
  }
  return fields;
}

export type SurvivingMutationLogFields = {
  survivingMutation?: string;
  survivingMutationSourceFile?: string;
  survivingMutationSourceLine?: number;
};

export function survivingMutationLogFields(
  source: Error | SurvivingMutationLogFields | undefined,
): SurvivingMutationLogFields {
  if (source === undefined) return {};
  if (source instanceof SurvivingMutationError) {
    return {
      survivingMutation: source.mutation,
      survivingMutationSourceFile: source.sourceSiteFile,
      survivingMutationSourceLine: source.sourceSiteLine,
    };
  }
  if (source instanceof Error) return {};
  const fields: SurvivingMutationLogFields = {};
  if (source.survivingMutation !== undefined) fields.survivingMutation = source.survivingMutation;
  if (source.survivingMutationSourceFile !== undefined) {
    fields.survivingMutationSourceFile = source.survivingMutationSourceFile;
  }
  if (source.survivingMutationSourceLine !== undefined) {
    fields.survivingMutationSourceLine = source.survivingMutationSourceLine;
  }
  return fields;
}

export type NonTerminatingMutationLogFields = {
  nonTerminatingMutation?: string;
  nonTerminatingMutationSourceFile?: string;
  nonTerminatingMutationSourceLine?: number;
};

export function nonTerminatingMutationLogFields(
  source: Error | NonTerminatingMutationLogFields | undefined,
): NonTerminatingMutationLogFields {
  if (source === undefined) return {};
  if (source instanceof NonTerminatingMutationError) {
    return {
      nonTerminatingMutation: source.mutation,
      nonTerminatingMutationSourceFile: source.sourceSiteFile,
      nonTerminatingMutationSourceLine: source.sourceSiteLine,
    };
  }
  if (source instanceof Error) return {};
  const fields: NonTerminatingMutationLogFields = {};
  if (source.nonTerminatingMutation !== undefined) fields.nonTerminatingMutation = source.nonTerminatingMutation;
  if (source.nonTerminatingMutationSourceFile !== undefined) {
    fields.nonTerminatingMutationSourceFile = source.nonTerminatingMutationSourceFile;
  }
  if (source.nonTerminatingMutationSourceLine !== undefined) {
    fields.nonTerminatingMutationSourceLine = source.nonTerminatingMutationSourceLine;
  }
  return fields;
}

export class RuntimeSmokeFailedError extends Error {
  constructor(
    readonly command: string,
    readonly observation: string,
  ) {
    super(`Runtime smoke failed: ${command} — ${observation}`);
    this.name = "RuntimeSmokeFailedError";
  }
}

const READY_GATE_MAX_BUFFER = 16 * 1024 * 1024;

function isDeadlineKilledGate(error: AsyncSubprocessError, output: string): boolean {
  return error.status === TIMEOUT_EXIT_CODE || output.includes(DEADLINE_KILL_MARKER) || isSubprocessTimeout(error);
}

/** Slack past the ready ceiling so `scripts/ready.ts`'s own deadline kill (exit 124) normally wins. */
const READY_GATE_SUBPROCESS_GRACE_MS = 60_000;

/**
 * Harness-side bound on a ready-gate-class subprocess (ready gate, required integration, base-ref
 * probe): `JARVIS_READY_TIMEOUT_MS` (else the ready run ceiling) plus grace. Covers custom
 * `readyCommand`s that carry no deadline of their own.
 */
export function readyGateSubprocessTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.JARVIS_READY_TIMEOUT_MS ?? "", 10);
  const ceiling = Number.isInteger(parsed) && parsed > 0 ? parsed : READY_RUN_CEILING_MS;
  return ceiling + READY_GATE_SUBPROCESS_GRACE_MS;
}

async function getChangedPathsWithResolvability(
  runner: AsyncSubprocessRunner,
  worktreePath: string,
  baseRef: string,
): Promise<{ paths: string[]; baseResolvable: boolean }> {
  try {
    const result = await runner.runAsync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACM", `${baseRef}...HEAD`],
      worktreePath,
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const paths = result
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    try {
      const untrackedResult = await runner.runAsync(
        "git",
        ["ls-files", "--others", "--exclude-standard"],
        worktreePath,
      );
      const untrackedPaths = untrackedResult
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean);
      return { paths: [...paths, ...untrackedPaths], baseResolvable: true };
    } catch {
      return { paths, baseResolvable: true };
    }
  } catch {
    return { paths: [], baseResolvable: false };
  }
}

async function resolveReadyTestScope(
  runner: AsyncSubprocessRunner,
  worktreePath: string,
  baseRef: string,
): Promise<ReturnType<typeof resolveCiTestScope>> {
  const { paths: changedPaths, baseResolvable } = await getChangedPathsWithResolvability(runner, worktreePath, baseRef);
  return resolveCiTestScope(changedPaths, baseResolvable);
}

async function deriveReadyGateChildEnv(
  runner: AsyncSubprocessRunner,
  worktreePath: string,
  baseRef: string,
): Promise<NodeJS.ProcessEnv> {
  const scope = await resolveReadyTestScope(runner, worktreePath, baseRef);
  const testScope = scope === "full" ? "full" : scope.join(" ");
  return { ...process.env, JARVIS_READY_TIER: "full", JARVIS_READY_TEST_SCOPE: testScope };
}

function defaultHasPackageScript(worktreePath: string, script: string): boolean {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(worktreePath, "package.json"), "utf8"));
    const scripts = typeof pkg === "object" && pkg !== null ? (pkg as { scripts?: unknown }).scripts : undefined;
    return typeof scripts === "object" && scripts !== null && script in scripts;
  } catch {
    return false;
  }
}

/** Required integration runs only when the worktree defines the script and the default ready gate did not already
 * run it (its base-scoped test scope is `full` or names the script). */
async function shouldRunRequiredIntegration(
  input: ReadyFinalizeInput & { requiredIntegrationScope: string },
  resolveGateScope: (worktreePath: string, baseRef: string) => Promise<"full" | string[]>,
  hasPackageScript: (worktreePath: string, script: string) => boolean,
): Promise<boolean> {
  if (!hasPackageScript(input.worktreePath, input.requiredIntegrationScope)) return false;
  const defaultGate = input.readyCommand === undefined || input.readyCommand.trim() === DEFAULT_READY_COMMAND;
  if (input.skipReadyGate || !defaultGate) return true;
  const scope = await resolveGateScope(input.worktreePath, input.baseRef);
  return scope !== "full" && !scope.includes(input.requiredIntegrationScope);
}

export function createDefaultRunReadyGate(runner: AsyncSubprocessRunner): ReadyGate {
  return async (
    worktreePath: string,
    baseRef: string,
    gateOptions?: {
      signal?: AbortSignal | undefined;
      processGroups?: VerifierProcessGroupRecorder | undefined;
      readyCommand?: string | undefined;
    },
  ): Promise<void> => {
    const env = await deriveReadyGateChildEnv(runner, worktreePath, baseRef);
    const tracked = trackProcessGroup(gateOptions?.processGroups);
    const command = resolveReadyGateCommand(gateOptions?.readyCommand);
    try {
      await runner.runAsync(command.head, command.args, worktreePath, {
        env,
        timeoutMs: readyGateSubprocessTimeoutMs(),
        signal: gateOptions?.signal,
        processGroup: tracked.processGroup,
      });
    } catch (error) {
      if (error instanceof AsyncSubprocessError) {
        const output = `${error.stdout}${error.stderr}`;
        const timedOut = isDeadlineKilledGate(error, output);
        throw new ReadyGateError(command.display, error.status, output, timedOut, undefined, undefined, error.code);
      }
      const detail = errorMessage(error);
      throw new ReadyGateError(command.display, undefined, detail);
    } finally {
      tracked.settle();
    }
  };
}

type RequiredIntegrationRunner = (
  worktreePath: string,
  scope: string,
  options?: { signal?: AbortSignal | undefined; processGroups?: VerifierProcessGroupRecorder | undefined },
) => Promise<void>;

function createDefaultRunRequiredIntegration(runner: AsyncSubprocessRunner): RequiredIntegrationRunner {
  return async (
    worktreePath: string,
    scope: string,
    integrationOptions?: { signal?: AbortSignal | undefined; processGroups?: VerifierProcessGroupRecorder | undefined },
  ): Promise<void> => {
    const tracked = trackProcessGroup(integrationOptions?.processGroups);
    try {
      await runner.runAsync("bun", ["run", scope], worktreePath, {
        timeoutMs: readyGateSubprocessTimeoutMs(),
        signal: integrationOptions?.signal,
        processGroup: tracked.processGroup,
      });
    } catch (error) {
      if (error instanceof AsyncSubprocessError) {
        const output = `${error.stdout}${error.stderr}`;
        const timedOut = isDeadlineKilledGate(error, output);
        throw new ReadyGateError(scope, error.status, output, timedOut);
      }
      const detail = errorMessage(error);
      throw new ReadyGateError(scope, undefined, detail);
    } finally {
      tracked.settle();
    }
  };
}

async function defaultGhReadyFlip(
  prNumber: number | undefined,
  worktreePath: string,
  signal?: AbortSignal,
): Promise<void> {
  await realAsyncSubprocessRunner.runAsync(
    "gh",
    ["pr", "ready", String(prNumber)],
    worktreePath,
    networkSubprocessOptions({ signal }),
  );
}

function ghFlipCombinedOutput(error: unknown): string {
  if (error instanceof Error) {
    const withOutput = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
    return [withOutput.stdout?.toString(), withOutput.stderr?.toString(), error.message].filter(Boolean).join("\n");
  }
  return String(error);
}

function isPrReadySuccessGuard(message: string): boolean {
  return /\balready ready\b/i.test(message) || /\bnot a draft\b/i.test(message);
}

async function flipWithRetry(flip: () => Promise<void>, delay: Delay, retryNotice: RetryNotice): Promise<void> {
  await runPublicationWithRetry("gh pr ready", flip, {
    delay,
    retryNotice,
    isSuccess: (error) => isPrReadySuccessGuard(ghFlipCombinedOutput(error)),
  });
}

/** Runs admitted finalization checks, then flips the draft PR to ready on green. */
export function createReadyFinalizer(seams?: ReadyFinalizerSeams): ReadyFinalizer {
  const asyncSubprocessRunner = seams?.asyncSubprocessRunner ?? realAsyncSubprocessRunner;
  const runReadyGate = seams?.runReadyGate ?? createDefaultRunReadyGate(asyncSubprocessRunner);
  const ghReadyFlip = seams?.ghReadyFlip ?? defaultGhReadyFlip;
  const delay = seams?.delay ?? defaultPublicationDelay;
  const retryNotice = seams?.retryNotice ?? defaultPublicationRetryNotice;
  const runRequiredIntegration =
    seams?.runRequiredIntegration ?? createDefaultRunRequiredIntegration(asyncSubprocessRunner);
  const runMutationVerification = seams?.runMutationVerification;
  const runRuntimeSmokeVerification = seams?.runRuntimeSmokeVerification;
  const hasPackageScript = seams?.hasPackageScript ?? defaultHasPackageScript;
  const resolveGateScope =
    seams?.resolveReadyTestScope ??
    ((worktreePath: string, baseRef: string) => resolveReadyTestScope(asyncSubprocessRunner, worktreePath, baseRef));

  return async (input) => {
    if (!input.skipReadyGate) {
      await runReadyGate(input.worktreePath, input.baseRef, {
        signal: input.signal,
        processGroups: input.verifierProcessGroups,
        readyCommand: input.readyCommand,
      });
    }
    if (
      input.requiredIntegrationScope &&
      (await shouldRunRequiredIntegration(
        { ...input, requiredIntegrationScope: input.requiredIntegrationScope },
        resolveGateScope,
        hasPackageScript,
      ))
    ) {
      await runRequiredIntegration(input.worktreePath, input.requiredIntegrationScope, {
        signal: input.signal,
        processGroups: input.verifierProcessGroups,
      });
    }
    if (runMutationVerification) {
      await runMutationVerification(input.worktreePath, input.baseRef, input.verifierProcessGroups);
    }
    const runtimeSmokeOutcome = runRuntimeSmokeVerification
      ? await runRuntimeSmokeVerification(input.worktreePath, input.baseRef, input.verifierProcessGroups)
      : undefined;
    if (runtimeSmokeOutcome?.kind === "smoke-failure") {
      throw new RuntimeSmokeFailedError(runtimeSmokeOutcome.command, runtimeSmokeOutcome.observation);
    }
    try {
      await flipWithRetry(() => ghReadyFlip(input.prNumber, input.worktreePath, input.signal), delay, retryNotice);
    } catch (error) {
      if (runtimeSmokeOutcome !== undefined) {
        throw new ReadyFlipError(error instanceof Error ? error : new Error(String(error)), runtimeSmokeOutcome);
      }
      throw error;
    }
    return runtimeSmokeOutcome !== undefined ? { runtimeSmokeOutcome } : {};
  };
}
