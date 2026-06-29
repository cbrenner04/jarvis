# Shared invocation contract

`shared/invocation/execute.ts` owns the behavior-agnostic, abortable
agent-invocation fallback seam used by v2 write-step execution.

Contract:

- Input: `(prompt, cwd, ordered bindings, AbortSignal?)`.
- Each binding invocation returns typed `ok | quota | model_config | error`.
- Fallback advances only on `quota`.
- Any non-`quota` result stops immediately (no later binding attempt).
- Output returns ordered attempts plus the final attempt (or `null` when no
  bindings are configured).

Fallback is quota-only by design: `model_config` and `error` are terminal,
since a misconfigured or crashing agent is not recoverable by the next binding.

Bindings:

- `createAgentBindings(agentIds)` in `shared/invocation/agents.ts` builds the
  ordered bindings. It is the seam where real `claude`/`codex`/`cursor` process
  spawning and quota classification land; until then each binding returns a
  terminal `error`, and tests inject their own bindings.

## Terminal `failureKind` (binding-chain stop)

When the step runner classifies `kind: "invocation_failure"` after the binding
chain stops, `failureKind` encodes why:

| `failureKind` | Meaning |
| --- | --- |
| `quota` | Every configured binding returned `quota`; fallback exhausted |
| `model_config` | First non-quota result was `model_config`; chain stops (no advance) |
| `error` | First non-quota result was `error`; chain stops (no advance) |
| `no_binding` | No bindings configured (`final === null`) |

Fallback advances **only** on `quota`. `model_config` and `error` are terminal
on the binding that returned them — the harness does not try the next agent.

Detail (`failureKind` plus ordered `bindingAttempts`) attaches only for
binding-chain `invocation_failure`. Post-invocation token parse failure
(`invalid_token`) maps to loop `kind: "invocation_failure"` but omits these
fields. See [`write-behavior.md`](./write-behavior.md).

Boundary:

- This module owns fallback iteration and ordering.
- It does not own token parsing, output-contract checks, workflow loops, CLI
  formatting, or git/worktree side effects.
- Token parsing and contract dispatch are documented in
  [`shared-step-runner.md`](./shared-step-runner.md).
