import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { executeWithQuotaFallback } from "../../../../shared/invocation/execute.ts";
import { parseSpec } from "../../../../shared/spec-parser.ts";
import { createAgent } from "../../agents/factory.ts";
import type { Agent, AgentName, AgentResult } from "../../agents/types.ts";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import { type Config, resolveSubRoleAgentOrder } from "../../config.ts";
import { getBaseBranch } from "../../gh.ts";
import {
  HARNESS_IDLE_TIMEOUT_FALLBACK,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessAuthRotateLine,
  harnessQuotaFallbackLenientLine,
} from "../../quota-harness-messages.ts";
import { type ReadyTier, runReadyGateWithTier } from "../../ready-gate.ts";
import type { CostSource, PatchTelemetryPhase, TelemetryKind, UsageSource } from "../../telemetry.ts";
import { extractUsageAndCost } from "../../telemetry-enrichment.ts";
import { pushCurrent } from "../../worktree.ts";
import { GIT_SUBPROCESS_OPTS } from "./git-subprocess.ts";
import { evaluateIdleWatchdog, sampleFileActivityIfNeeded } from "./idle-watchdog.ts";
import { updatePrBody } from "./pr.ts";
import { buildShrinkPrompt } from "./prompt.ts";
import { detectSpecTreeEdits, type ReviewGitOps, realReviewGitOps, revertSpecTreeEdits } from "./review.ts";
import { createShrinkInvocationBinding, type ShrinkAgentAttemptData } from "./shrink-invocation-binding.ts";
import { type AcceptanceCriterion, snapshotAcceptanceCriteria } from "./subspec.ts";

/** Injectable seam for the git operations shrink.ts needs (diff/status/checkout/clean/branch/reset/add/commit/push/rev-parse). */
export interface ShrinkGitOps {
  diffNameStatus(cwd: string, fromRef: string, toRef: string): string;
  diffNameOnly(cwd: string, fromRef: string, toRef: string): string;
  porcelainStatus(cwd: string): string;
  checkoutPath(cwd: string, file: string): void;
  cleanPath(cwd: string, file: string): void;
  currentBranch(cwd: string): string;
  resetHard(cwd: string, ref: string): void;
  cleanAll(cwd: string): void;
  add(cwd: string): void;
  commit(cwd: string, message: string): void;
  push(cwd: string): void;
  revParseHead(cwd: string): string;
}

// porcelainStatus/checkoutPath/cleanPath/add/commit are identical to ReviewGitOps; reuse rather than redefine.
export const realShrinkGitOps: ShrinkGitOps = {
  ...realReviewGitOps,
  diffNameStatus(cwd, fromRef, toRef) {
    return execFileSync("git", ["diff", "--name-status", fromRef, toRef], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      ...GIT_SUBPROCESS_OPTS,
    });
  },
  diffNameOnly(cwd, fromRef, toRef) {
    return execFileSync("git", ["diff", "--name-only", fromRef, toRef], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      ...GIT_SUBPROCESS_OPTS,
    });
  },
  currentBranch(cwd) {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...GIT_SUBPROCESS_OPTS,
    }).trim();
  },
  resetHard(cwd, ref) {
    execFileSync("git", ["reset", "--hard", ref], { cwd, stdio: "pipe", ...GIT_SUBPROCESS_OPTS });
  },
  cleanAll(cwd) {
    execFileSync("git", ["clean", "-fd"], { cwd, stdio: "pipe", ...GIT_SUBPROCESS_OPTS });
  },
  push(cwd) {
    execFileSync("git", ["push"], { cwd, env: process.env, stdio: "pipe", ...GIT_SUBPROCESS_OPTS });
  },
  revParseHead(cwd) {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      ...GIT_SUBPROCESS_OPTS,
    }).trim();
  },
};

/** Shrink-phase terminal failure mapped to a harness exit code. */
export class ShrinkTerminalError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

type ShrinkLogTag = "harness" | "outbound" | "inbound_stdout" | "inbound_stderr";
type ShrinkLogStream = "stdout" | "stderr" | null;
type ShrinkLogAnnotations = Record<string, string | number | boolean | null>;

/** Patch shrink logging hook. */
export type PatchShrinkFanout = (
  tag: ShrinkLogTag,
  text: string,
  stream: ShrinkLogStream,
  annotations?: ShrinkLogAnnotations,
) => void;

/** Patch shrink telemetry row writer. */
export type PatchShrinkTelemetryWriter = (record: {
  agent: string;
  iteration: number;
  durationMs: number;
  kind: TelemetryKind;
  exitReason: string;
  patch_phase: PatchTelemetryPhase;
  configured_model?: string;
  usage?: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  };
  usage_source?: UsageSource;
  cost_usd?: number | null;
  cost_source?: CostSource;
}) => void;

/** Options for the post-completion shrink phase. */
export type PatchShrinkPhaseOptions = {
  config: Config;
  cwd: string;
  specPath: string;
  allowlist: ReadonlySet<string>;
  fanout: PatchShrinkFanout;
  writeTelemetry: PatchShrinkTelemetryWriter;
  /** Test injection slot indexed by reviewActuator ladder rung. */
  shrinkAgents?: Agent[];
  agents?: Partial<Record<AgentName, Agent>>;
  iterationTimeoutMs: number;
  /** Test-only override for abort kill grace. */
  __testKillGraceMs?: number;
  /** Test seam: skip pre-shrink ready gate. */
  skipPreShrinkGate?: boolean;
  /** Test seam for pre-shrink `bun run ready`. */
  runPreShrinkGate?: () => void;
  /** Test seam for contract `bun run test` validation. */
  runContractTests?: (cwd: string) => boolean;
  /** Test seam: fixed base branch instead of `getBaseBranch`. */
  baseBranch?: string;
  /** Recorded green result from completion transition: reuse when tree unchanged, refresh on re-run. */
  recordedGreenResult?: {
    /** HEAD sha from completion transition ready gate (post-`runReadyAndCommit`). */
    headSha: string;
  };
  /** Refresh callback: called when pre-shrink gate re-runs `ready` and succeeds, to update the recorded result. */
  refreshRecordedGreenResult?: (headSha: string) => void;
  /** Per-project override for `bun run ready`. Passed to `runReadyGateWithTier`. */
  readyCommand?: string;
  /** Per-project override for `bun run fix`. Passed to `runReadyGateWithTier`. */
  fixCommand?: string;
  /** Seam for built-in `bun run fix` on `full` tier. */
  runFix?: (cwd: string) => void;
  /** Seam for verification only. */
  runReady?: (cwd: string, tier: ReadyTier) => void;
  /** Seam for pre-ready fix commit/push on `full` tier when porcelain is non-empty after fix. */
  commitPreReadyFix?: (cwd: string, agentLabel: string) => void;
  /** Patch worktree directory for idle watchdog file-activity scanning. */
  patchWorktreeDir?: string;
  /** Idle output timeout in milliseconds (0 to disable). */
  idleOutputTimeoutMs?: number | undefined;
  /** Test seam: injectable git operations (defaults to real `execFileSync` git). */
  ops?: ShrinkGitOps;
};

/** True when `file` is under `specDir`. */
export function isPathUnderSpecDir(file: string, specDir: string, cwd: string): boolean {
  const specRel = relative(cwd, specDir).replace(/\\/g, "/");
  const normalized = file.replace(/\\/g, "/");
  return normalized === specRel || normalized.startsWith(`${specRel}/`);
}

/** Accumulate non-spec paths touched since `preIterationHead` (committed + dirty). */
export function accumulateImplementationTouchedFiles(
  cwd: string,
  specDir: string,
  preIterationHead: string,
  target: Set<string>,
  ops: ShrinkGitOps = realShrinkGitOps,
): void {
  const committed = listDiffNames(cwd, preIterationHead, "HEAD", ops);
  const dirty = listPorcelainNames(cwd, ops);
  for (const file of [...committed, ...dirty]) {
    if (!isPathUnderSpecDir(file, specDir, cwd)) {
      target.add(file);
    }
  }
}

/** Snapshot acceptance criteria for every linked subspec under `indexPath`. */
export function snapshotAllAcceptanceCriteria(indexPath: string): Map<string, AcceptanceCriterion[]> {
  const indexDir = dirname(indexPath);
  const parsed = parseSpec(readFileSync(indexPath, "utf8"));
  const snapshots = new Map<string, AcceptanceCriterion[]>();
  for (const linked of parsed.linkedSubspecs) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(linked.path)) {
      continue;
    }
    const subspecPath = join(indexDir, linked.path);
    if (!existsSync(subspecPath)) {
      continue;
    }
    snapshots.set(subspecPath, snapshotAcceptanceCriteria(subspecPath));
  }
  return snapshots;
}

/** True when any criterion checked pre-shrink is unchecked post-shrink. */
export function hasAcceptanceCriteriaRegression(
  before: Map<string, AcceptanceCriterion[]>,
  after: Map<string, AcceptanceCriterion[]>,
): boolean {
  for (const [subspecPath, beforeCriteria] of before) {
    const afterCriteria = after.get(subspecPath);
    if (afterCriteria === undefined) {
      continue;
    }
    const afterByText = new Map(afterCriteria.map((c) => [c.text, c.checked]));
    for (const criterion of beforeCriteria) {
      if (criterion.checked && afterByText.get(criterion.text) === false) {
        return true;
      }
    }
  }
  return false;
}

/** True when a scoped `*.test.ts` path was deleted since `preShrinkHead`. */
export function detectDeletedTestInScope(
  cwd: string,
  allowlist: ReadonlySet<string>,
  preShrinkHead: string,
  ops: ShrinkGitOps = realShrinkGitOps,
): boolean {
  try {
    const output = ops.diffNameStatus(cwd, preShrinkHead, "HEAD");
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const match = /^(D|R\d+)\s+(.+)$/.exec(trimmed);
      if (match?.[2] === undefined) {
        continue;
      }
      const path = match[2].split("\t")[0]?.trim();
      if (path === undefined || path.length === 0) {
        continue;
      }
      if (!allowlist.has(path)) {
        continue;
      }
      if (path.endsWith(".test.ts")) {
        return true;
      }
    }
    const porcelain = ops.porcelainStatus(cwd);
    for (const line of porcelain.split("\n")) {
      if (line.length < 4) {
        continue;
      }
      if (!line.startsWith(" D ") && !line.startsWith("D ")) {
        continue;
      }
      const path = line.slice(3).trim();
      if (allowlist.has(path) && path.endsWith(".test.ts")) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/** Revert tracked/untracked edits outside `allowlist`. */
export function revertOutOfScopeEdits(
  cwd: string,
  allowlist: ReadonlySet<string>,
  specDir: string,
  ops: ShrinkGitOps = realShrinkGitOps,
): string[] {
  const edited = listPorcelainNames(cwd, ops).filter(
    (file) => !allowlist.has(file) && !isPathUnderSpecDir(file, specDir, cwd),
  );
  if (edited.length === 0) {
    return [];
  }
  for (const file of edited) {
    try {
      ops.checkoutPath(cwd, file);
    } catch {
      // untracked: clean below
    }
    ops.cleanPath(cwd, file);
  }
  return edited;
}

/** Bounded shrink-path equivalent of `shared/git.ts#getCurrentBranch`; unbounded there since other callers rely on that behavior. */
function getCurrentBranchBounded(cwd: string, ops: ShrinkGitOps = realShrinkGitOps): string {
  return ops.currentBranch(cwd);
}

function listPorcelainNames(cwd: string, ops: ShrinkGitOps = realShrinkGitOps): string[] {
  try {
    const output = ops.porcelainStatus(cwd);
    return output
      .split("\n")
      .filter((line) => line.length > 3)
      .map((line) => line.slice(3).trim());
  } catch {
    return [];
  }
}

function listDiffNames(cwd: string, fromRef: string, toRef: string, ops: ShrinkGitOps = realShrinkGitOps): string[] {
  try {
    const output = ops.diffNameOnly(cwd, fromRef, toRef);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function revertAllSince(cwd: string, ref: string, ops: ShrinkGitOps = realShrinkGitOps): void {
  ops.resetHard(cwd, ref);
  ops.cleanAll(cwd);
}

/** Adapt a `ShrinkGitOps` to `ReviewGitOps` for `detectSpecTreeEdits`/`revertSpecTreeEdits`, neither of which calls `resetPath`. */
function asReviewGitOps(ops: ShrinkGitOps): ReviewGitOps {
  return {
    porcelainStatus: ops.porcelainStatus,
    checkoutPath: ops.checkoutPath,
    cleanPath: ops.cleanPath,
    add: ops.add,
    commit: ops.commit,
    resetPath: () => {
      throw new Error("resetPath is not supported via ShrinkGitOps");
    },
  };
}

function runTests(cwd: string): boolean {
  try {
    execFileSync("bun", ["run", "test"], { cwd, env: process.env, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function commitShrinkPass(
  agentLabel: string,
  cwd: string,
  opts: { branch: string; base: string; specPath: string; prNarrative: "template" | "agent" },
  ops: ShrinkGitOps = realShrinkGitOps,
): void {
  const porcelain = ops.porcelainStatus(cwd).trim();
  if (porcelain === "") {
    return;
  }

  ops.add(cwd);
  const commitMessage = appendAgentTrailer("shrink: simplify implementation diff", agentLabel);
  ops.commit(cwd, commitMessage);
  pushCurrent({
    cwd,
    firstPush: false,
    execSync: () => {
      ops.push(cwd);
    },
  });
  void updatePrBody({
    indexPath: opts.specPath,
    branch: opts.branch,
    base: opts.base,
    cwd,
    prNarrative: opts.prNarrative,
  }).catch(() => {});
}

/**
 * Run post-completion shrink across the `reviewActuator` ladder. Quota walks
 * remaining rungs; idle (`kind: "error"` with `aborted: idle-timeout` stderr)
 * escalates non-terminal stalls without elevating exit code and retains partial
 * edits from the stalled rung. Terminal idle reverts to pre-shrink HEAD and
 * throws `ShrinkTerminalError` (exit `8`). Other non-terminal failures revert
 * and return without elevating exit code. Successful shrink commits allowlisted
 * simplifications after contract validation.
 */
export async function runPatchShrinkPhase(opts: PatchShrinkPhaseOptions): Promise<void> {
  if (opts.allowlist.size === 0 || opts.config.modes.patch.shrink === "off") {
    return;
  }

  const base = opts.baseBranch ?? (await getBaseBranch(opts.cwd));

  if (!opts.skipPreShrinkGate) {
    opts.fanout("harness", "shrink: running pre-shrink ready gate\n", "stdout");
    try {
      if (opts.runPreShrinkGate) {
        opts.runPreShrinkGate();
      } else {
        const tier = runReadyGateWithTier({
          cwd: opts.cwd,
          agentLabel: "shrink-baseline",
          timeoutMs: opts.iterationTimeoutMs,
          baseBranch: base,
          ...(opts.readyCommand !== undefined ? { readyCommand: opts.readyCommand } : {}),
          ...(opts.fixCommand !== undefined ? { fixCommand: opts.fixCommand } : {}),
          ...(opts.recordedGreenResult !== undefined ? { recordedGreenResult: opts.recordedGreenResult } : {}),
          ...(opts.refreshRecordedGreenResult !== undefined
            ? { refreshRecordedGreenResult: opts.refreshRecordedGreenResult }
            : {}),
          ...(opts.runFix !== undefined ? { runFix: opts.runFix } : {}),
          ...(opts.runReady !== undefined ? { runReady: opts.runReady } : {}),
          ...(opts.commitPreReadyFix !== undefined ? { commitPreReadyFix: opts.commitPreReadyFix } : {}),
        });
        opts.fanout("harness", `shrink: pre-shrink ready gate (${tier})\n`, "stdout");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.fanout("harness", `shrink: pre-shrink ready gate failed (skipping shrink): ${message}\n`, "stderr");
      return;
    }
  }

  const ops = opts.ops ?? realShrinkGitOps;
  const specDir = dirname(opts.specPath);
  const preShrinkHead = ops.revParseHead(opts.cwd);
  const criteriaBefore = snapshotAllAcceptanceCriteria(opts.specPath);
  const branch = getCurrentBranchBounded(opts.cwd, ops);
  const allowlist = [...opts.allowlist].sort();
  const killGraceMs = opts.__testKillGraceMs ?? 5000;

  const prompt = buildShrinkPrompt({
    specPath: opts.specPath,
    cwd: opts.cwd,
    allowlist,
    baseBranch: base,
  });
  opts.fanout("harness", "shrink: invoking agent\n", "stdout");
  opts.fanout("outbound", prompt, null, { patch_phase: "shrink" });

  const reviewActuatorOrder = resolveSubRoleAgentOrder(opts.config, "reviewActuator");
  const shrinkIdleOutputTimeoutMs =
    opts.idleOutputTimeoutMs !== undefined ? opts.idleOutputTimeoutMs : (opts.config.idleOutputTimeoutMs ?? 600000);
  const shrinkWorktreeDir = opts.patchWorktreeDir ?? opts.cwd;

  let result: AgentResult | undefined;
  let successfulAgent: Agent | undefined;
  const attemptContexts: ShrinkAgentAttemptData[] = [];
  const bindingStates = reviewActuatorOrder.map(() => ({
    lastOutputAtMs: { current: null as number | null },
    lastFileActivityAtMs: null as number | null,
    timeoutHandle: null as NodeJS.Timeout | null,
    idleTimeoutHandle: null as NodeJS.Timeout | null,
  }));
  const bindings = reviewActuatorOrder.map((headEntry, rungIndex) => {
    const bindingState = bindingStates[rungIndex];
    if (bindingState === undefined) {
      throw new Error(`missing binding state at rung ${rungIndex}`);
    }
    const configuredModel = headEntry.model;
    const binding = createShrinkInvocationBinding<AgentResult>({
      agentName: headEntry.agent,
      configuredModel,
      createAgent: (_agentName, _model) =>
        opts.shrinkAgents?.[rungIndex] ??
        opts.agents?.[headEntry.agent] ??
        createAgent(headEntry.agent, configuredModel),
      config: opts.config,
      abortKillGraceMs: killGraceMs,
      lastOutputAtMs: bindingState.lastOutputAtMs,
      onControllerReady: ({ controller }) => {
        bindingState.timeoutHandle = setTimeout(() => {
          controller.abort("shrink-timeout");
        }, opts.iterationTimeoutMs);
        const armedAt = Date.now();
        if (shrinkIdleOutputTimeoutMs > 0) {
          const scheduleShrinkIdleCheck = () => {
            bindingState.idleTimeoutHandle = setTimeout(() => {
              const snapshotAt = Date.now();
              const lastOutputAt = bindingState.lastOutputAtMs.current;
              const lastOutputAgeMs = lastOutputAt === null ? null : snapshotAt - lastOutputAt;
              const sampledFileActivityAt = sampleFileActivityIfNeeded({
                lastOutputAgeMs,
                idleOutputTimeoutMs: shrinkIdleOutputTimeoutMs,
                now: snapshotAt,
                armedAt,
                workingDir: shrinkWorktreeDir,
              });
              if (sampledFileActivityAt !== null) {
                bindingState.lastFileActivityAtMs = sampledFileActivityAt;
              }
              const { shouldFire } = evaluateIdleWatchdog({
                now: snapshotAt,
                lastOutputAt,
                lastFileActivityAt: bindingState.lastFileActivityAtMs,
                armedAt,
                idleOutputTimeoutMs: shrinkIdleOutputTimeoutMs,
              });
              if (shouldFire) {
                opts.fanout(
                  "harness",
                  `[watchdog] idle timeout fired after ${shrinkIdleOutputTimeoutMs}ms; killing agent\n`,
                  "stderr",
                );
                controller.abort("idle-timeout");
                return;
              }
              scheduleShrinkIdleCheck();
            }, 100);
            bindingState.idleTimeoutHandle?.unref?.();
          };
          scheduleShrinkIdleCheck();
        }
        return () => {
          if (bindingState.timeoutHandle !== null) {
            clearTimeout(bindingState.timeoutHandle);
          }
          if (bindingState.idleTimeoutHandle !== null) {
            clearTimeout(bindingState.idleTimeoutHandle);
          }
        };
      },
      onQuotaFallbackEmit: (agentName, spawnResult, classified) => {
        if (classified.kind !== "quota") {
          return;
        }
        if (spawnResult.kind === "quota") {
          if (spawnResult.authFailure === true) {
            opts.fanout("harness", `${agentName}: ${harnessAuthRotateLine(agentName)}\n`, "stderr");
          } else {
            opts.fanout("harness", `${agentName}: ${HARNESS_QUOTA_FALLBACK_STRICT}\n`, "stderr");
          }
          return;
        }
        if (spawnResult.kind === "error") {
          opts.fanout("harness", `${agentName}: ${harnessQuotaFallbackLenientLine(spawnResult.exitCode)}\n`, "stderr");
        }
      },
      recordAttempt: (attempt) => {
        attemptContexts.push(attempt);
      },
    });
    binding.shouldAdvance = (attemptResult) =>
      attemptResult.kind === "quota" ||
      (attemptResult.kind === "error" && attemptResult.stderr.includes("aborted: idle-timeout"));
    binding.invoke = ((originalInvoke) => {
      return (args) => {
        bindingState.lastOutputAtMs.current = null;
        bindingState.lastFileActivityAtMs = null;
        bindingState.timeoutHandle = null;
        bindingState.idleTimeoutHandle = null;
        return originalInvoke(args);
      };
    })(binding.invoke);
    return binding;
  });
  const execution = await executeWithQuotaFallback({
    prompt,
    cwd: opts.cwd,
    bindings,
  });

  const writeRung = (
    attempt: ShrinkAgentAttemptData,
    kind: TelemetryKind,
    exitReason: string,
    usageResult?: AgentResult,
  ) => {
    const telemetryMeta = attempt.configuredModel ? { configured_model: attempt.configuredModel } : {};
    opts.writeTelemetry({
      agent: attempt.agentName,
      iteration: 1,
      durationMs: attempt.durationMs,
      kind,
      exitReason,
      patch_phase: "shrink",
      ...(usageResult?.kind === "ok"
        ? extractUsageAndCost(usageResult, attempt.agentName, attempt.configuredModel)
        : {}),
      ...telemetryMeta,
    });
  };

  const finalAttemptIndex = execution.attempts.length - 1;
  for (const [attemptIndex, executionAttempt] of execution.attempts.entries()) {
    if (attemptIndex === finalAttemptIndex) {
      continue;
    }
    const attempt = attemptContexts[attemptIndex];
    if (attempt === undefined || executionAttempt.result.kind === "ok") {
      continue;
    }
    const hasNextRung = attemptIndex < execution.attempts.length - 1;
    const isIdleTimeout =
      executionAttempt.result.kind === "error" && executionAttempt.result.stderr.includes("aborted: idle-timeout");
    if (executionAttempt.result.kind === "quota") {
      writeRung(attempt, "quota", hasNextRung ? "quota-fallback" : "quota-exhausted");
      continue;
    }
    if (isIdleTimeout && hasNextRung) {
      opts.fanout("harness", `shrink: ${attempt.agentName}: ${HARNESS_IDLE_TIMEOUT_FALLBACK}\n`, "stderr");
      writeRung(attempt, "timeout", "watchdog-idle-timeout-fallback");
      continue;
    }
    if (executionAttempt.result.kind === "model_config") {
      writeRung(attempt, "error", "model_config");
      continue;
    }
    if (isIdleTimeout) {
      writeRung(attempt, "error", "watchdog-idle-timeout");
      continue;
    }
    writeRung(
      attempt,
      "error",
      executionAttempt.result.stderr.includes("aborted: shrink-timeout") ? "timeout" : "agent-error",
    );
  }

  const finalAttempt = execution.final === null ? null : (attemptContexts[execution.attempts.length - 1] ?? null);
  if (execution.final !== null && finalAttempt !== null) {
    const finalResult = execution.final.result;
    if (finalResult.kind === "ok") {
      if (finalResult.stdout.length > 0) {
        opts.fanout("inbound_stdout", finalResult.stdout, null, { patch_phase: "shrink" });
      }
      if (finalResult.stderr.length > 0) {
        opts.fanout("inbound_stderr", finalResult.stderr, null, { patch_phase: "shrink" });
      }
      writeRung(finalAttempt, "ok", "ok", finalResult);
      result = finalResult;
      successfulAgent = finalAttempt.agent;
    } else if (finalResult.kind === "quota") {
      writeRung(finalAttempt, "quota", "quota-exhausted");
      revertAllSince(opts.cwd, preShrinkHead, ops);
      opts.fanout("harness", "shrink: all agents quota-exhausted (discarded)\n", "stderr");
      return;
    } else if (finalResult.kind === "model_config") {
      writeRung(finalAttempt, "error", "model_config");
      revertAllSince(opts.cwd, preShrinkHead, ops);
      opts.fanout("harness", `shrink: agent error (${finalResult.kind}); discarded\n`, "stderr");
      return;
    } else if (finalResult.stderr.includes("aborted: idle-timeout")) {
      writeRung(finalAttempt, "error", "watchdog-idle-timeout");
      revertAllSince(opts.cwd, preShrinkHead, ops);
      throw new ShrinkTerminalError("shrink idle timeout on final rung", 8);
    } else {
      writeRung(
        finalAttempt,
        "error",
        finalResult.stderr.includes("aborted: shrink-timeout") ? "timeout" : "agent-error",
      );
      revertAllSince(opts.cwd, preShrinkHead, ops);
      opts.fanout("harness", `shrink: invocation failed (${finalResult.kind}); discarded\n`, "stderr");
      return;
    }
  }

  if (result === undefined || result.kind !== "ok" || successfulAgent === undefined) {
    return;
  }

  const agent = successfulAgent;

  const outOfScope = revertOutOfScopeEdits(opts.cwd, opts.allowlist, specDir, ops);
  if (outOfScope.length > 0) {
    opts.fanout("harness", `shrink: out-of-scope edits reverted: ${outOfScope.join(", ")}\n`, "stderr");
  }

  const criteriaAfter = snapshotAllAcceptanceCriteria(opts.specPath);

  const editedSpecFiles = detectSpecTreeEdits(specDir, opts.cwd, asReviewGitOps(ops));
  if (editedSpecFiles.length > 0) {
    opts.fanout("harness", `shrink: spec-tree edits reverted: ${editedSpecFiles.join(", ")}\n`, "stderr");
    try {
      revertSpecTreeEdits(specDir, opts.cwd, asReviewGitOps(ops));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.fanout("harness", `shrink: spec revert failed (discarding): ${message}\n`, "stderr");
      revertAllSince(opts.cwd, preShrinkHead, ops);
      return;
    }
  }

  const porcelain = ops.porcelainStatus(opts.cwd).trim();
  if (porcelain === "") {
    opts.fanout("harness", "shrink: no changes\n", "stdout");
    return;
  }

  const acRegression = hasAcceptanceCriteriaRegression(criteriaBefore, criteriaAfter);
  const deletedTest = detectDeletedTestInScope(opts.cwd, opts.allowlist, preShrinkHead, ops);
  const testsPass = (opts.runContractTests ?? runTests)(opts.cwd);

  if (acRegression || deletedTest || !testsPass) {
    const reasons = [
      ...(acRegression ? ["acceptance-criteria regression"] : []),
      ...(deletedTest ? ["deleted test file in scope"] : []),
      ...(!testsPass ? ["tests failing"] : []),
    ];
    opts.fanout("harness", `shrink: contract miss (${reasons.join(", ")}); reverting\n`, "stderr");
    revertAllSince(opts.cwd, preShrinkHead, ops);
    return;
  }

  try {
    commitShrinkPass(
      agent.attributionLabel(),
      opts.cwd,
      {
        branch,
        base,
        specPath: opts.specPath,
        prNarrative: opts.config.modes.patch.prNarrative ?? "template",
      },
      ops,
    );
    opts.fanout("harness", "shrink: committed simplifications\n", "stdout");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.fanout("harness", `shrink: commit failed (discarding): ${message}\n`, "stderr");
    revertAllSince(opts.cwd, preShrinkHead, ops);
  }
}
