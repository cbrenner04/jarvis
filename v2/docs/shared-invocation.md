# Shared invocation contract

`shared/invocation/execute.ts` owns the behavior-agnostic, abortable
agent-invocation fallback seam used by v2 write-step execution.

Contract:

- Input: `(prompt, cwd, ordered bindings, AbortSignal?)`.
- Each binding invocation returns typed `ok | quota | model_config | error`.
- Fallback advances when the binding's `shouldAdvance` predicate returns true.
  Default policy is `result.kind === "quota"` only; callers may override per
  binding. Review actuator opts into a broader actuator-only policy (quota,
  lenient weak-quota upgrades, and `aborted: idle-timeout` errors) while
  standalone review debate bindings keep quota-only advance.
- Any non-advancing result stops immediately (no later binding attempt).
- Output returns ordered attempts plus the final attempt (or `null` when no
  bindings are configured).
- When the caller also passes write-step telemetry context plus a sink, each
  settled binding subprocess appends one `invocation_completed` JSONL row before
  fallback classification continues. Callers that omit that pair stay telemetry
  no-op.

Fallback default is quota-only: `model_config` and other `error` kinds are
terminal unless a binding's `shouldAdvance` opts in (review actuator adds
idle-timeout advance on non-final rungs).

Bindings:

- Shared execution consumes an already-flattened ordered binding list. For
  workflow steps, `v2/src/config/agent-model-config.ts`
  `resolveInvocationBindings(...)` flattens executable role + agent + rung
  resolution first, then `shared/invocation/execute.ts` iterates that list.
- `createResolvedAgentBinding({ agentId, adapterModel, priceKey })` in
  `shared/invocation/agents.ts` builds one binding from one resolved rung.
  Resolved `claude` bindings spawn `claude -p --permission-mode acceptEdits
  --model <adapterModel> --output-format json`, pipe the prompt on stdin,
  unwrap the JSON envelope into display text (plus agent usage/cost when present),
  reclassify verified exit-0 quota envelopes to `quota`, and settle into
  `ok | quota | model_config | error` before fallback continues.
  Resolved `codex` bindings spawn `codex exec --color never --sandbox
  workspace-write -c approval_policy="on-request" --model <adapterModel>`,
  pipe the marker-augmented prompt on stdin, correlate Codex session usage
  best-effort, and settle into `ok | quota | model_config | error` before
  fallback continues. Resolved `cursor` bindings spawn `cursor agent -p
  --output-format text --model <resolved-cli-model> --force --workspace <cwd>
  <prompt>`, ignore stdin, and settle into `ok | quota | model_config | error`
  before fallback continues. Other resolved agents still return the terminal
  unwired `error`. Production
  `binding.id` records the resolved rung identity as
  `agentId/adapterModel/priceKey`, so attempts stay distinct even when two rungs
  share the same adapter model string.
- `createAgentBindings(agentIds)` remains the older bare-agent helper for paths
  that still inject prebuilt bindings directly.

## Terminal `failureKind` (binding-chain stop)

When the step runner classifies `kind: "invocation_failure"` after the binding
chain stops, `failureKind` encodes why:

| `failureKind` | Meaning |
| --- | --- |
| `quota` | Every configured binding returned `quota`; fallback exhausted |
| `model_config` | First non-quota result was `model_config`; chain stops (no advance) |
| `error` | First non-quota result was `error`; chain stops (no advance) |
| `no_binding` | No bindings configured (`final === null`), including an empty resolved binding list |

Detail (`failureKind` plus ordered `bindingAttempts`) attaches only for
binding-chain `invocation_failure`. Post-invocation token parse failure
(`invalid_token`) maps to loop `kind: "invocation_failure"` but omits these
fields. See [`write-behavior.md`](./write-behavior.md).

Boundary:

- This module owns fallback iteration and ordering.
- It owns write-step `invocation_completed` emission after subprocess settle,
  including one row per binding subprocess across quota fallback, shared logical
  attempt IDs from the caller, and distinct caller-owned `invocation_id` values
  per subprocess row.
- Telemetry sink append failure is surfaced separately on the invocation result
  and does not change fallback behavior or the settled binding result.
- It owns **invocation liveness policy evaluation** (stall vs slow work, profiles by
  behavior × role); workflow loops consume outcomes — [`invocation-liveness.md`](./invocation-liveness.md).
- It does not own token parsing, output-contract checks, workflow loops, CLI
  formatting, or git/worktree side effects.
- Token parsing and contract dispatch are documented in
  [`shared-step-runner.md`](./shared-step-runner.md).
