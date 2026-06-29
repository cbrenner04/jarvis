import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { getCurrentBranch } from "../../../../shared/git.ts";
import { executeWithQuotaFallback } from "../../../../shared/invocation/execute.ts";
import { parseSpec } from "../../../../shared/spec-parser.ts";
import { createAgent } from "../../agents/factory.ts";
import type { Agent, AgentName, AgentResult } from "../../agents/types.ts";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import { type Config, resolveSubRoleAgentOrder } from "../../config.ts";
import { getBaseBranch } from "../../gh.ts";
import {
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessAuthRotateLine,
  harnessQuotaFallbackLenientLine,
} from "../../quota-harness-messages.ts";
import { type ReadyTier, runReadyGateWithTier } from "../../ready-gate.ts";
import type { CostSource, PatchTelemetryPhase, TelemetryKind, UsageSource } from "../../telemetry.ts";
import { extractUsageAndCost } from "../../telemetry-enrichment.ts";
import { pushCurrent } from "../../worktree.ts";
import { evaluateIdleWatchdog, sampleFileActivityIfNeeded } from "./idle-watchdog.ts";
import { updatePrBody } from "./pr.ts";
import { buildShrinkPrompt } from "./prompt.ts";
import { detectSpecTreeEdits, revertSpecTreeEdits } from "./review.ts";
import { createShrinkInvocationBinding } from "./shrink-invocation-binding.ts";
import { type AcceptanceCriterion, snapshotAcceptanceCriteria } from "./subspec.ts";

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
): void {
  const committed = listDiffNames(cwd, preIterationHead, "HEAD");
  const dirty = listPorcelainNames(cwd);
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
export function detectDeletedTestInScope(cwd: string, allowlist: ReadonlySet<string>, preShrinkHead: string): boolean {
  try {
    const output = execFileSync("git", ["diff", "--name-status", preShrinkHead, "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
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
    const porcelain = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
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
export function revertOutOfScopeEdits(cwd: string, allowlist: ReadonlySet<string>, specDir: string): string[] {
  const edited = listPorcelainNames(cwd).filter(
    (file) => !allowlist.has(file) && !isPathUnderSpecDir(file, specDir, cwd),
  );
  if (edited.length === 0) {
    return [];
  }
  for (const file of edited) {
    try {
      execFileSync("git", ["checkout", "HEAD", "--", file], { cwd, stdio: "pipe" });
    } catch {
      // untracked: clean below
    }
    execFileSync("git", ["clean", "-fd", "--", file], { cwd, stdio: "pipe" });
  }
  return edited;
}

function listPorcelainNames(cwd: string): string[] {
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    return output
      .split("\n")
      .filter((line) => line.length > 3)
      .map((line) => line.slice(3).trim());
  } catch {
    return [];
  }
}

function listDiffNames(cwd: string, fromRef: string, toRef: string): string[] {
  try {
    const output = execFileSync("git", ["diff", "--name-only", fromRef, toRef], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function revertAllSince(cwd: string, ref: string): void {
  execFileSync("git", ["reset", "--hard", ref], { cwd, stdio: "pipe" });
  execFileSync("git", ["clean", "-fd"], { cwd, stdio: "pipe" });
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
): void {
  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  if (porcelain === "") {
    return;
  }

  execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe" });
  const commitMessage = appendAgentTrailer("shrink: simplify implementation diff", agentLabel);
  execFileSync("git", ["commit", "-F", "-"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: commitMessage,
  });
  pushCurrent({ cwd, firstPush: false });
  void updatePrBody({
    indexPath: opts.specPath,
    branch: opts.branch,
    base: opts.base,
    cwd,
    prNarrative: opts.prNarrative,
  }).catch(() => {});
}

/**
 * Run one post-completion shrink agent invocation. Unsuccessful shrink discards
 * worktree changes and returns without elevating the run exit code.
 */
export async function runPatchShrinkPhase(opts: PatchShrinkPhaseOptions): Promise<void> {
  if (opts.allowlist.size === 0 || opts.config.modes.patch.shrink === "off") {
    return;
  }

  if (!opts.skipPreShrinkGate) {
    opts.fanout("harness", "shrink: running pre-shrink ready gate\n", "stdout");
    try {
      if (opts.runPreShrinkGate) {
        opts.runPreShrinkGate();
      } else {
        const tier = runReadyGateWithTier({
          cwd: opts.cwd,
          agentLabel: "shrink-baseline",
          ...(opts.readyCommand !== undefined ? { readyCommand: opts.readyCommand } : {}),
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

  const specDir = dirname(opts.specPath);
  const preShrinkHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  const criteriaBefore = snapshotAllAcceptanceCriteria(opts.specPath);
  const base = opts.baseBranch ?? (await getBaseBranch(opts.cwd));
  const branch = getCurrentBranch(opts.cwd);
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

  const shrinkController = new AbortController();
  const shrinkTimeoutHandle = setTimeout(() => {
    shrinkController.abort("shrink-timeout");
  }, opts.iterationTimeoutMs);

  const startedMs = Date.now();
  let result: AgentResult | undefined;
  let successfulAgent: Agent | undefined;
  const shrinkLastOutputAtMs = { current: null as number | null };
  let shrinkLastFileActivityAtMs: number | null = null;
  let shrinkIdleTimeoutHandle: NodeJS.Timeout | null = null;

  // Arm idle watchdog if configured
  const shrinkArmedAt = Date.now();
  const shrinkIdleOutputTimeoutMs =
    opts.idleOutputTimeoutMs !== undefined ? opts.idleOutputTimeoutMs : (opts.config.idleOutputTimeoutMs ?? 600000);
  const shrinkWorktreeDir = opts.patchWorktreeDir ?? opts.cwd;
  if (shrinkIdleOutputTimeoutMs > 0) {
    const scheduleShrinkIdleCheck = () => {
      shrinkIdleTimeoutHandle = setTimeout(() => {
        const snapshotAt = Date.now();
        const lastOutputAgeMs =
          shrinkLastOutputAtMs.current === null ? null : snapshotAt - shrinkLastOutputAtMs.current;

        const sampledFileActivityAt = sampleFileActivityIfNeeded({
          lastOutputAgeMs,
          idleOutputTimeoutMs: shrinkIdleOutputTimeoutMs,
          now: snapshotAt,
          armedAt: shrinkArmedAt,
          workingDir: shrinkWorktreeDir,
        });

        if (sampledFileActivityAt !== null) {
          shrinkLastFileActivityAtMs = sampledFileActivityAt;
        }

        const { shouldFire } = evaluateIdleWatchdog({
          now: snapshotAt,
          lastOutputAt: shrinkLastOutputAtMs.current,
          lastFileActivityAt: shrinkLastFileActivityAtMs,
          armedAt: shrinkArmedAt,
          idleOutputTimeoutMs: shrinkIdleOutputTimeoutMs,
        });

        if (shouldFire) {
          opts.fanout(
            "harness",
            `[watchdog] idle timeout fired after ${shrinkIdleOutputTimeoutMs}ms; killing agent\n`,
            "stderr",
          );
          shrinkController.abort("idle-timeout");
        } else {
          scheduleShrinkIdleCheck();
        }
      }, 100);
      shrinkIdleTimeoutHandle?.unref?.();
    };
    scheduleShrinkIdleCheck();
  }

  try {
    const createAgentForBinding = (agentName: AgentName, model: string) => {
      const override = opts.agents?.[agentName];
      return override ?? createAgent(agentName, model);
    };

    const eligibleAgents = resolveSubRoleAgentOrder(opts.config, "reviewActuator");

    const bindings = eligibleAgents.map((entry) =>
      createShrinkInvocationBinding({
        agentName: entry.agent,
        configuredModel: entry.model,
        createAgent: createAgentForBinding,
        config: opts.config,
        cwd: opts.cwd,
        abortKillGraceMs: killGraceMs,
        lastOutputAtMs: shrinkLastOutputAtMs,
        onQuotaFallbackEmit: (agentName, spawnResult, classified) => {
          if (spawnResult.kind === "quota") {
            if (spawnResult.authFailure === true) {
              opts.fanout("harness", `${agentName}: ${harnessAuthRotateLine(agentName)}\n`, "stderr");
            } else {
              opts.fanout("harness", `${agentName}: ${HARNESS_QUOTA_FALLBACK_STRICT}\n`, "stderr");
            }
          } else if (spawnResult.kind === "error" && classified.kind === "quota") {
            opts.fanout(
              "harness",
              `${agentName}: ${harnessQuotaFallbackLenientLine(spawnResult.exitCode)}\n`,
              "stderr",
            );
          }
        },
        recordAttempt: (data) => {
          const telemetryMeta = data.configuredModel ? { configured_model: data.configuredModel } : {};

          if (data.result.kind === "ok") {
            if (data.result.stdout.length > 0) {
              opts.fanout("inbound_stdout", data.result.stdout, null, { patch_phase: "shrink" });
            }
            if (data.result.stderr.length > 0) {
              opts.fanout("inbound_stderr", data.result.stderr, null, { patch_phase: "shrink" });
            }
            opts.writeTelemetry({
              agent: data.agentName,
              iteration: 1,
              durationMs: data.durationMs,
              kind: "ok",
              exitReason: "ok",
              patch_phase: "shrink",
              ...extractUsageAndCost(data.result, data.agentName, data.configuredModel),
              ...telemetryMeta,
            });
          } else if (data.result.kind === "quota") {
            opts.writeTelemetry({
              agent: data.agentName,
              iteration: 1,
              durationMs: data.durationMs,
              kind: "quota",
              exitReason: "quota-fallback",
              patch_phase: "shrink",
              ...telemetryMeta,
            });
          } else if (data.result.kind === "model_config") {
            opts.writeTelemetry({
              agent: data.agentName,
              iteration: 1,
              durationMs: data.durationMs,
              kind: "error",
              exitReason: "model_config",
              patch_phase: "shrink",
              ...telemetryMeta,
            });
          } else {
            let exitReasonStr = "agent-error";
            if (data.result.stderr.includes("aborted: idle-timeout")) {
              exitReasonStr = "watchdog-idle-timeout";
            } else if (data.result.stderr.includes("aborted: shrink-timeout")) {
              exitReasonStr = "timeout";
            }
            opts.writeTelemetry({
              agent: data.agentName,
              iteration: 1,
              durationMs: data.durationMs,
              kind: "error",
              exitReason: exitReasonStr,
              patch_phase: "shrink",
              ...telemetryMeta,
            });
          }
        },
      }),
    );

    const execution = await executeWithQuotaFallback({
      prompt,
      cwd: opts.cwd,
      bindings,
      signal: shrinkController.signal,
    });

    const finalAttempt = execution.final;
    const durationMs = Math.max(0, Date.now() - startedMs);

    if (finalAttempt === null) {
      return;
    }

    if (finalAttempt.result.kind === "quota") {
      opts.writeTelemetry({
        agent: finalAttempt.binding.id,
        iteration: 1,
        durationMs,
        kind: "quota",
        exitReason: "quota-exhausted",
        patch_phase: "shrink",
      });
      revertAllSince(opts.cwd, preShrinkHead);
      opts.fanout("harness", "shrink: all agents quota-exhausted (discarded)\n", "stderr");
      return;
    }

    if (finalAttempt.result.kind === "model_config") {
      revertAllSince(opts.cwd, preShrinkHead);
      opts.fanout("harness", `shrink: agent error (${finalAttempt.result.kind}); discarded\n`, "stderr");
      return;
    }

    if (finalAttempt.result.kind === "error") {
      revertAllSince(opts.cwd, preShrinkHead);
      opts.fanout("harness", `shrink: invocation failed (${finalAttempt.result.kind}); discarded\n`, "stderr");
      return;
    }

    // Recover the configured model from eligible agents to reconstruct agent with correct attribution label
    const winningEntry = eligibleAgents.find(
      (entry) => createAgentForBinding(entry.agent, entry.model).attributionLabel() === finalAttempt.binding.id,
    );
    const winningModel = winningEntry?.model ?? "";

    result = finalAttempt.result;
    successfulAgent = createAgentForBinding(finalAttempt.binding.id as AgentName, winningModel);
  } finally {
    clearTimeout(shrinkTimeoutHandle);
    if (shrinkIdleTimeoutHandle !== null) {
      clearTimeout(shrinkIdleTimeoutHandle);
    }
  }

  if (result === undefined || result.kind !== "ok" || successfulAgent === undefined) {
    return;
  }

  const agent = successfulAgent;

  const outOfScope = revertOutOfScopeEdits(opts.cwd, opts.allowlist, specDir);
  if (outOfScope.length > 0) {
    opts.fanout("harness", `shrink: out-of-scope edits reverted: ${outOfScope.join(", ")}\n`, "stderr");
  }

  const criteriaAfter = snapshotAllAcceptanceCriteria(opts.specPath);

  const editedSpecFiles = detectSpecTreeEdits(specDir, opts.cwd);
  if (editedSpecFiles.length > 0) {
    opts.fanout("harness", `shrink: spec-tree edits reverted: ${editedSpecFiles.join(", ")}\n`, "stderr");
    try {
      revertSpecTreeEdits(specDir, opts.cwd);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.fanout("harness", `shrink: spec revert failed (discarding): ${message}\n`, "stderr");
      revertAllSince(opts.cwd, preShrinkHead);
      return;
    }
  }

  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  if (porcelain === "") {
    opts.fanout("harness", "shrink: no changes\n", "stdout");
    return;
  }

  const acRegression = hasAcceptanceCriteriaRegression(criteriaBefore, criteriaAfter);
  const deletedTest = detectDeletedTestInScope(opts.cwd, opts.allowlist, preShrinkHead);
  const testsPass = (opts.runContractTests ?? runTests)(opts.cwd);

  if (acRegression || deletedTest || !testsPass) {
    const reasons = [
      ...(acRegression ? ["acceptance-criteria regression"] : []),
      ...(deletedTest ? ["deleted test file in scope"] : []),
      ...(!testsPass ? ["tests failing"] : []),
    ];
    opts.fanout("harness", `shrink: contract miss (${reasons.join(", ")}); reverting\n`, "stderr");
    revertAllSince(opts.cwd, preShrinkHead);
    return;
  }

  try {
    commitShrinkPass(agent.attributionLabel(), opts.cwd, {
      branch,
      base,
      specPath: opts.specPath,
      prNarrative: opts.config.modes.patch.prNarrative ?? "template",
    });
    opts.fanout("harness", "shrink: committed simplifications\n", "stdout");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.fanout("harness", `shrink: commit failed (discarding): ${message}\n`, "stderr");
    revertAllSince(opts.cwd, preShrinkHead);
  }
}
