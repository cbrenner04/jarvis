---
name: write-step-cascades-on-quota
---

# Classify a zero-exit quota envelope for every agent, not just claude

## Problem

An agent that hits its own usage limit and then exits `0` is classified `ok`. The write step sees a
successful invocation whose output is a `## Blocker`, so the run settles `blocked` /
`agent_blocked` / `inspect_spec` / `resumable: false` — pointing the operator at a spec that is fine
— while other agents in `agents` sit idle.

Observed 2026-07-22 on `20260722T015205Z-runtime-smoke-exercises-cli-daemon-handshake`, run
`2e591285-974b-4ff7-ad69-12c9daa524d6`. Telemetry for that invocation:
`{"role":"implement","agent":"codex","model":"gpt-5.6-terra","exit_kind":"ok","duration_ms":427192}`.
The agent-authored blocker text read "the environment rejected validation with its usage limit
before the required v2 gates could run." `claude` was available and idle.

**The write step's quota cascade is not the defect.** `v2/src/execution/step-runner.ts:244` already
runs the write/implement step through `executeWithQuotaFallback` over the full binding list;
`shared/invocation/execute.ts:190` advances on `result.kind === "quota"`; all-rungs quota already
settles `invocation_failure` / `failureKind: "quota"` and maps to the operator reason
`quota_exhausted` / `retry_later` (`v2/src/daemon/run-operator-error.ts:70`). All three are pinned by
existing tests. A spec written against "the write step blocks instead of cascading" would land a
no-op.

The gap is one layer down: `shared/invocation/agents.ts:261` reclassifies zero-exit output as quota
only when `config.classifier === "claude"` (`isClaudeZeroExitQuotaEnvelope`). No equivalent exists
for codex or cursor, so the harness never saw a quota result on the observed invocation and had
nothing to cascade on.

## Decisions

- Detect a zero-exit quota envelope for the codex and cursor classifiers as well as claude; rules out
  leaving the existing write-step cascade correct but unreachable for two of three agents.
- Keep classification at the invocation layer, from the agent's own output envelope; rules out
  string-matching a `## Blocker` in the write step, and rules out any write-step-specific quota
  policy.
- Detect per classifier against each agent's real limit output, not one shared regex; rules out
  reusing claude's envelope shape for agents that word it differently.
- Leave genuine `## Blocker` handling unchanged: a blocker whose prose merely mentions a usage limit,
  from an invocation carrying no quota envelope, still reports `agent_blocked` / `inspect_spec`;
  rules out swallowing real agent blockers into the quota path.
- Do not change the existing write-step cascade, terminal mapping, or operator reasons — they are
  already correct and tested; rules out re-landing them.

## Acceptance criteria

- [ ] A codex invocation that exits `0` with its usage-limit envelope in output is classified
      `quota`, not `ok`; a test pins that envelope text and fails against the current claude-only
      branch.
- [ ] The same holds for cursor.
- [ ] A claude zero-exit quota envelope is still classified `quota`, unchanged.
- [ ] A zero-exit invocation with ordinary output is still classified `ok` for every classifier — the
      negative case proves the new detection does not fire on normal completions.
- [ ] With classification fixed, a write/implement invocation hitting a zero-exit quota envelope on
      the first rung advances to the next configured agent and the run continues; a test drives this
      and fails against the current classification.
- [ ] An agent that appends a genuine `## Blocker` unrelated to quota, with no quota envelope, still
      reports `agent_blocked` with `nextAction: "inspect_spec"`, unchanged.
- [ ] Tests pin every added or modified guard in both directions so inverting any guard fails; where
      a guard suppresses an effect, the negative case proves the effect is absent.
- [ ] `bun run typecheck`, `bun run test:v1`, and `bun run test:v2` pass (`shared/**` is touched).

## Documentation updates

- `v1/docs/quota-signals.md` — zero-exit quota envelopes are detected for codex and cursor, not only
  claude; record each classifier's envelope shape.
- `v2/docs/write-behavior.md` — a zero-exit quota envelope is a quota result, not a blocker outcome.
- `v2/docs/v1-behaviors.md` — record the widened zero-exit quota classification in the parity
  baseline.

## Prerequisites

- The invocation layer classifies a quota result distinctly from `ok`, and the write step already
  advances down `agents` on it.
- `isClaudeZeroExitQuotaEnvelope` establishes the zero-exit-envelope detection shape for one
  classifier.
