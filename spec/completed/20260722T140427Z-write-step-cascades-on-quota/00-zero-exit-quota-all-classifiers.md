# 00 - Widen zero-exit quota classification to codex and cursor

## Problem

`settleZeroExit` (`shared/invocation/agents.ts:260`) reclassifies a zero-exit invocation as `quota`
only when `config.classifier === "claude"`. A codex or cursor process that hits its usage limit and
exits `0` settles `ok`, so `executeWithQuotaFallback` never advances (`shared/invocation/execute.ts:190`)
and the write step reports `blocked` / `agent_blocked` / `inspect_spec` while other agents sit idle.

Observed 2026-07-22, run `2e591285-974b-4ff7-ad69-12c9daa524d6`:
`{"role":"implement","agent":"codex","model":"gpt-5.6-terra","exit_kind":"ok","duration_ms":427192}`.

The cascade, terminal mapping, and operator reasons are already correct and tested; only
classification is missing.

## Decisions

- Codex and cursor zero-exit detection reuses the committed per-classifier lists `codexQuotaPatterns`
  / `cursorQuotaPatterns` (`shared/invocation/agents.ts`); rules out authoring new vendor regexes with
  no captured sample, and rules out one shared cross-agent pattern list.
- Claude's zero-exit path keeps the structured JSON envelope check unchanged (`is_error` +
  `api_error_status: 429` + quota text in `result`); rules out text-matching claude stdout, whose
  `result` field carries agent prose.
- Codex/cursor match against the combined `${stderr}${stdout}` diagnostics, mirroring
  `settleNonZeroExit`; rules out stderr-only matching, since the observed run did not confirm which
  stream carried the limit text.
- The existing pattern lists stay unchanged; rules out widening them to loose phrases like a bare
  `usage limit`, which would swallow agent-authored blocker prose.
- No real codex/cursor zero-exit sample exists; `v1/docs/quota-signals.md` records these patterns as
  still `Unverified` for the zero-exit path rather than `Matched`; rules out claiming verification
  from the telemetry line alone.
- `finalizeClaudeInvocationResult` (`shared/invocation/agents.ts:425`), the write-step cascade, and
  `run-operator-error.ts` are untouched; rules out re-landing already-correct behavior.

## Acceptance criteria

- [x] A codex invocation that exits `0` with `You've hit your usage limit` in its output is classified
      `quota`, not `ok`; a new case in `shared/invocation/agents.test.ts` pins that text and fails
      against the current claude-only branch.
- [x] A cursor invocation that exits `0` with `monthly cursor usage limit reached` in its output is
      classified `quota`, pinned by a new case in the same file that fails pre-fix.
- [x] A claude zero-exit quota envelope is still classified `quota`: `shared/invocation/agents.test.ts`
      "claude zero-exit quota envelope returns quota" and `shared/invocation/claude-json.test.ts` stay
      green.
- [x] A zero-exit invocation with ordinary output is still `ok` for claude, codex, and cursor — a
      negative case per classifier proves the new detection does not fire on normal completions.
- [x] A zero-exit codex invocation whose output is an agent-authored `## Blocker` reading
      "the environment rejected validation with its usage limit before the required v2 gates could run"
      is still classified `ok` (no quota envelope), pinning that genuine blockers are not swallowed.
- [x] A write/implement step whose first binding returns a zero-exit codex quota envelope advances to
      the next configured binding and completes on it; a new `v2/src/execution/step-runner.test.ts`
      case drives this through the real classification path and fails against the pre-fix code.
- [x] Existing `step-runner.test.ts` blocked-outcome coverage stays green — a step whose agent returns
      a non-quota `## Blocker` still settles blocked (`agent_blocked` / `inspect_spec` mapping in
      `v2/src/daemon/run-operator-error.ts` unchanged).
- [x] Tests pin every added or modified guard in both directions so inverting any guard fails; the
      classifier-scoping guard's negative case proves claude output is not text-matched.
- [x] `bun run typecheck`, `bun run test:v1`, and `bun run test:v2` pass (`shared/**` is touched).

## Documentation updates

- `v1/docs/quota-signals.md` — zero-exit quota detection covers codex and cursor via their existing
  pattern lists against combined stdout+stderr; add the matrix row and keep the pattern audit entries
  `Unverified` (no captured sample).
- `v2/docs/write-behavior.md` — a zero-exit quota envelope is a quota result that cascades, not a
  blocker outcome.
- `v2/docs/v1-behaviors.md` — update the spawn-classification entry (currently "only non-zero exits
  can classify as quota"; claude-only exit-`0` reclassification) to record the widened behavior.
