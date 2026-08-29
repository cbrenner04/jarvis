---
name: codex-refuses-git-disabled-workspaces
---

# Codex refuses git-disabled workspaces and the refusal kills the run instead of advancing the agent order

## Problem

Two stacked defects, one observed kill (#3106):

1. v2 spawns `codex exec` without `--skip-git-repo-check`. In a git-disabled workspace (`plan.commit: false` → plain staging dir under `~/.jarvis/intent-work/`), codex ≥0.150 exits 1 in ~60ms with `Not inside a trusted directory and --skip-git-repo-check was not specified.` A `projects.<path>.trust_level="trusted"` config override does not bypass the check (verified live 2026-08-29); the flag is the only lever. A codex-first agent order can never run intent/plan stages on a git-disabled project.
2. The refusal classifies `{kind: "error"}` (correct — it is not quota), but `executeWithQuotaFallback`'s default `shouldAdvance` advances on `quota` only, so healthy sibling rungs (cursor, claude) are never tried; the write step settles non-retryable `invocation_failure` and the pipeline stage fails terminally. The `execute.ts` docstring claims plan/intent loops advance on `error`/`model_config`; no production caller overrides the predicate.

Secondary: the final attempt's stderr is dropped — telemetry keeps only `exit_reason: "exit_code:1"` and `InvocationFailureDetail.message` is left unset — so the failure was misdiagnosed as a quota-classification miss and is undiagnosable from durable records.

## Evidence (2026-08-29, #3106)

Run `40301cfb`, pipeline `580ccff3` intent stage on `homestead-service` (`plan.commit: false`): telemetry `role: plan, agent: codex, duration_ms: 62, exit_kind: error, exit_reason: exit_code:1`, `binding_index: 0`, no further attempts. Workspace `~/.jarvis/intent-work/homestead-service/01-households-api` is not a git repo. Live repro in a non-git dir reproduces the refusal verbatim at the same instant timing; the same binary a minute later in a git cwd prints the quota message (`You've hit your usage limit …`), which `codexQuotaPatterns[0]` already matches — quota misclassification was not the cause.

## Decisions

- `codex exec` argv (shared `shared/invocation/agents.ts` adapter) gains `--skip-git-repo-check` unconditionally: jarvis always owns and materializes the cwd (managed worktree or staging dir), so codex's repo-trust refusal is redundant protection; git-worktree behavior is unchanged. Rules out per-callsite conditional plumbing.
- The trusted-directory refusal stderr classifies as an agent-local advancing signal via the credential-auth precedent (`{kind: "quota", authFailure: true }` from `settleNonZeroExit`) so the order advances even on codex binaries where the flag regresses. Liberal by operator direction: a false advance costs one extra rung invocation; a false terminal kills the stage.
- `codexQuotaPatterns` additionally matches guarded 429 / `Too Many Requests` transport lines, mirroring claude/opencode status patterns. Same liberal rationale.
- Terminal `invocation_failure` settlement populates `InvocationFailureDetail.message` with a bounded tail (last 2048 chars) of the final attempt's stderr, projected through existing `run list` / `run wait` `error.message`. Rules out a new persistence surface; the field exists.
- Out of scope: generic advance-on-`error`/`model_config` policy (#3026/#585 territory), per-project agent orders, v1's local codex adapter (v1 always runs in git worktrees).

## Acceptance criteria

- [ ] Codex argv test proves `--skip-git-repo-check` is passed by the shared codex adapter.
- [ ] Classifier test: exit 1 + stderr `Not inside a trusted directory and --skip-git-repo-check was not specified.` settles `{kind: "quota", authFailure: true}`, and an order test proves the next rung is invoked; both fail against current classification.
- [ ] Classifier test: exit 1 + a guarded 429/`Too Many Requests` line settles `{kind: "quota"}` for codex.
- [ ] Step/write-path test: a terminal `invocation_failure` whose final attempt carries stderr persists a bounded tail on `InvocationFailureDetail.message`, visible via `run list`/`run wait` error projection; empty stderr leaves `message` unset.
- [ ] `bun run typecheck` and `test:v1` + `test:v2` + `test:integration:v2` pass (shared surface).

## Documentation updates

- `v1/docs/quota-signals.md` — codex signal table gains the trusted-directory refusal and 429 rows (v2 shared classifier only; note v1 parity status).
- `v2/docs/v1-behaviors.md` — v2 codex spawns with `--skip-git-repo-check`; v1 does not.
- `v2/docs/operator-runbook.md` — remove/adjust any codex caveat this obsoletes.
